const searchBox = document.getElementById('search-box');
const searchSubmitButton = document.getElementById('search-submit');
const resultsContainer = document.getElementById('results-container');
const configButton = document.getElementById('config-button');
const configMenu = document.getElementById('config-menu');
const configForm = document.getElementById('config-form');
const configCatalogInput = document.getElementById('config-catalog-domain');
const configProviderSelect = document.getElementById('config-provider');
const configStatus = document.getElementById('config-status');
const configDebugInput = document.getElementById('config-debug');
const configResetButton = document.getElementById('config-reset');
const captchaContainer = document.getElementById('captcha-container');

const escapeHtml = (value = '') => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char));

const showResultsContainer = () => {
    if (!resultsContainer) {
        return;
    }

    resultsContainer.classList.remove('results-container--hidden');
};

const hideResultsContainer = () => {
    if (!resultsContainer) {
        return;
    }

    resultsContainer.classList.add('results-container--hidden');
};

const DEFAULT_CATALOG_DOMAIN = 'https://catalog.library.tamu.edu';
let catalogDomain = DEFAULT_CATALOG_DOMAIN;
let serverCatalogDomain = DEFAULT_CATALOG_DOMAIN;
let lastRenderedPayload = null;
let isConfigMenuOpen = false;
const DEFAULT_DEBUG_MODE = false;
let debugMode = DEFAULT_DEBUG_MODE;
let serverDebugMode = DEFAULT_DEBUG_MODE;
let lastCatalogResultsUrl = null;

const PROVIDER_LABELS = {
    openai: 'OpenAI (ChatGPT)',
    claude: 'Claude',
    gemini: 'Gemini',
};

const DEFAULT_PROVIDER = 'openai';
let availableProviders = new Set(Object.keys(PROVIDER_LABELS));
let llmProvider = DEFAULT_PROVIDER;
let serverProvider = DEFAULT_PROVIDER;

const DEFAULT_CAPTCHA_CONFIG = { enabled: false, provider: null, siteKey: null };
let captchaConfigState = { ...DEFAULT_CAPTCHA_CONFIG };
let captchaToken = null;
let captchaApi = null;
let captchaWidgetId = null;
let captchaReady = false;
let captchaLoadPromise = null;
let captchaError = null;
let captchaPassiveMode = false;
let pendingCaptchaTokenPromise = null;
const captchaTokenWaiters = [];

if (captchaContainer) {
    captchaContainer.hidden = true;
}

const CONFIG_STORAGE_KEY = 'odin:clientConfig';

const setCatalogDomain = (value) => {
    if (typeof value !== 'string') {
        return catalogDomain;
    }

    const normalized = value.trim().replace(/\/+$/, '');
    if (!normalized) {
        return catalogDomain;
    }

    catalogDomain = normalized;
    return catalogDomain;
};

const getCatalogResultsBaseUrl = () => `${catalogDomain}/Search/Results`;

const normalizeBoolean = (value, fallback = false) => {
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

const getProviderLabel = (value) => {
    if (!value) {
        return '';
    }

    const normalized = value.trim().toLowerCase();
    if (PROVIDER_LABELS[normalized]) {
        return PROVIDER_LABELS[normalized];
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const normalizeProviderValue = (value, fallback = DEFAULT_PROVIDER) => {
    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return fallback;
    }

    if (availableProviders.has(normalized)) {
        return normalized;
    }

    return fallback;
};

function setProvider(value, options = {}) {
    const { fallback = DEFAULT_PROVIDER, updateSelect = true } = options;
    const normalized = normalizeProviderValue(value, fallback);
    llmProvider = normalized;

    if (updateSelect && configProviderSelect) {
        configProviderSelect.value = normalized;
    }

    return llmProvider;
}

const ensureProviderOptions = (providers = [], ensureValues = []) => {
    const unique = [];
    const addValue = (candidate) => {
        if (typeof candidate !== 'string') {
            return;
        }

        const normalized = candidate.trim().toLowerCase();
        if (!normalized || unique.includes(normalized)) {
            return;
        }

        unique.push(normalized);
    };

    if (Array.isArray(providers)) {
        providers.forEach(addValue);
    }

    ensureValues.forEach(addValue);

    if (!unique.length) {
        unique.push(DEFAULT_PROVIDER);
    }

    availableProviders = new Set(unique);

    if (configProviderSelect) {
        const fragment = document.createDocumentFragment();
        unique.forEach((provider) => {
            const option = document.createElement('option');
            option.value = provider;
            option.textContent = getProviderLabel(provider);
            fragment.appendChild(option);
        });

        configProviderSelect.innerHTML = '';
        configProviderSelect.appendChild(fragment);
        if (!availableProviders.has(llmProvider)) {
            setProvider(unique[0] || DEFAULT_PROVIDER);
        } else {
            configProviderSelect.value = llmProvider;
        }
    }
};

const setDebugMode = (value) => {
    debugMode = value;
    if (configDebugInput) {
        configDebugInput.checked = debugMode;
    }
    refreshResults();
    return debugMode;
};

const applyDebugMode = (value, options = {}) => {
    const { fallback = DEFAULT_DEBUG_MODE } = options;
    const normalized = normalizeBoolean(value, fallback);
    return setDebugMode(normalized);
};

const loadCaptchaScript = () => {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Captcha is unavailable in this environment.'));
    }

    if (window.hcaptcha) {
        return Promise.resolve(window.hcaptcha);
    }

    if (captchaLoadPromise) {
        return captchaLoadPromise;
    }

    captchaLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = () => {
            if (window.hcaptcha) {
                resolve(window.hcaptcha);
            } else {
                reject(new Error('Captcha API failed to load.'));
            }
        };
        script.onerror = () => reject(new Error('Unable to load the captcha script.'));
        document.head.appendChild(script);
    });

    return captchaLoadPromise;
};

const resolveCaptchaTokenWaiters = (token) => {
    if (!captchaTokenWaiters.length) {
        return;
    }

    const waiters = captchaTokenWaiters.splice(0, captchaTokenWaiters.length);
    waiters.forEach((waiter) => {
        try {
            waiter.resolve(token);
        } catch (error) {
            console.error('Error resolving captcha waiter:', error);
        }
    });
};

const rejectCaptchaTokenWaiters = (reason) => {
    if (!captchaTokenWaiters.length) {
        return;
    }

    const waiters = captchaTokenWaiters.splice(0, captchaTokenWaiters.length);
    waiters.forEach((waiter) => {
        try {
            waiter.reject(reason);
        } catch (error) {
            console.error('Error rejecting captcha waiter:', error);
        }
    });
};

const enterCaptchaPassiveMode = () => {
    if (captchaPassiveMode) {
        return;
    }

    const activatePassive = () => {
        captchaPassiveMode = true;
        if (captchaContainer) {
            captchaContainer.hidden = false;
            captchaContainer.classList.add('captcha-container--passive');
        }
    };

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(activatePassive, 500);
    } else {
        activatePassive();
    }
};

const requestCaptchaToken = () => {
    if (!captchaConfigState.enabled) {
        return Promise.resolve('');
    }

    if (captchaToken) {
        return Promise.resolve(captchaToken);
    }

    if (pendingCaptchaTokenPromise) {
        return pendingCaptchaTokenPromise;
    }

    if (!captchaApi || typeof captchaApi.execute !== 'function' || captchaWidgetId === null) {
        return Promise.reject(new Error('Captcha is not ready yet.'));
    }

    pendingCaptchaTokenPromise = new Promise((resolve, reject) => {
        const waiter = {
            resolve: (value) => {
                pendingCaptchaTokenPromise = null;
                resolve(value);
            },
            reject: (error) => {
                pendingCaptchaTokenPromise = null;
                reject(error);
            },
        };

        captchaTokenWaiters.push(waiter);

        try {
            if (captchaPassiveMode && typeof captchaApi.reset === 'function') {
                captchaApi.reset(captchaWidgetId);
            }
            captchaApi.execute(captchaWidgetId);
        } catch (error) {
            const index = captchaTokenWaiters.indexOf(waiter);
            if (index >= 0) {
                captchaTokenWaiters.splice(index, 1);
            }
            pendingCaptchaTokenPromise = null;
            reject(error);
        }
    });

    return pendingCaptchaTokenPromise;
};

const ensureCaptchaToken = async () => {
    if (!captchaConfigState.enabled) {
        return '';
    }

    if (captchaToken) {
        return captchaToken;
    }

    if (!captchaPassiveMode) {
        return null;
    }

    const token = await requestCaptchaToken();
    return token;
};

const disableCaptcha = () => {
    if (captchaApi && typeof captchaApi.remove === 'function' && captchaWidgetId !== null) {
        try {
            captchaApi.remove(captchaWidgetId);
        } catch (error) {
            console.warn('Unable to remove captcha widget:', error);
        }
    }

    captchaConfigState = { ...DEFAULT_CAPTCHA_CONFIG };
    captchaToken = null;
    captchaApi = null;
    captchaWidgetId = null;
    captchaReady = false;
    captchaLoadPromise = null;
    captchaError = null;
    captchaPassiveMode = false;
    pendingCaptchaTokenPromise = null;
    rejectCaptchaTokenWaiters(new Error('Captcha disabled.'));

    if (captchaContainer) {
        captchaContainer.hidden = true;
        captchaContainer.innerHTML = '';
        captchaContainer.classList.remove('captcha-container--passive');
    }
};

const renderCaptchaWidget = async (config) => {
    if (!captchaContainer) {
        console.warn('Captcha container element not found.');
        return;
    }

    captchaContainer.hidden = false;
    captchaContainer.innerHTML = '';
    captchaContainer.classList.remove('captcha-container--passive');
    captchaPassiveMode = false;
    pendingCaptchaTokenPromise = null;
    rejectCaptchaTokenWaiters(new Error('Captcha widget reinitializing.'));

    try {
        const api = await loadCaptchaScript(config.siteKey);
        captchaApi = api;
        captchaWidgetId = api.render(captchaContainer, {
            sitekey: config.siteKey,
            callback: (token) => {
                captchaToken = token;
                resolveCaptchaTokenWaiters(token);
                if (token) {
                    enterCaptchaPassiveMode();
                }
            },
            'expired-callback': () => {
                captchaToken = null;
                rejectCaptchaTokenWaiters(new Error('Captcha expired.'));
            },
            'error-callback': () => {
                captchaToken = null;
                rejectCaptchaTokenWaiters(new Error('Captcha error.'));
            },
        });
        captchaReady = true;
        captchaError = null;
    } catch (error) {
        captchaReady = false;
        captchaError = 'Captcha unavailable. Please refresh the page.';
        captchaContainer.innerHTML = `<p class="captcha-error">${escapeHtml(captchaError)}</p>`;
        console.error('Unable to initialize captcha widget:', error);
    }
};

const applyCaptchaConfig = async (config) => {
    const enabled = Boolean(config && config.enabled && config.siteKey);
    const provider = (config && typeof config.provider === 'string'
        ? config.provider.trim().toLowerCase()
        : '');

    if (!enabled || provider !== 'hcaptcha') {
        if (enabled && provider && provider !== 'hcaptcha') {
            console.warn(`Unsupported captcha provider: ${provider}`);
        }
        disableCaptcha();
        return;
    }

    if (captchaConfigState.enabled && captchaConfigState.siteKey === config.siteKey) {
        return;
    }

    disableCaptcha();
    captchaConfigState = { enabled: true, provider: 'hcaptcha', siteKey: config.siteKey };
    await renderCaptchaWidget(captchaConfigState);
};

const resetCaptcha = () => {
    if (!captchaConfigState.enabled) {
        return;
    }

    captchaToken = null;

    if (captchaPassiveMode) {
        return;
    }

    if (captchaApi && typeof captchaApi.reset === 'function' && captchaWidgetId !== null) {
        captchaApi.reset(captchaWidgetId);
    }
};

const buildCandidateSearchEntries = (candidate) => {
    if (!candidate) {
        return [];
    }

    const entries = [];

    const title = candidate.title || candidate.identifiers?.title;
    if (title) {
        entries.push({ value: title, type: 'Title' });
    }

    const author = (() => {
        if (Array.isArray(candidate.authors) && candidate.authors.length) {
            return candidate.authors[0];
        }

        const identifiersAuthor = candidate.identifiers?.author;
        if (typeof identifiersAuthor === 'string' && identifiersAuthor.trim()) {
            return identifiersAuthor.split(',')[0].trim();
        }

        return null;
    })();
    if (author) {
        entries.push({ value: author, type: 'Author' });
    }

    const yearValue = candidate.year || candidate.identifiers?.yearOfPublication;
    if (yearValue) {
        entries.push({ value: String(yearValue), type: 'year' });
    }

    const isbnValue = candidate.identifiers?.isbn13 || candidate.identifiers?.isbn10;
    if (isbnValue) {
        entries.push({ value: isbnValue, type: 'ISN' });
    }

    return entries;
};

const applySearchEntriesToParams = (params, entries, groupIndex = 0) => {
    if (!entries.length) {
        return false;
    }

    entries.forEach(({ value, type }) => {
        if (!value) {
            return;
        }

        params.append(`lookfor${groupIndex}[]`, value);
        params.append(`type${groupIndex}[]`, type);
    });

    params.append(`bool${groupIndex}[]`, 'OR');
    return true;
};

const finalizeCatalogParams = (params) => {
    params.set('illustration', '-1');
    params.append('daterange[]', 'publishDate');
    params.set('publishDatefrom', '');
    params.set('publishDateto', '');
    return params;
};

const buildCatalogResultsUrl = (candidates = []) => {
    if (!Array.isArray(candidates) || !candidates.length) {
        return null;
    }

    const baseUrl = getCatalogResultsBaseUrl();
    const params = new URLSearchParams();
    params.set('join', 'OR');

    let groupIndex = 0;

    candidates.forEach((candidate) => {
        const entries = buildCandidateSearchEntries(candidate);
        if (!entries.length) {
            return;
        }

        const applied = applySearchEntriesToParams(params, entries, groupIndex);
        if (applied) {
            groupIndex += 1;
        }
    });

    if (groupIndex === 0) {
        return null;
    }

    finalizeCatalogParams(params);

    return `${baseUrl}?${params.toString()}`;
};

const buildCandidateCatalogUrl = (candidate) => {
    const entries = buildCandidateSearchEntries(candidate);
    if (!entries.length) {
        return null;
    }

    const baseUrl = getCatalogResultsBaseUrl();
    const params = new URLSearchParams();
    params.set('join', 'OR');

    const applied = applySearchEntriesToParams(params, entries, 0);
    if (!applied) {
        return null;
    }

    finalizeCatalogParams(params);

    return `${baseUrl}?${params.toString()}`;
};

const formatConfidence = (confidence) => {
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
        return null;
    }

    return `${Math.round(confidence * 100)}%`;
};

const formatInteger = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }

    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const formatCurrencyValue = (value, currency = 'USD') => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }

    try {
        return value.toLocaleString(undefined, {
            style: 'currency',
            currency,
            minimumFractionDigits: value >= 1 ? 2 : 4,
            maximumFractionDigits: 6,
        });
    } catch (error) {
        const decimals = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
        const formattedValue = value.toFixed(decimals);
        if (currency === 'USD') {
            return `$${formattedValue}`;
        }
        return `${currency} ${formattedValue}`;
    }
};

const formatUsageTokens = (usage) => {
    if (!usage || typeof usage !== 'object') {
        return '';
    }

    const parts = [];

    const prompt = formatInteger(usage.promptTokens);
    if (prompt) {
        parts.push(`Prompt ${prompt}`);
    }

    const completion = formatInteger(usage.completionTokens);
    if (completion) {
        parts.push(`Completion ${completion}`);
    }

    const total = formatInteger(usage.totalTokens);
    if (total) {
        const includeTotal = (() => {
            if (prompt && completion) {
                return true;
            }

            if (!prompt && !completion) {
                return true;
            }

            if (prompt && !completion) {
                return total !== prompt;
            }

            if (!prompt && completion) {
                return total !== completion;
            }

            return true;
        })();

        if (includeTotal) {
            parts.push(`Total ${total}`);
        }
    }

    return parts.join(' | ');
};

const formatUsageCost = (usage) => {
    if (!usage || typeof usage !== 'object' || !usage.cost || typeof usage.cost !== 'object') {
        return '';
    }

    const currency = typeof usage.cost.currency === 'string' && usage.cost.currency.trim()
        ? usage.cost.currency.trim().toUpperCase()
        : 'USD';

    const total = formatCurrencyValue(usage.cost.total, currency);
    const prompt = formatCurrencyValue(usage.cost.prompt, currency);
    const completion = formatCurrencyValue(usage.cost.completion, currency);

    const parts = [];

    if (total) {
        parts.push(`Total ${total}`);
    }

    if (prompt) {
        parts.push(`Prompt ${prompt}`);
    }

    if (completion) {
        parts.push(`Completion ${completion}`);
    }

    return parts.join(' | ');
};

const formatIdentifiers = (identifiers = {}) => {
    const labelMap = [
        ['title', 'Title'],
        ['author', 'Author'],
        ['yearOfPublication', 'Year of Publication'],
        ['isbn13', 'ISBN-13'],
        ['isbn10', 'ISBN-10'],
        ['issn', 'ISSN'],
        ['eIssn', 'E-ISSN'],
        ['publisher', 'Publisher'],
        ['series', 'Series'],
    ];

    const items = labelMap
        .map(([key, label]) => {
            const value = identifiers[key];
            if (value === null || value === undefined || value === '') {
                return null;
            }

            return `<li>${label}: ${escapeHtml(String(value))}</li>`;
        })
        .filter(Boolean);

    return items.length ? `<ul class="candidate-card__identifiers">${items.join('')}</ul>` : '';
};

const formatMetaItem = (label, value) => {
    if (!value) {
        return '';
    }

    return `
        <div class="candidate-card__meta-item">
            <span class="candidate-card__meta-label">${label}</span>
            <span class="candidate-card__meta-value">${value}</span>
        </div>
    `;
};

const formatCandidateHtml = (candidate, index) => {
    const title = candidate.title ? escapeHtml(candidate.title) : '';
    const authors = candidate.authors && candidate.authors.length
        ? escapeHtml(candidate.authors.join(', '))
        : '';
    const year = candidate.year ? escapeHtml(String(candidate.year)) : '';
    const language = candidate.language ? escapeHtml(candidate.language) : '';
    const identifiers = formatIdentifiers(candidate.identifiers || {});
    const confidence = formatConfidence(candidate.confidence);
    const evidence = candidate.evidence ? escapeHtml(candidate.evidence) : '';
    const candidateCatalogUrl = buildCandidateCatalogUrl(candidate);

    const meta = [
        formatMetaItem('Year', year),
        formatMetaItem('Language', language),
    ].filter(Boolean).join('');

    const catalogLink = candidateCatalogUrl
        ? `
            <div class="candidate-card__footer">
                <a class="candidate-card__catalog-link" href="${escapeHtml(candidateCatalogUrl)}" target="_blank" rel="noopener noreferrer">
                    Search this candidate in catalog
                </a>
            </div>
        `
        : '';

    return `
        <li class="candidate-card">
            <div class="candidate-card__header">
                <span class="candidate-card__rank">#${index + 1}</span>
                <div class="candidate-card__heading">
                    ${title ? `<h3 class="candidate-card__title">${title}</h3>` : ''}
                    ${authors ? `<p class="candidate-card__authors">${authors}</p>` : ''}
                </div>
                ${confidence ? `<span class="candidate-card__confidence">${escapeHtml(confidence)}</span>` : ''}
            </div>
            ${meta ? `<div class="candidate-card__meta">${meta}</div>` : ''}
            ${identifiers}
            ${evidence ? `<p class="candidate-card__evidence">${evidence}</p>` : ''}
            ${catalogLink}
        </li>
    `;
};

const renderResult = (payload) => {
    lastCatalogResultsUrl = null;

    if (!payload || typeof payload !== 'object') {
        return '<p class="error">No response received from server.</p>';
    }

    if (!payload.ok) {
        const message = payload.error ? escapeHtml(payload.error) : 'Unable to process the request.';
        return `<p class="error">${message}</p>`;
    }

    const { query, result, rawResponse } = payload;
    const sections = [];
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    const catalogResultsUrl = buildCatalogResultsUrl(candidates);
    if (catalogResultsUrl) {
        lastCatalogResultsUrl = catalogResultsUrl;
    }

    const summaryItems = [];
    if (query) {
        summaryItems.push(`
            <div class="result-summary__item result-summary__item--query">
                <div class="result-summary__item-header">
                    <span class="result-summary__label">Query</span>
                    <button type="button" class="result-summary__refine">Refine</button>
                </div>
                <span class="result-summary__value">${escapeHtml(query)}</span>
            </div>
        `);
    }

    if (catalogResultsUrl) {
        summaryItems.push(`
            <div class="result-summary__item">
                <span class="result-summary__label">SEARCH IN CATALOG</span>
                <span class="result-summary__value"><a href="${escapeHtml(catalogResultsUrl)}" target="_blank" rel="noopener noreferrer">Catalog Results</a></span>
            </div>
        `);
    }

    if (result?.model) {
        summaryItems.push(`
            <div class="result-summary__item">
                <span class="result-summary__label">Model</span>
                <span class="result-summary__value">${escapeHtml(result.model)}</span>
            </div>
        `);
    }

    if (result?.usage) {
        const tokensSummary = formatUsageTokens(result.usage);
        if (tokensSummary) {
            summaryItems.push(`
                <div class="result-summary__item">
                    <span class="result-summary__label">Tokens</span>
                    <span class="result-summary__value">${escapeHtml(tokensSummary)}</span>
                </div>
            `);
        }

        const costSummary = formatUsageCost(result.usage);
        if (costSummary) {
            summaryItems.push(`
                <div class="result-summary__item">
                    <span class="result-summary__label">Estimated Cost</span>
                    <span class="result-summary__value">${escapeHtml(costSummary)}</span>
                </div>
            `);
        }
    }

    if (summaryItems.length) {
        sections.push(`<div class="result-summary">${summaryItems.join('')}</div>`);
    }

    if (candidates.length) {
        const items = candidates
            .map((candidate, index) => formatCandidateHtml(candidate, index))
            .join('');
        sections.push(`<ol class="candidate-list">${items}</ol>`);
    } else if (rawResponse) {
        sections.push(`
            <details class="result-raw">
                <summary>View raw AI response</summary>
                <pre class="result-raw__content">${escapeHtml(rawResponse)}</pre>
            </details>
        `);
    }

    return sections.join('\n');
};

function updateConfigStatus(message = '', variant = 'info') {
    if (!configStatus) {
        return;
    }

    configStatus.textContent = message;
    if (variant === 'error') {
        configStatus.classList.add('config-menu__status--error');
    } else {
        configStatus.classList.remove('config-menu__status--error');
    }
}

function refreshResults() {
    if (!resultsContainer || !lastRenderedPayload) {
        return;
    }

    if (!debugMode) {
        hideResultsContainer();
        resultsContainer.innerHTML = '';
        return;
    }

    const rendered = renderResult(lastRenderedPayload);
    showResultsContainer();
    resultsContainer.innerHTML = rendered;
}

function getStoredConfig() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }

    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Unable to parse stored configuration:', error);
        return null;
    }
}

function saveStoredConfig(config) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return false;
    }

    try {
        window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
        return true;
    } catch (error) {
        console.error('Unable to persist configuration:', error);
        return false;
    }
}

function clearStoredConfig() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return false;
    }

    try {
        window.localStorage.removeItem(CONFIG_STORAGE_KEY);
        return true;
    } catch (error) {
        console.error('Unable to clear stored configuration:', error);
        return false;
    }
}

function applyCatalogDomain(value, options = {}) {
    const { refresh = true } = options;
    const applied = setCatalogDomain(value);

    if (configCatalogInput) {
        configCatalogInput.value = catalogDomain;
    }

    if (refresh) {
        refreshResults();
    }

    return applied;
}

function handlePostSearchRedirect() {
    if (debugMode || !lastCatalogResultsUrl || typeof window === 'undefined') {
        return;
    }

    try {
        window.location.assign(lastCatalogResultsUrl);
    } catch (error) {
        window.location.href = lastCatalogResultsUrl;
    }
}

hideResultsContainer();

function openConfigMenu() {
    if (!configMenu || isConfigMenuOpen) {
        return;
    }

    configMenu.hidden = false;
    isConfigMenuOpen = true;
    if (configButton) {
        configButton.setAttribute('aria-expanded', 'true');
    }

    updateConfigStatus('');

    document.addEventListener('click', handleOutsideClick, true);
    document.addEventListener('keydown', handleEscapeKey, true);

    if (configCatalogInput) {
        const focusInput = () => {
            configCatalogInput.focus();
            configCatalogInput.select();
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(focusInput);
        } else {
            setTimeout(focusInput, 0);
        }
    }
}

function closeConfigMenu() {
    if (!configMenu || !isConfigMenuOpen) {
        return;
    }

    configMenu.hidden = true;
    isConfigMenuOpen = false;
    if (configButton) {
        configButton.setAttribute('aria-expanded', 'false');
    }

    document.removeEventListener('click', handleOutsideClick, true);
    document.removeEventListener('keydown', handleEscapeKey, true);
}

function handleOutsideClick(event) {
    if (!configMenu || configMenu.hidden || !configButton) {
        return;
    }

    const target = event.target;
    if (configMenu.contains(target) || configButton.contains(target)) {
        return;
    }

    closeConfigMenu();
}

function handleEscapeKey(event) {
    if (event.key !== 'Escape') {
        return;
    }

    closeConfigMenu();
    if (configButton) {
        configButton.focus();
    }
}

function toggleConfigMenu() {
    if (isConfigMenuOpen) {
        closeConfigMenu();
        return;
    }

    openConfigMenu();
}

const performSearch = async () => {
    const query = searchBox.value.trim();
    lastRenderedPayload = null;
    lastCatalogResultsUrl = null;

    if (!query) {
        showResultsContainer();
        resultsContainer.innerHTML = '<p class="error">Please enter a description before searching.</p>';
        lastRenderedPayload = null;
        lastCatalogResultsUrl = null;
        return;
    }

    if (captchaConfigState.enabled) {
        if (captchaError) {
            showResultsContainer();
            resultsContainer.innerHTML = `<p class="error">${escapeHtml(captchaError)}</p>`;
            return;
        }

        if (!captchaReady) {
            showResultsContainer();
            resultsContainer.innerHTML = '<p class="error">Captcha is still loading. Please try again in a moment.</p>';
            return;
        }

        if (!captchaToken && captchaPassiveMode) {
            try {
                await ensureCaptchaToken();
            } catch (error) {
                showResultsContainer();
                resultsContainer.innerHTML = `<p class="error">${escapeHtml(
                    error.message || 'Captcha is unavailable. Please try again later.'
                )}</p>`;
                return;
            }
        }

        if (!captchaToken) {
            showResultsContainer();
            resultsContainer.innerHTML = '<p class="error">Please complete the captcha challenge before searching.</p>';
            return;
        }
    }

    searchBox.value = '';

    showResultsContainer();
    resultsContainer.innerHTML = `
        <div class="result-loading" role="status" aria-live="polite">
            <span class="result-loading__spinner" aria-hidden="true"></span>
            <span class="result-loading__text">Searching…</span>
        </div>
    `;
    lastRenderedPayload = null;
    lastCatalogResultsUrl = null;

    const payloadBody = { query, provider: llmProvider };
    const captchaTokenToSend = captchaConfigState.enabled ? captchaToken : '';
    if (captchaConfigState.enabled && captchaTokenToSend) {
        payloadBody.captchaToken = captchaTokenToSend;
    }

    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payloadBody),
        });

        const isJsonResponse = response.headers.get('content-type')?.includes('application/json');
        const payload = isJsonResponse ? await response.json() : null;

        if (!response.ok) {
            const message = payload?.error || `HTTP error! status: ${response.status}`;
            showResultsContainer();
            resultsContainer.innerHTML = `<p class="error">${escapeHtml(message)}</p>`;
            lastRenderedPayload = null;
            lastCatalogResultsUrl = null;
            return;
        }

        const renderedResult = renderResult(payload);
        lastRenderedPayload = payload;

        if (!debugMode) {
            if (lastCatalogResultsUrl) {
                hideResultsContainer();
                if (resultsContainer) {
                    resultsContainer.innerHTML = '';
                }
                handlePostSearchRedirect();
                return;
            }

            showResultsContainer();
            resultsContainer.innerHTML = '<p class="error">Unable to redirect to the catalog for this search.</p>';
            return;
        }

        showResultsContainer();
        resultsContainer.innerHTML = renderedResult;
    } catch (error) {
        showResultsContainer();
        resultsContainer.innerHTML = `<p class="error">Error performing search: ${escapeHtml(error.message)}</p>`;
        console.error('There was a problem with the fetch operation:', error);
        lastRenderedPayload = null;
        lastCatalogResultsUrl = null;
    } finally {
        if (captchaConfigState.enabled) {
            resetCaptcha();
        }
    }
};

const initializeConfig = async () => {
    applyCatalogDomain(catalogDomain, { refresh: false });
    applyDebugMode(debugMode, { fallback: DEFAULT_DEBUG_MODE });

    let fetchedCatalogDomain = catalogDomain;
    let fetchedDebugMode = debugMode;

    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const payload = await response.json();
            if (payload?.ok) {
                if (payload.catalogDomain) {
                    fetchedCatalogDomain = payload.catalogDomain;
                }

                if (payload.debug !== undefined) {
                    fetchedDebugMode = normalizeBoolean(payload.debug, DEFAULT_DEBUG_MODE);
                }

                ensureProviderOptions(Array.isArray(payload.providers) ? payload.providers : [], [payload.provider, DEFAULT_PROVIDER]);
                const appliedProvider = setProvider(payload.provider, { fallback: DEFAULT_PROVIDER });
                serverProvider = appliedProvider;

                await applyCaptchaConfig(payload.captcha);
            } else {
                ensureProviderOptions([], [DEFAULT_PROVIDER]);
                setProvider(DEFAULT_PROVIDER);
                serverProvider = DEFAULT_PROVIDER;
                await applyCaptchaConfig(null);
            }
        } else {
            ensureProviderOptions([], [DEFAULT_PROVIDER]);
            setProvider(DEFAULT_PROVIDER);
            serverProvider = DEFAULT_PROVIDER;
            await applyCaptchaConfig(null);
        }
    } catch (error) {
        console.error('Unable to load configuration:', error);
        ensureProviderOptions([], [DEFAULT_PROVIDER]);
        setProvider(DEFAULT_PROVIDER);
        serverProvider = DEFAULT_PROVIDER;
        await applyCaptchaConfig(null);
    }

    const appliedDomain = applyCatalogDomain(fetchedCatalogDomain, { refresh: false });
    serverCatalogDomain = appliedDomain || DEFAULT_CATALOG_DOMAIN;

    const appliedDebug = applyDebugMode(fetchedDebugMode, { fallback: DEFAULT_DEBUG_MODE });
    serverDebugMode = appliedDebug;

    const stored = getStoredConfig();
    if (stored) {
        if (stored.catalogDomain) {
            applyCatalogDomain(stored.catalogDomain, { refresh: false });
        }

        if (Object.prototype.hasOwnProperty.call(stored, 'debug')) {
            applyDebugMode(stored.debug, { fallback: serverDebugMode });
        }

        if (stored.provider) {
            setProvider(stored.provider, { fallback: serverProvider });
        }
    }
};

searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        performSearch();
    }
});

if (searchSubmitButton) {
    searchSubmitButton.addEventListener('click', (event) => {
        event.preventDefault();
        performSearch();
    });
}

if (resultsContainer) {
    resultsContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (target && target.classList.contains('result-summary__refine')) {
            event.preventDefault();

            if (searchBox && lastRenderedPayload && typeof lastRenderedPayload.query === 'string') {
                searchBox.value = lastRenderedPayload.query;
                searchBox.focus();
            }
        }
    });
}

if (configButton && configMenu) {
    configButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleConfigMenu();
    });
}

if (configMenu) {
    configMenu.addEventListener('click', (event) => {
        event.stopPropagation();
    });
}

if (configProviderSelect) {
    configProviderSelect.addEventListener('change', (event) => {
        const selected = typeof event.target.value === 'string' ? event.target.value : llmProvider;
        setProvider(selected, { fallback: llmProvider, updateSelect: false });
    });
}

if (configForm) {
    configForm.addEventListener('submit', (event) => {
        event.preventDefault();

        if (!configCatalogInput) {
            return;
        }

        const rawValue = configCatalogInput.value.trim();
        if (!rawValue) {
            updateConfigStatus('Please enter a catalog domain.', 'error');
            return;
        }

        let candidate = rawValue;
        if (!/^https?:\/\//i.test(candidate)) {
            candidate = `https://${candidate}`;
        }

        let normalized;
        try {
            const parsed = new URL(candidate);
            const sanitizedPath = parsed.pathname.replace(/\/+$/, '');
            normalized = `${parsed.origin}${sanitizedPath}`;
        } catch (error) {
            updateConfigStatus('Enter a valid URL (example: https://catalog.example.edu).', 'error');
            return;
        }

        const appliedDomain = applyCatalogDomain(normalized);
        const appliedDebug = applyDebugMode(configDebugInput ? configDebugInput.checked : debugMode, { fallback: debugMode });
        const selectedProvider = configProviderSelect ? configProviderSelect.value : llmProvider;
        const appliedProvider = setProvider(selectedProvider, { fallback: llmProvider });

        const persisted = saveStoredConfig({ catalogDomain: appliedDomain, debug: appliedDebug, provider: appliedProvider });

        if (persisted) {
            updateConfigStatus('Configuration updated.');
        } else {
            updateConfigStatus('Configuration updated for this session.');
        }
    });
}

if (configResetButton) {
    configResetButton.addEventListener('click', (event) => {
        event.preventDefault();

        const cleared = clearStoredConfig();
        applyCatalogDomain(serverCatalogDomain);
        applyDebugMode(serverDebugMode, { fallback: DEFAULT_DEBUG_MODE });
        setProvider(serverProvider);

        if (cleared) {
            updateConfigStatus('Configuration reset to server defaults.');
        } else {
            updateConfigStatus('Configuration reset for this session.');
        }
    });
}

initializeConfig();
