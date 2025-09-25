const { convertDescriptionToIsbn } = require('./openAIService');

const escapeHtml = (value = '') => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char));

const formatResultHtml = ({ query, isbn, rawResponse, model }) => {
    const safeQuery = escapeHtml(String(query ?? ''));
    const details = [
        `<p><strong>Query:</strong> ${safeQuery}</p>`,
    ];

    if (isbn) {
        details.push(`<p><strong>Detected ISBN:</strong> ${isbn}</p>`);
    }

    if (rawResponse && rawResponse !== isbn) {
        const safeRaw = escapeHtml(rawResponse);
        details.push(`<p><strong>AI response:</strong> ${safeRaw}</p>`);
    }

    if (model) {
        details.push(`<p><strong>Model:</strong> ${model}</p>`);
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
