const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const http = require('http');
const fs = require('fs');

const STATIC_ROOT = path.join(__dirname, 'public');
const DEFAULT_DOCUMENT = 'index.html';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const send = (req, res, statusCode, body, headers = {}) => {
  res.writeHead(statusCode, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

const sendPlainText = (req, res, statusCode, message) => {
  send(req, res, statusCode, message, { 'Content-Type': 'text/plain; charset=utf-8' });
};

const resolveRequestedPath = (requestUrl) => {
  try {
    const decoded = decodeURIComponent(requestUrl.split('?')[0]);
    const relativePath = decoded === '/' ? DEFAULT_DOCUMENT : decoded.replace(/^\/+/, '');
    const absolutePath = path.normalize(path.join(STATIC_ROOT, relativePath));
    if (!absolutePath.startsWith(STATIC_ROOT)) {
      return null;
    }
    return absolutePath;
  } catch (error) {
    return null;
  }
};

const serveFile = (filePath, req, res) => {
  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      if (statError.code === 'ENOENT') {
        sendPlainText(req, res, 404, 'Not found');
        return;
      }
      console.error('Static file stat error:', statError);
      sendPlainText(req, res, 500, 'Internal server error');
      return;
    }

    const targetPath = stats.isDirectory() ? path.join(filePath, DEFAULT_DOCUMENT) : filePath;

    fs.readFile(targetPath, (readError, content) => {
      if (readError) {
        if (readError.code === 'ENOENT') {
          sendPlainText(req, res, 404, 'Not found');
          return;
        }
        console.error('Static file read error:', readError);
        sendPlainText(req, res, 500, 'Internal server error');
        return;
      }

      const extname = path.extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[extname] || 'application/octet-stream';
      send(req, res, 200, content, { 'Content-Type': contentType });
    });
  });
};

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    sendPlainText(req, res, 200, 'ok');
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    sendPlainText(req, res, 405, 'Method not allowed');
    return;
  }

  const resolvedPath = resolveRequestedPath(req.url || '/');
  if (!resolvedPath) {
    sendPlainText(req, res, 400, 'Bad request');
    return;
  }

  serveFile(resolvedPath, req, res);
});

const port = Number.parseInt(process.env.CLIENT_PORT || process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

server.listen(port, host, () => {
  console.log(`Client static server listening at http://${host}:${port}`);
});
