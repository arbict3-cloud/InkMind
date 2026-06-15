from collections.abc import Iterator

from google import genai
from google.genai import types

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.llm_errors import LLMRequestError


class GeminiLLM(LLMProvider):
    """Native Google Gemini provider using the Google Gen AI SDK."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        http_options = None
        effective_base_url = base_url or settings.gemini_base_url
        if effective_base_url:
            http_options = types.HttpOptions(base_url=effective_base_url)
        self._client = genai.Client(
            api_key=api_key or settings.gemini_api_key,
            http_options=http_options,
        )
        self._model = model or settings.gemini_model

    def stream_complete(
        self, system: str, user: str, *, max_tokens: int | None = None
    ) -> Iterator[str]:
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.85,
            max_output_tokens=max_tokens,
        )
        try:
            stream = self._client.models.generate_content_stream(
                model=self._model,
                contents=user,
                config=config,
            )
            for chunk in stream:
                if chunk.text:
                    yield chunk.text
        except Exception as exc:
            raise LLMRequestError(str(exc) or "Gemini request failed") from exc
