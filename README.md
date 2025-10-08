# odin
Open Discovery Interface

ODIn is an AI Empowered Bibliographic Discovery Interface.

## Architecture

The project is split into two services:

- **api/** – Node.js API responsible for catalog lookups, rate limiting, captcha verification, and LLM-driven enrichment.
- **ui/** – Static site + lightweight server that serves the UI bundle and proxies configuration to the browser.

Use the helper scripts in the repo root (`start.sh`, `stop.sh`) to install dependencies and run/stop both services together.

## Environment variables

### API service (`api/`)

- **Runtime**
  - `PORT` (default `8000`): Port the API binds to.
  - `HOST` (default `0.0.0.0`): Host/interface the API listens on.
  - `CORS_ALLOWED_ORIGINS` (default `*`): Comma-separated list of allowed origins for CORS responses.
  - `CATALOG_DOMAIN` (default `https://catalog.library.tamu.edu`): Base catalog domain included in config responses.
  - `DEBUG` (default `false`): Enables additional debugging flags in the returned config payload.

- **Rate limiting**
  - `RATE_LIMIT_MAX_REQUESTS` (default `30`): Maximum requests permitted per client inside the rolling window. Set to `0` or negative to disable rate limiting.
  - `RATE_LIMIT_WINDOW_MS` (default `60000`): Rolling window size in milliseconds.

- **Captcha**
  - `CAPTCHA_PROVIDER` (default `hcaptcha`): Captcha provider identifier.
  - `HCAPTCHA_SITE_KEY` / `CAPTCHA_SITE_KEY`: Public site key shared with the UI.
  - `HCAPTCHA_SECRET_KEY` / `CAPTCHA_SECRET_KEY`: Secret used by the API to validate captcha tokens.

- **LLM selection & behaviour**
  - `LLM_PROVIDER` (default `openai`): Provider alias (`openai`, `claude`, `gemini`, plus common synonyms).
  - `LLM_TEMPERATURE` / `MODEL_TEMPERATURE` (default `0.2`): Sampling temperature applied where supported.
  - `LLM_PRICING_OVERRIDES`: JSON object mapping provider/model pairs to pricing overrides used in usage reporting.
  - `DISAMBIGUATION_PROVIDER` (default `openai`): Provider used for the LLM disambiguation phase.
  - `DISAMBIGUATION_OPENAI_MODEL` (default `gpt-4o-mini`): OpenAI model dedicated to the disambiguation classifier.
  - `DISAMBIGUATION_OPENAI_API_KEY` (optional): Alternate API key for the disambiguation model. Falls back to `OPENAI_API_KEY` when omitted.

- **OpenAI settings**
  - `OPENAI_API_KEY` (required for OpenAI usage): API key.
  - `OPENAI_MODEL`: Preferred chat completion model.
  - `DEFAULT_OPENAI_MODEL` (default `gpt-4.1-mini`): Fallback model if `OPENAI_MODEL` is unset.

- **Anthropic Claude settings**
  - `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` (one required for Claude usage): API key.
  - `CLAUDE_MODEL` (default `claude-3-haiku-20240307`): Model identifier.
  - `CLAUDE_MAX_TOKENS` (default `1024`, max `4000`): Maximum completion tokens requested.
  - `ANTHROPIC_VERSION` (default `2023-06-01`): Claude API version header.

- **Google Gemini settings**
  - `GEMINI_API_KEY` / `GOOGLE_API_KEY` (one required for Gemini usage): API key.
  - `GEMINI_MODEL`: Preferred model.
  - `DEFAULT_GEMINI_MODEL` (default `gemini-pro`): Fallback model.
  - `GEMINI_API_VERSION` (default `v1`): API version segment.
  - `GEMINI_API_HOSTNAME` (default `generativelanguage.googleapis.com`): Hostname for Gemini requests.

### UI service (`ui/`)

- `CLIENT_PORT` (default `3000`): Preferred port for the UI server (takes precedence over `PORT`).
- `PORT` (fallback `3000`): Fallback UI server port when `CLIENT_PORT` is unset.
- `HOST` (default `0.0.0.0`): Host/interface the UI binds to.
- `API_BASE_URL`: Fully-qualified base URL for API requests (overrides protocol/host/port).
- `API_PROTOCOL`: `http` or `https` portion used when constructing API URLs.
- `API_HOST`: Hostname used for the API when `API_BASE_URL` is not set.
- `API_PORT`: Port used for the API when `API_BASE_URL` is not set.

All UI environment variables are read when running the local UI server; `API_*` values are embedded into `public/client-config.js` for the browser.

## Running with Docker

The repository ships with a multi-service compose file that builds and runs both the API and UI.

```bash
docker compose up --build
```

- `odin-api` exposes the API on port `8111` by default (configurable via `PORT` in your environment).
- `odin-ui` exposes the UI on port `8112` by default (configurable via `CLIENT_PORT`).

To override environment variables for either container, create a `.env` file in the repository root or pass values inline, e.g.:

```bash
PORT=9000 CLIENT_PORT=4000 docker compose up --build
```

When you are done, stop the stack with:

```bash
docker compose down
```
