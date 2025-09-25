const https = require('https');

const OPENAI_API_HOSTNAME = 'api.openai.com';
const OPENAI_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

const normalizeIsbn = (text) => {
    if (!text) {
        return null;
    }

    const compact = text.replace(/[^0-9Xx]/g, '');
    if (compact.length === 13 || compact.length === 10) {
        return compact.toUpperCase();
    }

    return null;
};

const requestChatCompletion = (messages) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set.');
    }

    const payload = JSON.stringify({
        model: DEFAULT_OPENAI_MODEL,
        messages,
        temperature: 0.2,
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
                            resolve(JSON.parse(body));
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

    const messages = [
        {
            role: 'system',
            content:
                `You are a bibliographic identifier. Given a short passage or description, return the most likely source works. Prefer canonical titles; include author, earliest publication year, language, and any standard identifiers you know (ISBN-10/13, OCLC, LCCN). Return a JSON array of candidates with confidence 0–1 and concise evidence (why).`,
        },
        {
            role: 'user',
            content: `Provide the most likely ISBN-13 for the book described below. If you are uncertain, respond with the word "UNKNOWN".\n\nDescription: ${trimmedDescription}`,
        },
    ];

    const completion = await requestChatCompletion(messages);
    const rawResponse = completion?.choices?.[0]?.message?.content?.trim();
    const isbn = normalizeIsbn(rawResponse);

    return {
        isbn,
        rawResponse,
        model: completion?.model || DEFAULT_OPENAI_MODEL,
    };
};

module.exports = {
    convertDescriptionToIsbn,
};
