require('dotenv').config();

const http = require('http');
const { URL } = require('url');
const searchService = require('./searchService');
const { getCaptchaConfig, verifyCaptchaToken } = require('./captchaService');
const { resolveProvider, normalizeProvider, PROVIDER_ALIASES } = require('./llmShared');

const DEFAULT_CATALOG_DOMAIN = 'https://catalog.library.tamu.edu';
const catalogDomain = (() => {
    const envValue = process.env.CATALOG_DOMAIN;
    if (typeof envValue !== 'string') {
        return DEFAULT_CATALOG_DOMAIN;
    }

    const normalized = envValue.trim().replace(/\/+$/, '');
    return normalized || DEFAULT_CATALOG_DOMAIN;
})();
const DEFAULT_DEBUG_MODE = false;

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return fallback;
        }

        if (['true', '1', 'yes', 'on'].includes(normalized)) {
            return true;
        }

        if (['false', '0', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }

    return fallback;
};

const debugMode = parseBoolean(process.env.DEBUG, DEFAULT_DEBUG_MODE);
const captchaConfig = getCaptchaConfig();
const defaultProvider = resolveProvider();
const providerOptions = Object.keys(PROVIDER_ALIASES).sort();

const RATE_LIMIT_MAX_REQUESTS = (() => {
    const parsed = Number(process.env.RATE_LIMIT_MAX_REQUESTS);
    return Number.isFinite(parsed) ? parsed : 30;
})();

const RATE_LIMIT_WINDOW_MS = (() => {
    const parsed = Number(process.env.RATE_LIMIT_WINDOW_MS);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }

    return 60_000;
})();

const RATE_LIMIT_ENABLED = RATE_LIMIT_MAX_REQUESTS > 0 && RATE_LIMIT_WINDOW_MS > 0;
const rateLimitState = new Map();
let lastRateLimitSweep = Date.now();

const getClientIdentifier = (req) => {
    const forwarded = req?.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        const [first] = forwarded.split(',');
        if (first && first.trim()) {
            return first.trim();
        }
    }

    const remoteAddress = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
    if (typeof remoteAddress === 'string' && remoteAddress) {
        return remoteAddress.replace(/^::ffff:/, '');
    }

    return 'unknown';
};

const sweepRateLimitState = (now) => {
    for (const [key, entry] of rateLimitState.entries()) {
        if (!entry || entry.reset <= now) {
            rateLimitState.delete(key);
        }
    }
};

const applyRateLimit = (clientId) => {
    if (!RATE_LIMIT_ENABLED) {
        return { limited: false };
    }

    const now = Date.now();
    if (now - lastRateLimitSweep > RATE_LIMIT_WINDOW_MS) {
        sweepRateLimitState(now);
        lastRateLimitSweep = now;
    }

    const entry = rateLimitState.get(clientId);
    if (!entry || entry.reset <= now) {
        const reset = now + RATE_LIMIT_WINDOW_MS;
        rateLimitState.set(clientId, { count: 1, reset });
        return {
            limited: false,
            remaining: Math.max(RATE_LIMIT_MAX_REQUESTS - 1, 0),
            reset,
        };
    }

    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
        const retryAfterSeconds = Math.max(Math.ceil((entry.reset - now) / 1000), 1);
        return {
            limited: true,
            remaining: 0,
            reset: entry.reset,
            retryAfterSeconds,
        };
    }

    entry.count += 1;
    return {
        limited: false,
        remaining: Math.max(RATE_LIMIT_MAX_REQUESTS - entry.count, 0),
        reset: entry.reset,
    };
};

const buildRateLimitHeaders = (status) => {
    if (!RATE_LIMIT_ENABLED) {
        return {};
    }

    const headers = {
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    };

    if (status && typeof status.remaining === 'number') {
        headers['X-RateLimit-Remaining'] = String(Math.max(status.remaining, 0));
    }

    if (status && typeof status.reset === 'number') {
        headers['X-RateLimit-Reset'] = String(Math.ceil(status.reset / 1000));
    }

    if (status && status.limited && status.retryAfterSeconds) {
        headers['Retry-After'] = String(status.retryAfterSeconds);
    }

    return headers;
};

const corsOrigins = (() => {
    const raw = process.env.CORS_ALLOWED_ORIGINS;
    if (typeof raw !== 'string' || !raw.trim()) {
        return new Set(['*']);
    }

    return new Set(raw.split(',').map((value) => value.trim()).filter(Boolean));
})();

const allowAllOrigins = corsOrigins.has('*');

const resolveCorsOrigin = (requestOrigin) => {
    if (allowAllOrigins) {
        return '*';
    }

    if (typeof requestOrigin !== 'string') {
        return null;
    }

    const normalized = requestOrigin.trim();
    if (!normalized) {
        return null;
    }

    return corsOrigins.has(normalized) ? normalized : null;
};

const appendVaryHeader = (res, value) => {
    const existing = res.getHeader('Vary');
    if (!existing) {
        res.setHeader('Vary', value);
        return;
    }

    const values = new Set(String(existing).split(',').map((entry) => entry.trim()).filter(Boolean));
    values.add(value);
    res.setHeader('Vary', Array.from(values).join(', '));
};

const applyCorsHeaders = (req, res) => {
    const origin = resolveCorsOrigin(req.headers?.origin);
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        if (origin !== '*') {
            appendVaryHeader(res, 'Origin');
        }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
};

const sendJson = (req, res, statusCode, payload, extraHeaders = {}) => {
    applyCorsHeaders(req, res);
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
    });
    res.statusCode = statusCode;
    res.end(JSON.stringify(payload));
};

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

const server = http.createServer(async (req, res) => {
    console.log(`Received request: ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS' && req.url.startsWith('/api/')) {
        applyCorsHeaders(req, res);
        res.setHeader('Content-Length', '0');
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url.startsWith('/api/')) {
        try {
            await handleApiRequest(req, res);
        } catch (error) {
            console.error('Unhandled API error:', error);
            sendJson(req, res, 500, { ok: false, error: 'Internal server error.' });
        }
        return;
    }

    sendJson(req, res, 404, { ok: false, error: 'Not found.' });
});

const port = process.env.PORT || 8000;
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
    console.log(`API listening at http://${host}:${port}`);
});
