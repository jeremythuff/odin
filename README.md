# odin
Open Discovery Interface

ODIn is an AI Empowered Bibliographic Discovery Interface.

## LLM configuration

Use the following environment variables to enable the different language model providers when starting the server:

### OpenAI

- `OPENAI_API_KEY`: A valid OpenAI API key.
- `OPENAI_MODEL` (optional): The chat completion model to use. Defaults to `gpt-4.1-mini` if not provided.

### Anthropic Claude

- `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`): A valid Anthropic API key.
- `CLAUDE_MODEL` (optional): Claude model identifier. Defaults to `claude-3-haiku-20240307`.
- `CLAUDE_MAX_TOKENS` (optional): Maximum completion tokens to request (up to 4000).

### Google Gemini

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`): A valid Gemini API key.
- `GEMINI_MODEL` (optional): Gemini model identifier. Defaults to `gemini-pro`.
- `GEMINI_API_VERSION` (optional): API version segment, defaults to `v1`.
- `GEMINI_API_HOSTNAME` (optional): Override the Gemini host if needed, defaults to `generativelanguage.googleapis.com`.

### Selecting the provider

Set `LLM_PROVIDER` to choose which backend processes requests. Supported values include `openai`, `claude`, and `gemini` (plus common aliases such as `gpt`, `anthropic`, or `google`). If omitted or unrecognised, OpenAI is used by default.

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
