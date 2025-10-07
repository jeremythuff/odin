require('dotenv').config();

const http = require('http');
const { applyCorsHeaders, sendJson } = require('./utils/headerUtils');
const { handleApiRequest } = require('./controllers/apiController');

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
