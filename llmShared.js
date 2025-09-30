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

const buildPrompt = (
    description,
    { MAX_CANDIDATES = 5, MAX_CONFIDENCE_GAP = 0.4,  } = {}
    ) => ({
    system: `
        You are an expert bibliographic identifier. Given a short passage or description, identify up to ${MAX_CANDIDATES} plausible source works.

        Operate with a strict pipeline (silently):
        1) Extract **HARD CUES** from the description: exact quoted phrases (≥3 words), proper nouns (character/place/institution names), series names/volume numbers, genre/format markers, time/place indicators, and explicit negatives (e.g., not YA, not Tolkien).
        2) Prefer candidates that satisfy ALL hard cues.
        3) Prefer work-level identification (original/canonical work). Only return a specific edition if the description clearly specifies one.
        4) Verify identifiers only if certain they belong to that exact work/edition; otherwise omit.

        Scoring & abstention:
        • Confidence ∈ [0,1].
        • **SPECIFIC QUERY RULE:** If the description is an exact, unique title or well-known series name, the match must be scored at **1.00 (100%)**.
        • ≥0.90 only if you match an exact quote AND ≥1 unique proper-noun/series/setting cue.
        • 0.60–0.89 for strong multi-cue matches with no conflicts.
        • **BROAD/GENRE RULE (e.g., "new weird scifi"):** If the description is a broad genre/topic, prioritize finding **${MAX_CANDIDATES} diverse, canonical examples** within that category. Scores may be lower, starting at $\approx 0.50$.

        **ABSTENTION LOGIC (Modified):**
        • Calculate the MIN_CONFIDENCE as: (Top Candidate's Confidence) - **${MAX_CONFIDENCE_GAP}**.
        • **Retain all candidates** whose confidence is > MIN_CONFIDENCE.
        • If no candidates can be found, return an empty array (abstain).

        Evidence field:
        • Must cite at least one exact cue from the description.
        • Add a short rationale referencing those cues (no chain-of-thought).

        Metadata rules:
        • Use the earliest publication year of the work (omit if unknown).
        • Omit fields rather than using null/empty strings.
        • Sort by confidence desc; no duplicates.

        Output:
        • Return JSON only — no commentary. If no plausible work exists, return [].
        `.trim(),

    user: `
        Return valid JSON using the following schema. Omit unknown fields entirely; verify identifiers strictly and omit any uncertain identifier.

        Schema (array of objects):
        [
            {
                'title': 'string',
                'authors': ['string', ...],
                'year': number,
                'language': 'string',
                'confidence': number,
                'evidence': 'string',
                'identifiers': {
                'isbn13': 'string',
                'isbn10': 'string',
                'oclc': 'string',
                'lccn': 'string'
                'doi': 'string'
                }
            }
        ]

        Description:
        ${description}
        `.trim(),
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
