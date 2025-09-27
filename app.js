const searchBox = document.getElementById('search-box');
const resultsContainer = document.getElementById('results-container');
const configButton = document.getElementById('config-button');
const configMenu = document.getElementById('config-menu');
const configForm = document.getElementById('config-form');
const configCatalogInput = document.getElementById('config-catalog-domain');
const configStatus = document.getElementById('config-status');
const configDebugInput = document.getElementById('config-debug');
const configResetButton = document.getElementById('config-reset');

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

const buildCatalogResultsUrl = (candidates = []) => {
    if (!Array.isArray(candidates) || !candidates.length) {
        return null;
    }

    const baseUrl = getCatalogResultsBaseUrl();
    const params = new URLSearchParams();
    params.set('join', 'OR');

    let groupIndex = 0;

    const addEntry = (index, value, type) => {
        if (!value) {
            return;
        }

        params.append(`lookfor${index}[]`, value);
        params.append(`type${index}[]`, type);
    };

    candidates.forEach((candidate) => {
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

        if (!entries.length) {
            return;
        }

        entries.forEach(({ value, type }) => {
            addEntry(groupIndex, value, type);
        });

        params.append(`bool${groupIndex}[]`, 'OR');
        groupIndex += 1;
    });

    if (groupIndex === 0) {
        return null;
    }

    params.set('illustration', '-1');
    params.append('daterange[]', 'publishDate');
    params.set('publishDatefrom', '');
    params.set('publishDateto', '');

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

    const meta = [
        formatMetaItem('Year', year),
        formatMetaItem('Language', language),
    ].filter(Boolean).join('');

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
            <div class="result-summary__item">
                <span class="result-summary__label">Query</span>
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
    searchBox.value = '';
    lastRenderedPayload = null;
    lastCatalogResultsUrl = null;

    if (!query) {
        showResultsContainer();
        resultsContainer.innerHTML = '<p class="error">Please enter a description before searching.</p>';
        lastRenderedPayload = null;
        lastCatalogResultsUrl = null;
        return;
    }

    showResultsContainer();
    resultsContainer.innerHTML = `
        <div class="result-loading" role="status" aria-live="polite">
            <span class="result-loading__spinner" aria-hidden="true"></span>
            <span class="result-loading__text">Searching…</span>
        </div>
    `;
    lastRenderedPayload = null;
    lastCatalogResultsUrl = null;

    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
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
            }
        }
    } catch (error) {
        console.error('Unable to load configuration:', error);
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
    }
};

searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        performSearch();
    }
});

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

        const persisted = saveStoredConfig({ catalogDomain: appliedDomain, debug: appliedDebug });

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

        if (cleared) {
            updateConfigStatus('Configuration reset to server defaults.');
        } else {
            updateConfigStatus('Configuration reset for this session.');
        }
    });
}

initializeConfig();
