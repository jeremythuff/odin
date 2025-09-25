const { convertDescriptionToIsbn } = require('./openAIService');

const performSearch = async (query) => {
    const normalizedQuery = (query ?? '').trim();

    try {
        const aiResult = await convertDescriptionToIsbn(normalizedQuery);
        return {
            ok: true,
            query: normalizedQuery,
            result: {
                isbn: aiResult.isbn,
                model: aiResult.model,
                candidates: aiResult.candidates,
            },
            rawResponse: aiResult.rawResponse,
        };
    } catch (error) {
        return {
            ok: false,
            query: normalizedQuery,
            error: error.message || 'Unable to process the request.',
        };
    }
};

module.exports = {
    performSearch,
};
