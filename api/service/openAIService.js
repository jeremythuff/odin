const https = require('https');

const OPENAI_API_HOSTNAME = 'api.openai.com';
const OPENAI_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

const {
    sanitizeModelId,
    resolveTemperature,
    parseCandidates,
    buildPrompt,
} = require('./llmService');
const { buildUsageStats } = require('./usageMetrics');

const resolveOpenAiModel = () =>
    sanitizeModelId(process.env.OPENAI_MODEL) ||
    sanitizeModelId(process.env.DEFAULT_OPENAI_MODEL) ||
    'gpt-4.1-mini';

const requestOpenAiCompletion = (prompt) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set.');
    }

    const model = resolveOpenAiModel();
    const payload = JSON.stringify({
        model,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ],
        //temperature: resolveTemperature(),
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
                            const data = JSON.parse(body);
                            const rawText = data?.choices?.[0]?.message?.content?.trim() || '';
                            resolve({ rawText, model: data?.model || model, usage: data?.usage || null });
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

    const prompt = buildPrompt(trimmedDescription);
    const { rawText: rawResponse, model, usage: rawUsage } = await requestOpenAiCompletion(prompt);

    const candidates = parseCandidates(rawResponse);
    const topCandidate = candidates.find(
        (candidate) => candidate.identifiers?.isbn13 || candidate.identifiers?.isbn10
    );
    const isbn = topCandidate?.identifiers?.isbn13 || topCandidate?.identifiers?.isbn10 || null;

    return {
        isbn,
        rawResponse,
        model,
        candidates,
        usage: buildUsageStats('openai', model, rawUsage),
    };
};

module.exports = {
    convertDescriptionToIsbn,
};
