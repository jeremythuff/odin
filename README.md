# odin
Open Discovery Interface

ODIn is an AI Empowered Bibliographic Discovery Interface.

## OpenAI configuration

Set the following environment variables before starting the server so that the application can contact OpenAI's API:

- `OPENAI_API_KEY`: A valid OpenAI API key.
- `OPENAI_MODEL` (optional): The chat completion model to use. Defaults to `gpt-3.5-turbo` if not provided.

These values are read by the backend service when processing search requests that convert descriptions or excerpts into ISBNs.

## Security controls

### Rate limiting

The API endpoints apply an in-memory rate limiter. Adjust the behaviour with the following environment variables:

- `RATE_LIMIT_MAX_REQUESTS`: Maximum number of requests a client may make during the window. Set to `0` or a negative value to disable. Defaults to `30`.
- `RATE_LIMIT_WINDOW_MS`: Size of the rolling window in milliseconds. Defaults to `60000` (one minute).

These headers are surfaced to clients (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) along with `Retry-After` when throttled.

### Captcha verification

To require human verification before running searches, provide hCaptcha credentials:

- `HCAPTCHA_SITE_KEY`: Public site key used by the browser widget.
- `HCAPTCHA_SECRET_KEY`: Private secret used by the server to validate responses.
- `CAPTCHA_PROVIDER` (optional): Set to `hcaptcha` (default) to enable the integration.

When both keys are present, the frontend automatically renders the hCaptcha challenge and the backend validates the token before executing a search.
