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

module.exports = {
    applyCorsHeaders,
    appendVaryHeader,
    resolveCorsOrigin,
    sendJson,
};
