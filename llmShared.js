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

const resolveProvider = () => {
    const aliases = [
        process.env.LLM_PROVIDER,
        process.env.AI_PROVIDER,
        process.env.LLM_SERVICE,
        process.env.AI_SERVICE,
    ];

    for (const alias of aliases) {
        if (typeof alias !== 'string') {
            continue;
        }

        const normalized = alias.trim().toLowerCase();
        if (!normalized) {
            continue;
        }

        if (['claude', 'anthropic', 'claude-3'].includes(normalized)) {
            return 'claude';
        }

        if (['openai', 'gpt', 'chatgpt'].includes(normalized)) {
            return 'openai';
        }
    }

    if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
        if (!process.env.OPENAI_API_KEY) {
            return 'claude';
        }
    }

    return 'openai';
};

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

const buildPrompt = (description) => ({
    system: `You are a bibliographic identifier. Given a short passage or description, return the most likely source works.
Prefer canonical titles; include author, earliest publication year, language, and any standard identifiers you know (ISBN-10/13,
OCLC, LCCN). Respond with a JSON array of up to ${MAX_CANDIDATES} candidate objects ordered from highest to lowest confidence.
Each candidate must include: title, authors (array), earliest publication year, language (if known), a confidence value between 0 and 1, concise evidence (why the work matches), and an identifiers object containing any known identifiers. If no plausible work is found, respond with an empty JSON array.`,
    user: `List up to ${MAX_CANDIDATES} candidate works that match the description below following the required JSON schema.
Responeses should only contain json. If nothing is plausible, return an empty JSON array.\n\nDescription: ${description}`,
});

module.exports = {
    MAX_CANDIDATES,
    sanitizeModelId,
    resolveProvider,
    resolveTemperature,
    parseCandidates,
    buildPrompt,
};
