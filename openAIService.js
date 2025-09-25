const https = require('https');

const OPENAI_API_HOSTNAME = 'api.openai.com';
const OPENAI_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
const MAX_CANDIDATES = 10;

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

const parseCandidates = (rawResponse) => {
    if (!rawResponse) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawResponse);
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

const requestChatCompletion = (messages) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set.');
    }

    const payload = JSON.stringify({
        model: DEFAULT_OPENAI_MODEL,
        messages,
        temperature: 0.2,
    });

    return new Promise((resolve, reject) => {
        const request = https.request(
            {
                hostname: OPENAI_API_HOSTNAME,
                path: OPENAI_CHAT_COMPLETIONS_PATH,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    Authorization: `Bearer ${apiKey}`,
                },
            },
            (response) => {
                let body = '';
                response.on('data', (chunk) => {
                    body += chunk;
                });

                response.on('end', () => {
                    if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                        try {
                            resolve(JSON.parse(body));
                        } catch (error) {
                            reject(new Error('Failed to parse response from OpenAI.'));
                        }
                    } else {
                        reject(new Error(`OpenAI API error: ${response.statusCode} ${body}`));
                    }
                });
            }
        );

        request.on('error', (error) => {
            reject(error);
        });

        request.write(payload);
        request.end();
    });
};

const convertDescriptionToIsbn = async (description) => {
    const trimmedDescription = (description || '').trim();
    if (!trimmedDescription) {
        throw new Error('A description or excerpt is required to perform the conversion.');
    }

    const messages = [
        {
            role: 'system',
            content:
                `You are a bibliographic identifier. Given a short passage or description, return the most likely source works.
Prefer canonical titles; include author, earliest publication year, language, and any standard identifiers you know (ISBN-10/13,
 OCLC, LCCN). Respond with a JSON array of up to ${MAX_CANDIDATES} candidate objects ordered from highest to lowest confidence.
Each candidate must include: title, authors (array), earliest publication year, language (if known), a confidence value between 0
and 1, concise evidence (why the work matches), and an identifiers object containing any known identifiers. If no plausible work
is found, respond with an empty JSON array.`,
        },
        {
            role: 'user',
            content:
                `List up to ${MAX_CANDIDATES} candidate works that match the description below following the required JSON schema.
If nothing is plausible, return an empty JSON array.\n\nDescription: ${trimmedDescription}`,
        },
    ];

    const completion = await requestChatCompletion(messages);
    const rawResponse = completion?.choices?.[0]?.message?.content?.trim();

    const candidates = parseCandidates(rawResponse);
    const topCandidate = candidates.find(
        (candidate) => candidate.identifiers?.isbn13 || candidate.identifiers?.isbn10
    );
    const isbn = topCandidate?.identifiers?.isbn13 || topCandidate?.identifiers?.isbn10 || null;

    return {
        isbn,
        rawResponse,
        model: completion?.model || DEFAULT_OPENAI_MODEL,
        candidates,
    };
};

module.exports = {
    convertDescriptionToIsbn,
};
