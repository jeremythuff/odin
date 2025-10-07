const DEFAULT_CATALOG_DOMAIN = 'https://catalog.library.tamu.edu';
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

const resolveCatalogDomain = (value = process.env.CATALOG_DOMAIN) => {
    if (typeof value !== 'string') {
        return DEFAULT_CATALOG_DOMAIN;
    }

    const normalized = value.trim().replace(/\/+$/, '');
    return normalized || DEFAULT_CATALOG_DOMAIN;
};

const resolveDebugMode = (value = process.env.DEBUG) => parseBoolean(value, DEFAULT_DEBUG_MODE);

module.exports = {
    DEFAULT_CATALOG_DOMAIN,
    DEFAULT_DEBUG_MODE,
    parseBoolean,
    resolveCatalogDomain,
    resolveDebugMode,
};
