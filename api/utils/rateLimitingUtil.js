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

module.exports = {
    getClientIdentifier,
    applyRateLimit,
    buildRateLimitHeaders,
};
