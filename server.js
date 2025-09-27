require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const searchService = require('./searchService');

const STATIC_ROOT = __dirname;
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

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
};

const sendJson = (res, statusCode, payload) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
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
    const resolveQuery = async () => {
        if (req.method === 'GET') {
            const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            return requestUrl.searchParams.get('q') || '';
        }

        if (req.method === 'POST') {
            const body = await collectRequestBody(req);
            try {
                const parsed = JSON.parse(body || '{}');
                return typeof parsed.query === 'string' ? parsed.query : '';
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
        const query = (await resolveQuery()) || '';
        const normalizedQuery = query.trim();

        if (!normalizedQuery) {
            sendJson(res, 422, { ok: false, query: '', error: 'A description or excerpt is required to perform the conversion.' });
            return;
        }

        const results = await searchService.performSearch(normalizedQuery);
        const statusCode = results.ok ? 200 : 502;
        sendJson(res, statusCode, results);
    } catch (error) {
        const statusCode = error.statusCode || 400;
        sendJson(res, statusCode, { ok: false, error: error.message || 'Unable to process the request.' });
    }
};

const handleApiRequest = async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { pathname } = requestUrl;

    if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, status: 'healthy' });
        return;
    }

    if (pathname === '/api/config' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, catalogDomain, debug: debugMode });
        return;
    }

    if (pathname === '/api/search') {
        await handleSearchRequest(req, res);
        return;
    }

    sendJson(res, 404, { ok: false, error: 'API route not found.' });
};

const serveStaticFile = (req, res) => {
    const requestPath = req.url.split('?')[0];
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const resolvedPath = path.normalize(path.join(STATIC_ROOT, relativePath));

    if (!resolvedPath.startsWith(STATIC_ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    const extname = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(resolvedPath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
                return;
            }

            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal server error');
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
    });
};

const server = http.createServer(async (req, res) => {
    console.log(`Received request: ${req.method} ${req.url}`);

    if (req.url.startsWith('/api/')) {
        try {
            await handleApiRequest(req, res);
        } catch (error) {
            console.error('Unhandled API error:', error);
            sendJson(res, 500, { ok: false, error: 'Internal server error.' });
        }
        return;
    }

    serveStaticFile(req, res);
});

const port = process.env.PORT || 8000;
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
    console.log(`Serving / at http://${host}:${port}`);
});
