const { classifyQueryEmbedding, ROUTES } = require('./embeddingClassifier');
const { classifyWithDisambiguationLLM } = require('./disambiguationService');

const EXECUTION_TARGETS = {
    DIRECT: 'OPAC_LOOKUP',
    REFERENCE: 'ENTITY_RESOLUTION',
    EXPLORATORY: 'SEMANTIC_SEARCH',
    COMPARATIVE: 'SIMILARITY_RECOMMENDER',
};

const ISBN_REGEXP = /(?:97[89][-\s]?)?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d{1}|\d{9}[0-9Xx]/;
const DOI_REGEXP = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;
const OCLC_REGEXP = /^oclc[-\s]?\d+$/i;

const normalizeWhitespace = (value) => value.replace(/\s+/g, ' ').trim();

const runNormalizationPhase = (rawQuery) => {
    const normalizedQuery = normalizeWhitespace(String(rawQuery ?? '')).toLowerCase();

    return {
        phase: 'Normalization Phase',
        rawQuery: String(rawQuery ?? ''),
        normalizedQuery,
        detectedLanguage: 'unknown',
        notes: 'Stub normalization: lowercasing + whitespace collapse.',
    };
};

const runHeuristicPhase = (rawQuery, normalizedQuery) => {
    const matches = [];
    let directIdentifier = null;
    let directIdentifierType = null;

    const rememberMatch = (type, value) => {
        matches.push({ type, value });
        if (!directIdentifier) {
            directIdentifier = value;
            directIdentifierType = type;
        }
    };

    const tryMatch = (pattern) => {
        const rawMatch = rawQuery.match(pattern);
        if (rawMatch && rawMatch[0]) {
            return rawMatch[0];
        }

        const normalizedMatch = normalizedQuery.match(pattern);
        return normalizedMatch ? normalizedMatch[0] : null;
    };

    const isbnMatch = tryMatch(ISBN_REGEXP);
    if (isbnMatch) {
        rememberMatch('ISBN', normalizeWhitespace(isbnMatch));
    }

    const doiMatch = tryMatch(DOI_REGEXP);
    if (doiMatch) {
        rememberMatch('DOI', normalizeWhitespace(doiMatch));
    }

    const oclcMatch = tryMatch(OCLC_REGEXP);
    if (oclcMatch) {
        rememberMatch('OCLC', normalizeWhitespace(oclcMatch));
    }

    const heuristicDecision = matches.length
        ? {
              route: ROUTES.DIRECT,
              reason: 'Identifier detected via regex check.',
              identifier: directIdentifier,
              identifierType: directIdentifierType,
          }
        : { route: null, reason: 'No deterministic identifier match.', identifier: null, identifierType: null };

    return {
        phase: 'Heuristic Phase',
        matches,
        decision: heuristicDecision,
        identifier: directIdentifier,
        identifierType: directIdentifierType,
    };
};

const runEmbeddingClassificationPhase = (rawQuery, normalizedQuery) => {
    const classification = classifyQueryEmbedding(rawQuery || normalizedQuery || '');

    return {
        phase: 'Embedding Classification Phase',
        label: classification.label,
        confidence: classification.confidence,
        similarityMargin: classification.similarityMargin,
        scores: classification.scores,
        tokenCount: classification.tokenCount,
        notes: 'Prototype embedding classifier using token cosine similarity.',
        normalizedQuery,
    };
};

const shouldRunDisambiguation = (embeddingResult) => embeddingResult.similarityMargin < 0.08;

const runLLMDisambiguationPhase = async ({ normalizedQuery, embedding }) => {
    try {
        const llmResult = await classifyWithDisambiguationLLM({
            normalizedQuery,
            embedding,
            initialLabel: embedding.label,
        });

        return {
            phase: 'LLM Disambiguation Phase',
            invoked: true,
            provider: llmResult.provider,
            model: llmResult.model,
            label: llmResult.label,
            confidence: llmResult.confidence,
            reason: llmResult.reason,
            rawResponse: llmResult.rawResponse,
        };
    } catch (error) {
        return {
            phase: 'LLM Disambiguation Phase',
            invoked: false,
            error: error.message,
            label: embedding.label,
            confidence: embedding.confidence,
            reason: 'Failed to invoke disambiguation LLM. Retaining embedding classification.',
        };
    }
};

const skipLLMDisambiguationPhase = (embeddingResult) => ({
    phase: 'LLM Disambiguation Phase',
    invoked: false,
    label: embeddingResult.label,
    confidence: embeddingResult.confidence,
    reason: 'Similarity margin exceeded threshold; skipping LLM disambiguation.',
});

const runRoutingPhase = (label) => {
    const target = EXECUTION_TARGETS[label] || 'SEMANTIC_SEARCH';
    return {
        phase: 'Routing Phase',
        label,
        target,
        notes: 'Stub routing map linking classification to downstream system.',
    };
};

const runExecutionPhase = (routing) => ({
    phase: 'Execution Phase',
    target: routing.target,
    status: 'pending',
    notes: 'Stub execution plan. Replace with actual subsystem invocation logic.',
});

const runPostProcessingPhase = (routing) => ({
    phase: 'Post-processing Phase',
    performed: false,
    notes: 'Stub post-processing placeholder for enrichment, fallbacks, and logging.',
    routingTarget: routing.target,
});

const runSearchPipeline = async (rawQuery, options = {}) => {
    const rawQueryValue = String(rawQuery ?? '');
    const phases = [];

    const normalization = runNormalizationPhase(rawQueryValue);
    phases.push(normalization);

    const heuristic = runHeuristicPhase(rawQueryValue, normalization.normalizedQuery);
    phases.push(heuristic);

    let classification = heuristic.decision.route ? ROUTES.DIRECT : null;
    let confidence = heuristic.decision.route ? 0.99 : null;

    const embedding = runEmbeddingClassificationPhase(rawQueryValue, normalization.normalizedQuery);
    phases.push(embedding);

    if (!classification) {
        classification = embedding.label;
        confidence = embedding.confidence;
    }

    let llmPhase;
    if (!heuristic.decision.route && shouldRunDisambiguation(embedding)) {
        llmPhase = await runLLMDisambiguationPhase({
            normalizedQuery: normalization.normalizedQuery,
            embedding,
        });
        classification = llmPhase.label || classification;
        confidence = llmPhase.confidence ?? confidence;
    } else {
        llmPhase = skipLLMDisambiguationPhase(embedding);
    }
    phases.push(llmPhase);

    const routing = runRoutingPhase(classification);
    phases.push(routing);

    const execution = runExecutionPhase(routing);
    phases.push(execution);

    const postProcessing = runPostProcessingPhase(routing);
    phases.push(postProcessing);

    return {
        phases,
        classification,
        confidence,
        rawQuery: rawQueryValue,
        normalizedQuery: normalization.normalizedQuery,
        heuristic,
        routing,
        execution,
        options,
        directIdentifier: heuristic.decision.identifier,
        directIdentifierType: heuristic.decision.identifierType,
    };
};

module.exports = {
    ROUTES,
    EXECUTION_TARGETS,
    runSearchPipeline,
};
