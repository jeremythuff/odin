const { URL } = require('url');
const searchService = require('../service/searchService');
const { getCaptchaConfig, verifyCaptchaToken } = require('../service/captchaService');
const { resolveProvider, normalizeProvider, PROVIDER_ALIASES } = require('../llmShared');
const { resolveCatalogDomain, resolveDebugMode } = require('../utils/configUtils');
const { sendJson } = require('../utils/headerUtils');
const {
    getClientIdentifier,
    applyRateLimit,
    buildRateLimitHeaders,
} = require('../utils/rateLimitingUtil');

const catalogDomain = resolveCatalogDomain();
const debugMode = resolveDebugMode();
const captchaConfig = getCaptchaConfig();
const defaultProvider = resolveProvider();
const providerOptions = Object.keys(PROVIDER_ALIASES).sort();

const collectRequestBody = (req) => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
        body += chunk.toString();
        if (body.length > 1_000_000) {
            const error = new Error('Request payload too large.');
            error.statusCode = 413;
            reject(error);
            req.destroy();
        }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
});

const handleSearchRequest = async (req, res) => {
    const clientId = getClientIdentifier(req);
    const rateLimitStatus = applyRateLimit(clientId);
    const rateLimitHeaders = buildRateLimitHeaders(rateLimitStatus);

    const respond = (statusCode, payload, extraHeaders = {}) => {
        sendJson(req, res, statusCode, payload, { ...rateLimitHeaders, ...extraHeaders });
    };

    if (rateLimitStatus.limited) {
        respond(429, { ok: false, error: 'Too many requests. Please wait a moment and try again.' });
        return;
    }

    const resolvePayload = async () => {
        if (req.method === 'GET') {
            const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            return {
                query: requestUrl.searchParams.get('q') || '',
                captchaToken: requestUrl.searchParams.get('captchaToken') || '',
                provider: requestUrl.searchParams.get('provider') || '',
            };
        }

        if (req.method === 'POST') {
            const body = await collectRequestBody(req);
            try {
                const parsed = JSON.parse(body || '{}');
                return {
                    query: typeof parsed.query === 'string' ? parsed.query : '',
                    captchaToken: typeof parsed.captchaToken === 'string' ? parsed.captchaToken : '',
                    provider: typeof parsed.provider === 'string' ? parsed.provider : '',
                };
            } catch (error) {
                if (error instanceof SyntaxError) {
                    throw Object.assign(new Error('Invalid JSON payload.'), { statusCode: 400 });
                }

                throw error;
            }
        }

        throw Object.assign(new Error('Method not allowed.'), { statusCode: 405 });
    };

    try {
        const payload = await resolvePayload();
        const normalizedQuery = (payload.query || '').trim();

        if (!normalizedQuery) {
            respond(422, { ok: false, query: '', error: 'A description or excerpt is required to perform the conversion.' });
            return;
        }

        if (captchaConfig.enabled) {
            const verification = await verifyCaptchaToken(payload.captchaToken, clientId);
            if (!verification.success) {
                respond(403, { ok: false, error: verification.error || 'Captcha verification failed.' });
                return;
            }
        }

        const requestedProvider = normalizeProvider(payload.provider);
        const searchOptions = requestedProvider ? { provider: requestedProvider } : undefined;

        const results = await searchService.performSearch(normalizedQuery, searchOptions);
        const statusCode = results.ok ? 200 : 502;
        respond(statusCode, results);
    } catch (error) {
        const statusCode = error.statusCode || 400;
        respond(statusCode, { ok: false, error: error.message || 'Unable to process the request.' });
    }
};

const handleApiRequest = async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = requestUrl;

    if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(req, res, 200, { ok: true, status: 'healthy' });
        return;
    }

    if (pathname === '/api/config' && req.method === 'GET') {
        sendJson(req, res, 200, {
            ok: true,
            catalogDomain,
            debug: debugMode,
            captcha: captchaConfig,
            provider: defaultProvider,
            providers: providerOptions,
        });
        return;
    }

    if (pathname === '/api/search') {
        await handleSearchRequest(req, res);
        return;
    }

    sendJson(req, res, 404, { ok: false, error: 'API route not found.' });
};

module.exports = {
    handleApiRequest,
};
