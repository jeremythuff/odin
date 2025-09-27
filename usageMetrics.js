const DEFAULT_CURRENCY = 'USD';

const toFiniteNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const basePricing = (() => {
    const normalizeKeys = (entries = {}) => {
        const normalized = {};
        for (const [key, value] of Object.entries(entries)) {
            if (typeof key !== 'string') {
                continue;
            }

            const normalizedKey = key.trim().toLowerCase();
            if (!normalizedKey) {
                continue;
            }

            if (!value || typeof value !== 'object') {
                continue;
            }

            const input = toFiniteNumber(value.input);
            const output = toFiniteNumber(value.output);

            if (input === null && output === null) {
                continue;
            }

            normalized[normalizedKey] = {};
            if (input !== null) {
                normalized[normalizedKey].input = input;
            }

            if (output !== null) {
                normalized[normalizedKey].output = output;
            }
        }
        return normalized;
    };

    return {
        openai: normalizeKeys({
            'gpt-4.1-mini': { input: 0.0003, output: 0.0006 },
            'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
            'gpt-4o': { input: 0.005, output: 0.015 },
            'gpt-4.1': { input: 0.01, output: 0.03 },
        }),
        claude: normalizeKeys({
            'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
            'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
        }),
    };
})();

const loadPricingOverrides = () => {
    const raw = process.env.LLM_PRICING_OVERRIDES;
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }

        const normalized = {};
        for (const [provider, entries] of Object.entries(parsed)) {
            if (typeof provider !== 'string' || !entries || typeof entries !== 'object') {
                continue;
            }

            const providerKey = provider.trim().toLowerCase();
            if (!providerKey) {
                continue;
            }

            normalized[providerKey] = normalized[providerKey] || {};
            for (const [model, pricing] of Object.entries(entries)) {
                if (typeof model !== 'string' || !pricing || typeof pricing !== 'object') {
                    continue;
                }

                const modelKey = model.trim().toLowerCase();
                if (!modelKey) {
                    continue;
                }

                const input = toFiniteNumber(pricing.input);
                const output = toFiniteNumber(pricing.output);

                if (input === null && output === null) {
                    continue;
                }

                normalized[providerKey][modelKey] = {};
                if (input !== null) {
                    normalized[providerKey][modelKey].input = input;
                }
                if (output !== null) {
                    normalized[providerKey][modelKey].output = output;
                }
            }
        }

        return normalized;
    } catch (error) {
        console.warn('LLM_PRICING_OVERRIDES is not valid JSON. Ignoring overrides.');
        return {};
    }
};

const pricingOverrides = loadPricingOverrides();

const lookupPricing = (provider, model) => {
    const providerKey = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
    const modelKey = typeof model === 'string' ? model.trim().toLowerCase() : '';

    if (!providerKey || !modelKey) {
        return null;
    }

    const overrides = pricingOverrides[providerKey];
    if (overrides && overrides[modelKey]) {
        return overrides[modelKey];
    }

    const providerPricing = basePricing[providerKey];
    if (providerPricing && providerPricing[modelKey]) {
        return providerPricing[modelKey];
    }

    return null;
};

const calculateCost = ({ promptTokens, completionTokens }, pricing) => {
    if (!pricing || typeof pricing !== 'object') {
        return null;
    }

    const inputRate = toFiniteNumber(pricing.input);
    const outputRate = toFiniteNumber(pricing.output);

    if (inputRate === null && outputRate === null) {
        return null;
    }

    const promptCost =
        promptTokens !== null && promptTokens !== undefined && inputRate !== null
            ? (promptTokens / 1000) * inputRate
            : null;

    const completionCost =
        completionTokens !== null && completionTokens !== undefined && outputRate !== null
            ? (completionTokens / 1000) * outputRate
            : null;

    const totalCostCandidates = [promptCost, completionCost].filter((value) => typeof value === 'number');
    const totalCost = totalCostCandidates.length
        ? totalCostCandidates.reduce((sum, value) => sum + value, 0)
        : null;

    if (promptCost === null && completionCost === null && totalCost === null) {
        return null;
    }

    const result = { currency: DEFAULT_CURRENCY };

    if (promptCost !== null) {
        result.prompt = promptCost;
    }

    if (completionCost !== null) {
        result.completion = completionCost;
    }

    if (totalCost !== null) {
        result.total = totalCost;
    }

    return Object.keys(result).length > 1 ? result : null;
};

const buildUsageStats = (provider, model, rawUsage) => {
    if (!rawUsage || typeof rawUsage !== 'object') {
        return null;
    }

    const providerKey = typeof provider === 'string' ? provider.trim().toLowerCase() : '';

    let promptTokens = null;
    let completionTokens = null;
    let totalTokens = null;

    if (providerKey === 'openai') {
        promptTokens = toFiniteNumber(rawUsage.prompt_tokens);
        completionTokens = toFiniteNumber(rawUsage.completion_tokens);
        totalTokens = toFiniteNumber(rawUsage.total_tokens);
    } else if (providerKey === 'claude') {
        promptTokens = toFiniteNumber(rawUsage.input_tokens ?? rawUsage.prompt_tokens);
        completionTokens = toFiniteNumber(rawUsage.output_tokens ?? rawUsage.completion_tokens);
        totalTokens = toFiniteNumber(rawUsage.total_tokens ?? rawUsage.tokens);
    } else {
        promptTokens = toFiniteNumber(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? rawUsage.total_tokens);
        completionTokens = toFiniteNumber(rawUsage.completion_tokens ?? rawUsage.output_tokens);
        totalTokens = toFiniteNumber(rawUsage.total_tokens ?? rawUsage.tokens);
    }

    if (totalTokens === null && promptTokens !== null && completionTokens !== null) {
        totalTokens = promptTokens + completionTokens;
    }

    const hasTokenData = [promptTokens, completionTokens, totalTokens].some((value) => value !== null);
    if (!hasTokenData) {
        return null;
    }

    const usage = {};
    if (promptTokens !== null) {
        usage.promptTokens = promptTokens;
    }

    if (completionTokens !== null) {
        usage.completionTokens = completionTokens;
    }

    if (totalTokens !== null) {
        usage.totalTokens = totalTokens;
    }

    const pricing = lookupPricing(providerKey, model);
    const cost = calculateCost({ promptTokens, completionTokens }, pricing);
    if (cost) {
        usage.cost = cost;
    }

    return Object.keys(usage).length ? usage : null;
};

module.exports = {
    buildUsageStats,
};
