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
    { MAX_CANDIDATES = 5, MAX_CONFIDENCE_GAP = 1.0,  } = {}
    ) => ({
    system: `
        Operate with a strict pipeline (silently):

            1) Detect COMPARATOR MODE:
            • If the description asks for works "similar to", "like", "reminiscent of", "not", "unlike", "other than", "in the vein of", or equivalent, extract any referenced seed works (titles/series/creators) and activate COMPARATOR MODE.
            • When COMPARATOR MODE is active, the referenced seed works become EXCLUDED SEEDS.

            2) Extract HARD CUES from the description: exact quoted phrases (≥3 words); proper nouns (character/place/institution names); series/volume markers; genre/format; time/place indicators; explicit negatives.

            3) Candidate generation:
            • Prefer candidates satisfying ALL HARD CUES when possible.
            • If COMPARATOR MODE is active: generate candidates that share genre/style/themes with the EXCLUDED SEEDS but are distinct works.

            4) DISQUALIFY step (mandatory):
            • Normalize titles (lowercase; strip punctuation, subtitles after ":" or "—", leading articles).
            • Remove any candidate whose normalized title equals any EXCLUDED SEED title (including well-known aliases).
            • If a candidate is a different edition of an EXCLUDED SEED, remove it unless the description explicitly requests that edition.

            5) Work vs. edition:
            • Prefer the original/canonical work. Only return a specific edition if clearly specified.

            6) Identifiers:
            • Include identifiers (ISBN-13/10, OCLC, LCCN) only when certain they belong to that exact work/edition; otherwise omit.

            7) Scoring:
            • Confidence ∈ [0,1].
            • If the description is an exact, unique title or famous series name and COMPARATOR MODE is NOT active, score that match at 1.00.
            • ≥0.90 only if matching an exact quote AND ≥1 unique proper-noun/series/setting cue with no conflicts.
            • 0.60–0.89 for strong multi-cue matches with no conflicts.
            • BROAD/GENRE RULE: For broad topical queries, return ${MAX_CANDIDATES} diverse canonical examples; scores may start ≈0.50 and need not converge.

            8) Abstention:
            • Let top = highest confidence found. MIN_CONFIDENCE = top - ${MAX_CONFIDENCE_GAP}.
            • Retain only candidates with confidence > MIN_CONFIDENCE.
            • If no candidates, return [].

            9) Evidence:
            • Cite at least one exact cue from the description and give a brief rationale. Do not reveal your chain-of-thought.

            10) Metadata:
            • Use earliest publication year of the work when known.
            • Omit unknown fields rather than emitting null/empty strings.
            • Sort by confidence desc; no duplicates.

            11) Final validation (must pass before output):
            • If COMPARATOR MODE is active, assert that no candidate equals any EXCLUDED SEED (after normalization) and that no candidate is merely a reprint/edition of an EXCLUDED SEED.
            • Output JSON only; if no plausible work exists, return [].
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
