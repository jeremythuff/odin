const referencePromptFactory = require('../factory/referencePromptFactory');
const exploratoryPromptFactory = require('../factory/exploratoryPromptFactory');
const comparativePromptFactory = require('../factory/comparativePromptFactory');

const MAX_CANDIDATES = 10;

const sanitizeModelId = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    return trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed;
};

const PROVIDER_ALIASES = {
    claude: ['claude', 'anthropic', 'claude-3', 'claude3', 'claud'],
    openai: ['openai', 'gpt', 'chatgpt', 'gpt-4', 'gpt4', 'gpt-3.5', 'gpt3.5'],
    gemini: ['gemini', 'google', 'google-ai', 'gemini-1.5', 'gemini1.5', 'gemini-pro'],
};

const normalizeProvider = (value) => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!normalized) {
        return null;
    }

    for (const [provider, aliases] of Object.entries(PROVIDER_ALIASES)) {
        if (aliases.includes(normalized)) {
            return provider;
        }
    }

    return null;
};

const resolveProvider = () => normalizeProvider(process.env.LLM_PROVIDER) || 'openai';

const resolveTemperature = () => {
    const raw = process.env.LLM_TEMPERATURE ?? process.env.MODEL_TEMPERATURE;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0.2;
};

const normalizeIsbn = (text) => {
    if (!text) {
        return null;
    }

    const compact = text.replace(/[^0-9Xx]/g, '');
    if (compact.length === 13 || compact.length === 10) {
        return compact.toUpperCase();
    }

    return null;
};

const coerceString = (value) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }

    return null;
};

const coerceAuthorList = (value) => {
    if (!value) {
        return null;
    }

    if (Array.isArray(value)) {
        const names = value.map((entry) => coerceString(entry)).filter(Boolean);
        return names.length ? names : null;
    }

    const single = coerceString(value);
    return single ? [single] : null;
};

const sanitizeIdentifiers = (candidate) => {
    const identifiersSource =
        (candidate && typeof candidate.identifiers === 'object' && candidate.identifiers !== null)
            ? candidate.identifiers
            : candidate;

    const identifiers = {};

    const isbn13 = normalizeIsbn(
        identifiersSource?.isbn13 ||
            identifiersSource?.isbn_13 ||
            identifiersSource?.ISBN13 ||
            identifiersSource?.ISBN_13 ||
            identifiersSource?.['isbn-13'] ||
            identifiersSource?.['ISBN-13']
    );
    if (isbn13) {
        identifiers.isbn13 = isbn13;
    }

    const isbn10 = normalizeIsbn(
        identifiersSource?.isbn10 ||
            identifiersSource?.isbn_10 ||
            identifiersSource?.ISBN10 ||
            identifiersSource?.ISBN_10 ||
            identifiersSource?.['isbn-10'] ||
            identifiersSource?.['ISBN-10']
    );
    if (isbn10) {
        identifiers.isbn10 = isbn10;
    }

    const oclc = coerceString(
        identifiersSource?.oclc ||
            identifiersSource?.OCLC ||
            identifiersSource?.oclcNumber ||
            identifiersSource?.Oclc
    );
    if (oclc) {
        identifiers.oclc = oclc;
    }

    const lccn = coerceString(
        identifiersSource?.lccn ||
            identifiersSource?.LCCN ||
            identifiersSource?.lccNumber ||
            identifiersSource?.Lccn
    );
    if (lccn) {
        identifiers.lccn = lccn;
    }

    return Object.keys(identifiers).length ? identifiers : null;
};

const sanitizeCandidate = (candidate) => {
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const sanitized = {};

    const title = coerceString(candidate.title || candidate.work || candidate.book);
    if (title) {
        sanitized.title = title;
    }

    const authors = coerceAuthorList(candidate.authors || candidate.author || candidate.creator);
    if (authors) {
        sanitized.authors = authors;
    }

    const year = Number(candidate.year || candidate.publicationYear || candidate.published || candidate['publication year']);
    if (Number.isFinite(year)) {
        sanitized.year = year;
    }

    const language = coerceString(candidate.language || candidate.lang);
    if (language) {
        sanitized.language = language;
    }

    const identifiers = sanitizeIdentifiers(candidate);
    if (identifiers) {
        sanitized.identifiers = identifiers;
    }

    const confidenceValue = Number(candidate.confidence);
    if (Number.isFinite(confidenceValue)) {
        sanitized.confidence = Math.min(1, Math.max(0, confidenceValue));
    }

    const evidence = coerceString(candidate.evidence || candidate.justification || candidate.reason);
    if (evidence) {
        sanitized.evidence = evidence;
    }

    return Object.keys(sanitized).length ? sanitized : null;
};

const extractJsonPayload = (rawResponse) => {
    if (!rawResponse) {
        return null;
    }

    const trimmed = rawResponse.trim();

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
        return fencedMatch[1].trim();
    }

    const arrayMatch = trimmed.match(/\[([\s\S]*)\]/);
    if (arrayMatch) {
        return arrayMatch[0];
    }

    return trimmed;
};

const parseCandidates = (rawResponse) => {
    if (!rawResponse) {
        return [];
    }

    const payload = extractJsonPayload(rawResponse);
    if (!payload) {
        return [];
    }

    try {
        const parsed = JSON.parse(payload);
        if (!Array.isArray(parsed)) {
            return [];
        }

        const candidates = parsed
            .slice(0, MAX_CANDIDATES)
            .map((candidate) => sanitizeCandidate(candidate))
            .filter(Boolean);

        return candidates;
    } catch (error) {
        return [];
    }
};

const PROMPT_FACTORIES = {
    REFERENCE: referencePromptFactory,
    EXPLORATORY: exploratoryPromptFactory,
    COMPARATIVE: comparativePromptFactory,
};

const DEFAULT_CLASSIFICATION = 'REFERENCE';

const resolvePromptFactory = (classification) => {
    const normalized = typeof classification === 'string' ? classification.trim().toUpperCase() : '';
    return PROMPT_FACTORIES[normalized] || PROMPT_FACTORIES[DEFAULT_CLASSIFICATION];
};

const buildPrompt = (
    description,
    {
        MAX_CANDIDATES = 5,
        MAX_CONFIDENCE_GAP = 1.0,
        classification = null,
    } = {}
) => {
    const factory = resolvePromptFactory(classification);
    return factory({
        description,
        maxCandidates: MAX_CANDIDATES,
        maxConfidenceGap: MAX_CONFIDENCE_GAP,
    });
};

module.exports = {
    MAX_CANDIDATES,
    sanitizeModelId,
    resolveProvider,
    normalizeProvider,
    resolveTemperature,
    parseCandidates,
    buildPrompt,
    PROVIDER_ALIASES,
};
