const https = require('https');

const DEFAULT_GEMINI_HOSTNAME = 'generativelanguage.googleapis.com';
const DEFAULT_GEMINI_API_VERSION = 'v1';

const {
    sanitizeModelId,
    resolveTemperature,
    parseCandidates,
    buildPrompt,
} = require('./llmService');
const { buildUsageStats } = require('./usageMetrics');

const resolveGeminiModel = () =>
    sanitizeModelId(process.env.GEMINI_MODEL) ||
    sanitizeModelId(process.env.DEFAULT_GEMINI_MODEL) ||
    'gemini-pro';

const resolveGeminiHostname = () => {
    const raw = typeof process.env.GEMINI_API_HOSTNAME === 'string' ? process.env.GEMINI_API_HOSTNAME.trim() : '';
    return raw || DEFAULT_GEMINI_HOSTNAME;
};

const resolveGeminiApiVersion = () => {
    const raw = typeof process.env.GEMINI_API_VERSION === 'string' ? process.env.GEMINI_API_VERSION.trim() : '';
    return raw || DEFAULT_GEMINI_API_VERSION;
};

const requestGeminiCompletion = (prompt) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
    }

    const model = resolveGeminiModel();
    const hostname = resolveGeminiHostname();
    const apiVersion = resolveGeminiApiVersion();
    const temperature = resolveTemperature();

    const requestBody = {
        "system_instruction": {
          "parts": {
            "text":  prompt.system
          }
        },
        "contents": {
          "parts": {
            "text": prompt.user
          }
        },
        generationConfig: {
            temperature,
        }
      };

    const payload = JSON.stringify(requestBody);
    const path = `/${apiVersion}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    
    return new Promise((resolve, reject) => {
        const request = https.request(
            {
                hostname,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
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
                            const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
                            const parts = candidate?.content?.parts;
                            const textPart = Array.isArray(parts)
                                ? parts.find((part) => part && typeof part.text === 'string')
                                : null;
                            const rawText = typeof textPart?.text === 'string' ? textPart.text.trim() : '';
                            resolve({
                                rawText,
                                model,
                                usage: data?.usageMetadata || null,
                            });
                        } catch (error) {
                            reject(new Error('Failed to parse response from Gemini.'));
                        }
                    } else {
                        let errorMessage = `Gemini API error: ${response.statusCode || 'unknown'} ${body}`;
                        try {
                            const errorData = JSON.parse(body);
                            if (errorData?.error?.message) {
                                errorMessage = `Gemini API error: ${errorData.error.message}`;
                            }
                        } catch (parseError) {
                            // ignore parse error, use default message
                        }
                        if (response.statusCode === 404) {
                            errorMessage +=
                                ' (verify your GEMINI_MODEL and GEMINI_API_VERSION environment variables match an available model)';
                        }
                        reject(new Error(errorMessage));
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
    const { rawText: rawResponse, model, usage: rawUsage } = await requestGeminiCompletion(prompt);

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
        usage: buildUsageStats('gemini', model, rawUsage),
    };
};

module.exports = {
    convertDescriptionToIsbn,
};
