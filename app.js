const searchBox = document.getElementById('search-box');
const resultsContainer = document.getElementById('results-container');

const escapeHtml = (value = '') => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char));

const formatConfidence = (confidence) => {
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
        return null;
    }

    return `${Math.round(confidence * 100)}%`;
};

const formatIdentifiers = (identifiers = {}) => {
    const items = [];

    if (identifiers.isbn13) {
        items.push(`<li>ISBN-13: ${escapeHtml(identifiers.isbn13)}</li>`);
    }

    if (identifiers.isbn10) {
        items.push(`<li>ISBN-10: ${escapeHtml(identifiers.isbn10)}</li>`);
    }

    if (identifiers.oclc) {
        items.push(`<li>OCLC: ${escapeHtml(identifiers.oclc)}</li>`);
    }

    if (identifiers.lccn) {
        items.push(`<li>LCCN: ${escapeHtml(identifiers.lccn)}</li>`);
    }

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
    if (!payload || typeof payload !== 'object') {
        return '<p class="error">No response received from server.</p>';
    }

    if (!payload.ok) {
        const message = payload.error ? escapeHtml(payload.error) : 'Unable to process the request.';
        return `<p class="error">${message}</p>`;
    }

    const { query, result, rawResponse } = payload;
    const sections = [];

    const summaryItems = [];
    if (query) {
        summaryItems.push(`
            <div class="result-summary__item">
                <span class="result-summary__label">Query</span>
                <span class="result-summary__value">${escapeHtml(query)}</span>
            </div>
        `);
    }

    if (result?.isbn) {
        summaryItems.push(`
            <div class="result-summary__item">
                <span class="result-summary__label">Top ISBN</span>
                <span class="result-summary__value">${escapeHtml(result.isbn)}</span>
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

    if (summaryItems.length) {
        sections.push(`<div class="result-summary">${summaryItems.join('')}</div>`);
    }

    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
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

const performSearch = async () => {
    const query = searchBox.value.trim();
    searchBox.value = '';

    if (!query) {
        resultsContainer.innerHTML = '<p class="error">Please enter a description before searching.</p>';
        return;
    }

    resultsContainer.innerHTML = `
        <div class="result-loading" role="status" aria-live="polite">
            <span class="result-loading__spinner" aria-hidden="true"></span>
            <span class="result-loading__text">Searching…</span>
        </div>
    `;

    try {
        const response = await fetch('search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const results = await response.json();
        resultsContainer.innerHTML = renderResult(results);
    } catch (error) {
        resultsContainer.innerHTML = `<p class="error">Error performing search: ${escapeHtml(error.message)}</p>`;
        console.error('There was a problem with the fetch operation:', error);
    }
};

searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        performSearch();
    }
});
