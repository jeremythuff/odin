const { resolveProvider, normalizeProvider } = require('./llmService');
const { convertDescriptionToIsbn: convertWithOpenAi } = require('./openAIService');
const { convertDescriptionToIsbn: convertWithAnthropic } = require('./anthropicService');
const { convertDescriptionToIsbn: convertWithGemini } = require('./geminiService');
const { runSearchPipeline, ROUTES } = require('./queryPipeline');
const { resolveCatalogDomain } = require('../utils/configUtils');

const providerHandlers = {
    openai: convertWithOpenAi,
    claude: convertWithAnthropic,
    gemini: convertWithGemini,
};

const buildBaseResponse = (pipeline, overrides = {}) => ({
    classification: pipeline.classification,
    confidence: pipeline.confidence,
    normalizedQuery: pipeline.normalizedQuery,
    pipeline,
    ...overrides,
});

const performSearch = async (query, options = {}) => {
    const pipeline = await runSearchPipeline(query, options);

    if (pipeline.classification === ROUTES.DIRECT) {
        const catalogDomain = resolveCatalogDomain();
        const identifier = (pipeline.directIdentifier || pipeline.normalizedQuery || '').trim();
        const encodedIdentifier = encodeURIComponent(identifier);
        const opacUrl = `${catalogDomain}/Search/Results?lookfor=${encodedIdentifier}&type=AllFields&limit=20`;

        pipeline.directLookupUrl = opacUrl;

        return buildBaseResponse(pipeline, {
            ok: true,
            query: pipeline.rawQuery,
            provider: null,
            result: {
                route: ROUTES.DIRECT,
                target: 'OPAC_LOOKUP',
                url: opacUrl,
                identifier,
                identifierType: pipeline.directIdentifierType || null,
            },
        });
    }

    const normalizedQuery = (pipeline.normalizedQuery ?? '').trim();

    const requestedProvider = normalizeProvider(options.provider);
    const provider = requestedProvider || resolveProvider();
    const handler = providerHandlers[provider] || providerHandlers.openai;

    try {
        const aiResult = await handler(normalizedQuery);
        return buildBaseResponse(pipeline, {
            ok: true,
            query: pipeline.rawQuery,
            provider,
            result: {
                route: pipeline.classification,
                isbn: aiResult.isbn,
                model: aiResult.model,
                candidates: aiResult.candidates,
                usage: aiResult.usage || null,
            },
            rawResponse: aiResult.rawResponse,
        });
    } catch (error) {
        return buildBaseResponse(pipeline, {
            ok: false,
            query: pipeline.rawQuery,
            provider,
            error: error.message || 'Unable to process the request.',
        });
    }
};

module.exports = {
    performSearch,
};
