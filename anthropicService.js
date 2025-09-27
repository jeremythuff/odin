const https = require('https');

const ANTHROPIC_API_HOSTNAME = 'api.anthropic.com';
const ANTHROPIC_MESSAGES_PATH = '/v1/messages';
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';

const {
    sanitizeModelId,
    resolveTemperature,
    parseCandidates,
    buildPrompt,
} = require('./llmShared');
const { buildUsageStats } = require('./usageMetrics');

const resolveClaudeModel = () =>
    sanitizeModelId(process.env.CLAUDE_MODEL) || 'claude-3-haiku-20240307';

const resolveClaudeMaxTokens = () => {
    const parsed = Number(process.env.CLAUDE_MAX_TOKENS);
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(parsed, 4000);
    }

    return 1024;
};

const requestClaudeCompletion = (prompt) => {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is not set.');
    }

    const model = resolveClaudeModel();
    const payload = JSON.stringify({
        model,
        max_tokens: resolveClaudeMaxTokens(),
        temperature: resolveTemperature(),
        system: prompt.system,
        messages: [
            {
                role: 'user',
                content: prompt.user,
            },
        ],
    });

    return new Promise((resolve, reject) => {
        const request = https.request(
            {
                hostname: ANTHROPIC_API_HOSTNAME,
                path: ANTHROPIC_MESSAGES_PATH,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'x-api-key': apiKey,
                    'anthropic-version': ANTHROPIC_VERSION,
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
                            const textPart = Array.isArray(data?.content)
                                ? data.content.find((part) => part && part.type === 'text')
                                : null;
                            const rawText = typeof textPart?.text === 'string' ? textPart.text.trim() : '';
                            resolve({ rawText, model: data?.model || model, usage: data?.usage || null });
                        } catch (error) {
                            reject(new Error('Failed to parse response from Claude.'));
                        }
                    } else {
                        reject(new Error(`Claude API error: ${response.statusCode} ${body}`));
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
    const { rawText: rawResponse, model, usage: rawUsage } = await requestClaudeCompletion(prompt);

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
        usage: buildUsageStats('claude', model, rawUsage),
    };
};

module.exports = {
    convertDescriptionToIsbn,
};
