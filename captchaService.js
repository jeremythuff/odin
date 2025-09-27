const https = require('https');
const { URLSearchParams } = require('url');

const provider = (process.env.CAPTCHA_PROVIDER || 'hcaptcha').trim().toLowerCase();
const siteKey = (process.env.HCAPTCHA_SITE_KEY || process.env.CAPTCHA_SITE_KEY || '').trim();
const secretKey = (process.env.HCAPTCHA_SECRET_KEY || process.env.CAPTCHA_SECRET_KEY || '').trim();

const SUPPORTED_PROVIDERS = new Set(['hcaptcha']);

const isSupportedProvider = SUPPORTED_PROVIDERS.has(provider);
const isConfigured = Boolean(isSupportedProvider && siteKey && secretKey);

const verifyWithHcaptcha = (token, remoteIp) => {
    if (!token || typeof token !== 'string') {
        return Promise.resolve({ success: false, error: 'Captcha token missing.' });
    }

    const params = new URLSearchParams();
    params.set('secret', secretKey);
    params.set('response', token);

    const sanitizedRemoteIp = typeof remoteIp === 'string' && /^[0-9a-fA-F:,.]+$/.test(remoteIp) ? remoteIp : null;
    if (sanitizedRemoteIp) {
        params.set('remoteip', sanitizedRemoteIp);
    }

    const payload = params.toString();

    return new Promise((resolve, reject) => {
        const request = https.request(
            {
                hostname: 'hcaptcha.com',
                path: '/siteverify',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(payload),
                },
            },
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    body += chunk;
                });
                response.on('end', () => {
                    try {
                        const data = JSON.parse(body || '{}');
                        if (data.success) {
                            resolve({ success: true, data });
                            return;
                        }

                        const errorCodes = Array.isArray(data['error-codes']) ? data['error-codes'] : null;
                        resolve({
                            success: false,
                            error: 'Captcha verification failed.',
                            errorCodes,
                        });
                    } catch (error) {
                        resolve({ success: false, error: 'Captcha verification error.' });
                    }
                });
            }
        );

        request.on('error', (error) => {
            reject(error);
        });

        request.write(payload);
        request.end();
    });
};

const verifyCaptchaToken = async (token, remoteIp) => {
    if (!isConfigured) {
        return { success: true };
    }

    if (provider === 'hcaptcha') {
        try {
            return await verifyWithHcaptcha(token, remoteIp);
        } catch (error) {
            return { success: false, error: 'Captcha verification unavailable.' };
        }
    }

    return { success: false, error: 'Captcha provider not supported.' };
};

const getCaptchaConfig = () => {
    if (!isConfigured) {
        return { enabled: false };
    }

    return {
        enabled: true,
        provider,
        siteKey,
    };
};

module.exports = {
    getCaptchaConfig,
    verifyCaptchaToken,
};
