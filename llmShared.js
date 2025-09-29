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

const buildPrompt = (description) => ({
    system: [
        "You are an expert bibliographic identifier.",
        "Given a short passage or description, identify up to ${MAX_CANDIDATES} plausible source works.",
        "Operate with a strict pipeline (silently):",
        "  1) Extract HARD CUES from the description: exact quoted phrases (≥3 words), proper nouns (character/place/institution names), series names/volume numbers, genre/format markers, time/place indicators, and any explicit negatives (e.g., 'not YA', 'not Tolkien').",
        "  2) Propose candidates that satisfy ALL hard cues. If any hard cue conflicts, discard the candidate.",
        "  3) Prefer work-level identification (original/canonical work). Only return an edition if the description clearly specifies one.",
        "  4) Verify identifiers only if you are certain they belong to that exact work/edition; otherwise omit them.",
        "Scoring & abstention:",
        "  • Confidence ∈ [0,1].",
        "  • ≥0.90 only if you match an exact quote and ≥1 unique proper noun/series/setting cue.",
        "  • 0.60–0.89 for strong multi-cue matches with no conflicts.",
        "  • If the best candidate is < ${MIN_CONFIDENCE || 0.60}, return an empty array (abstain). Do NOT guess.",
        "Evidence field:",
        "  • Must cite at least one exact cue from the description (e.g., cues:[\"Brock Marsh\",\"The Bonetown\"]).",
        "  • Add a short rationale referencing those cues (no chain-of-thought).",
        "Metadata rules:",
        "  • Use the earliest publication year of the work (omit if unknown).",
        "  • Omit fields rather than using null/empty strings.",
        "  • Sort by confidence desc; no duplicates.",
        "If no plausible work exists, return an empty JSON array.",
        "Output must be valid JSON only—no commentary."
        ].join(' '),
    user: [
        `List up to ${MAX_CANDIDATES} candidate works that match the description below using the required JSON schema.`,
        "Return only valid JSON (no text outside the JSON).",
        "Abstain if the best candidate confidence is < ${MIN_CONFIDENCE || 0.60}.",
        "Rules:",
        "  • Candidates must satisfy ALL hard cues (exact phrases, proper nouns, series/volume markers, setting/time, explicit negatives).",
        "  • Do not rely on general theme/genre similarity alone.",
        "  • Use work-level earliest publication year; only pick a specific edition if the description specifies it.",
        "  • Verify identifiers (ISBN-13, ISBN-10, OCLC, LCCN) strictly; omit any uncertain identifier.",
        "  • Omit unknown fields entirely (no null/empty strings).",
        "Schema (array of objects):",
        "[",
        "  {",
        '    "title": "string",',
        '    "authors": ["string", "..."],',
        '    "year": number,',
        '    "language": "string",',
        '    "confidence": number,',
        '    "evidence": "string",',
        '    "identifiers": {',
        '      "isbn13": "string",',
        '      "isbn10": "string",',
        '      "oclc": "string",',
        '      "lccn": "string"',
        "    }",
        "  }",
        "]",
        "",
        `Description: ${description}`
        ].join(" "),
});


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
