const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_API_BASE_URL = 'http://localhost:8000';

const resolveApiBaseUrl = () => {
  const candidate = process.env.API_BASE_URL;
  if (typeof candidate !== 'string') {
    return DEFAULT_API_BASE_URL;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  try {
    // Validate URL
    return new URL(trimmed).toString().replace(/\/$/, '');
  } catch (error) {
    console.warn(`Invalid API_BASE_URL provided (${candidate}). Falling back to ${DEFAULT_API_BASE_URL}.`);
    return DEFAULT_API_BASE_URL;
  }
};

const apiBaseUrl = resolveApiBaseUrl();
const targetPath = path.join(__dirname, '..', 'public', 'client-config.js');

const payload = {
  apiBaseUrl,
};

const content = `window.__ODIN_CLIENT_CONFIG__ = Object.freeze(${JSON.stringify(payload)});\n`;

fs.writeFileSync(targetPath, content);
console.log(`Generated client-config.js with API base URL: ${apiBaseUrl}`);
