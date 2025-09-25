# odin
Open Discovery Interface

ODIn is an AI Empowered Bibliographic Discovery Interface.

## OpenAI configuration

Set the following environment variables before starting the server so that the application can contact OpenAI's API:

- `OPENAI_API_KEY`: A valid OpenAI API key.
- `OPENAI_MODEL` (optional): The chat completion model to use. Defaults to `gpt-3.5-turbo` if not provided.

These values are read by the backend service when processing search requests that convert descriptions or excerpts into ISBNs.
