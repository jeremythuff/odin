const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const assignIfPresent = (target, key, rawValue) => {
  const value = normalizeString(rawValue ?? '');
  if (!value) {
    return;
  }

  target[key] = value;
};

const targetPath = path.join(__dirname, '..', 'public', 'client-config.js');
const payload = {};

assignIfPresent(payload, 'apiBaseUrl', process.env.API_BASE_URL);
assignIfPresent(payload, 'apiProtocol', process.env.API_PROTOCOL);
assignIfPresent(payload, 'apiHost', process.env.API_HOST);
assignIfPresent(payload, 'apiPort', process.env.API_PORT);

const content = `window.__ODIN_CLIENT_CONFIG__ = Object.freeze(${JSON.stringify(payload)});\n`;

fs.writeFileSync(targetPath, content);
console.log('Generated client-config.js with settings:', payload);
