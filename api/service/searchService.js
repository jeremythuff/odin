const { resolveProvider, normalizeProvider } = require('../llmShared');
const { convertDescriptionToIsbn: convertWithOpenAi } = require('./openAIService');
const { convertDescriptionToIsbn: convertWithAnthropic } = require('./anthropicService');
const { convertDescriptionToIsbn: convertWithGemini } = require('./geminiService');

const providerHandlers = {
    openai: convertWithOpenAi,
    claude: convertWithAnthropic,
    gemini: convertWithGemini,
};

const performSearch = async (query, options = {}) => {
    const normalizedQuery = (query ?? '').trim();

    const requestedProvider = normalizeProvider(options.provider);
    const provider = requestedProvider || resolveProvider();
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
