const https = require('https');
const { sanitizeModelId } = require('./llmService');
const { ROUTES } = require('./embeddingClassifier');

const OPENAI_API_HOSTNAME = 'api.openai.com';
const OPENAI_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

const DISAMBIGUATION_PROVIDER = (process.env.DISAMBIGUATION_PROVIDER || 'openai').trim().toLowerCase();
const DISAMBIGUATION_OPENAI_MODEL =
    sanitizeModelId(process.env.DISAMBIGUATION_OPENAI_MODEL) || 'gpt-4o-mini';
const DISAMBIGUATION_TEMPERATURE = 0;

const allowedLabels = new Set(Object.values(ROUTES));

const stringifyScores = (scores = {}) => Object.entries(scores)
    .map(([label, score]) => `${label}: ${score.toFixed(4)}`)
    .join(', ');

const extractJsonCandidate = (rawText) => {
    if (!rawText) {
        return null;
    }

    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) {
        return codeBlockMatch[1].trim();
    }

    const objectMatch = rawText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        return objectMatch[0];
    }

    return null;
};

const normalizeLabel = (value, fallback) => {
    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.trim().toUpperCase();
    return allowedLabels.has(normalized) ? normalized : fallback;
};

const buildOpenAiPrompt = ({ normalizedQuery, embedding, initialLabel }) => ({
    system: [
        'You classify library search queries.',
        'Return strict JSON with fields: label (DIRECT|REFERENCE|EXPLORATORY|COMPARATIVE), confidence (0-1), reason (string).',
        'Use the provided embedding scores as prior probabilities.',
        'Prefer DIRECT when clear identifiers or quoted titles are present.',
        'REFERENCE describes one specific work with partial memories.',
        'EXPLORATORY seeks broad topical information.',
        'COMPARATIVE asks for items similar to a named work.',
        'Only output JSON; no prose.',
    ].join(' '),
    user: [
        `Normalized query: "${normalizedQuery}"`,
        `Embedding suggestion: ${initialLabel}`,
        `Embedding scores: ${stringifyScores(embedding.scores) || 'unavailable'}`,
        `Token count: ${embedding.tokenCount ?? 'unknown'}`,
        'Classify the query. Respond with JSON: {"label":"...","confidence":0-1,"reason":"..."}',
    ].join('\n'),
});

const requestOpenAiClassification = (prompt) => {
    const apiKey = process.env.DISAMBIGUATION_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('DISAMBIGUATION_OPENAI_API_KEY or OPENAI_API_KEY must be set for disambiguation classification.');
    }

    const payload = JSON.stringify({
        model: DISAMBIGUATION_OPENAI_MODEL,
        temperature: DISAMBIGUATION_TEMPERATURE,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ],
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
                        resolve(body);
                    } else {
                        reject(new Error(`OpenAI disambiguation API error: ${response.statusCode} ${body}`));
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

const parseClassificationResponse = (rawResponse, fallbackLabel, fallbackConfidence) => {
    try {
        const parsed = JSON.parse(rawResponse);
        const rawText = parsed?.choices?.[0]?.message?.content || '';
        const jsonCandidate = extractJsonCandidate(rawText) || rawText;
        if (!jsonCandidate) {
            throw new Error('No JSON payload found in classification response.');
        }

        const classification = JSON.parse(jsonCandidate);
        const label = normalizeLabel(classification.label, fallbackLabel);
        const confidence = typeof classification.confidence === 'number'
            ? Math.min(Math.max(classification.confidence, 0), 1)
            : Math.max(fallbackConfidence, 0.5);
        const reason = typeof classification.reason === 'string' && classification.reason.trim()
            ? classification.reason.trim()
            : 'No explicit reason provided.';

        return { label, confidence, reason, rawText };
    } catch (error) {
        throw new Error(`Unable to parse disambiguation response: ${error.message}`);
    }
};

const classifyWithDisambiguationLLM = async ({ normalizedQuery, embedding, initialLabel }) => {
    if (DISAMBIGUATION_PROVIDER !== 'openai') {
        return {
            provider: DISAMBIGUATION_PROVIDER,
            label: initialLabel,
            confidence: embedding.confidence,
            reason: `Unsupported disambiguation provider "${DISAMBIGUATION_PROVIDER}". Falling back to embedding classification.`,
            rawResponse: null,
            model: null,
        };
    }

    const prompt = buildOpenAiPrompt({ normalizedQuery, embedding, initialLabel });
    const rawResponse = await requestOpenAiClassification(prompt);
    const parsed = parseClassificationResponse(rawResponse, initialLabel, embedding.confidence);

    return {
        provider: 'openai',
        model: DISAMBIGUATION_OPENAI_MODEL,
        label: parsed.label,
        confidence: parsed.confidence,
        reason: parsed.reason,
        rawResponse,
    };
};

module.exports = {
    classifyWithDisambiguationLLM,
};
