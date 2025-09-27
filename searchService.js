const { resolveProvider } = require('./llmShared');
const { convertDescriptionToIsbn: convertWithOpenAi } = require('./openAIService');
const { convertDescriptionToIsbn: convertWithAnthropic } = require('./anthropicService');

const providerHandlers = {
    openai: convertWithOpenAi,
    claude: convertWithAnthropic,
};

const performSearch = async (query) => {
    const normalizedQuery = (query ?? '').trim();

    const provider = resolveProvider();
    const handler = providerHandlers[provider] || providerHandlers.openai;

    try {
        const aiResult = await handler(normalizedQuery);
        return {
            ok: true,
            query: normalizedQuery,
            provider,
            result: {
                isbn: aiResult.isbn,
                model: aiResult.model,
                candidates: aiResult.candidates,
                usage: aiResult.usage || null,
            },
            rawResponse: aiResult.rawResponse,
        };
    } catch (error) {
        return {
            ok: false,
            query: normalizedQuery,
            provider,
            error: error.message || 'Unable to process the request.',
        };
    }
};

module.exports = {
    performSearch,
};
