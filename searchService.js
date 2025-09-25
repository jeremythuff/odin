const { convertDescriptionToIsbn } = require('./openAIService');

const escapeHtml = (value = '') => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char));

const formatConfidence = (confidence) => {
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
        return null;
    }

    return `${Math.round(confidence * 100) / 100}`;
};

const formatIdentifiers = (identifiers = {}) => {
    const parts = [];

    if (identifiers.isbn13) {
        parts.push(`ISBN-13: ${escapeHtml(identifiers.isbn13)}`);
    }

    if (identifiers.isbn10) {
        parts.push(`ISBN-10: ${escapeHtml(identifiers.isbn10)}`);
    }

    if (identifiers.oclc) {
        parts.push(`OCLC: ${escapeHtml(identifiers.oclc)}`);
    }

    if (identifiers.lccn) {
        parts.push(`LCCN: ${escapeHtml(identifiers.lccn)}`);
    }

    return parts.join(', ');
};

const formatCandidateHtml = (candidate, index) => {
    const details = [];

    if (candidate.title) {
        details.push(`<strong>${escapeHtml(candidate.title)}</strong>`);
    }

    if (candidate.authors && candidate.authors.length) {
        details.push(`<span class="authors">${escapeHtml(candidate.authors.join('; '))}</span>`);
    }

    if (candidate.year) {
        details.push(`<span class="year">${escapeHtml(String(candidate.year))}</span>`);
    }

    if (candidate.language) {
        details.push(`<span class="language">${escapeHtml(candidate.language)}</span>`);
    }

    const identifierText = formatIdentifiers(candidate.identifiers || {});
    if (identifierText) {
        details.push(`<span class="identifiers">${identifierText}</span>`);
    }

    const confidenceText = formatConfidence(candidate.confidence);
    if (confidenceText) {
        details.push(`<span class="confidence">Confidence: ${escapeHtml(confidenceText)}</span>`);
    }

    if (candidate.evidence) {
        details.push(`<span class="evidence">${escapeHtml(candidate.evidence)}</span>`);
    }

    const content = details.join(' • ');
    return `<li><span class="rank">${index + 1}.</span> ${content}</li>`;
};

const formatResultHtml = ({ query, isbn, rawResponse, model, candidates }) => {
    const safeQuery = escapeHtml(String(query ?? ''));
    const details = [
        `<p><strong>Query:</strong> ${safeQuery}</p>`,
    ];

    if (isbn) {
        details.push(`<p><strong>Top ISBN candidate:</strong> ${escapeHtml(isbn)}</p>`);
    }

    if (Array.isArray(candidates) && candidates.length) {
        const items = candidates.map((candidate, index) => formatCandidateHtml(candidate, index)).join('\n');
        details.push(`<ol class="candidates">${items}</ol>`);
    } else if (rawResponse) {
        const safeRaw = escapeHtml(rawResponse);
        details.push(`<p><strong>AI response:</strong> ${safeRaw}</p>`);
    }

    if (model) {
        details.push(`<p><strong>Model:</strong> ${escapeHtml(model)}</p>`);
    }

    return details.join('\n');
};

const performSearch = async (query) => {
    try {
        const aiResult = await convertDescriptionToIsbn(query);
        return {
            html: formatResultHtml({
                query,
                isbn: aiResult.isbn,
                rawResponse: aiResult.rawResponse,
                model: aiResult.model,
                candidates: aiResult.candidates,
            }),
        };
    } catch (error) {
        return {
            html: `<p class="error">Unable to process the request: ${error.message}</p>`,
        };
    }
};

module.exports = {
    performSearch,
};
