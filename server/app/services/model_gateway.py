import json
import logging

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.schemas import DecisionRequest, DecisionResponse


logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    mimo_base_url: str | None = None
    mimo_api_key: str | None = None
    mimo_model: str = "mimo"
    image2_base_url: str | None = None
    image2_api_key: str | None = None
    image2_model: str = "gpt-image-2"
    image2_endpoint: str = "/images/generations"
    image2_task_base_url: str = "https://www.right.codes/v1"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", case_sensitive=False)


settings = Settings()


def local_fallback(request: DecisionRequest) -> DecisionResponse:
    event = request.event.type
    name = request.context.pet_name
    mbti = request.context.mbti
    messages = {
        "feed": f"{name}认真地吃完了这份心意。",
        "clean": f"{name}假装刚才什么都没有发生。",
        "pet": f"{name}被摸得眯起了眼睛。",
        "walk": f"{name}在桌面上走了一圈。",
        "chat": f"我是{mbti}的{name}，我在这里。",
    }
    animation = {"feed": "eat", "pet": "pet", "walk": "walk"}.get(event, "idle")
    return DecisionResponse(
        action=animation,
        animation=animation,
        emotion="warm",
        dialogue=messages.get(event, f"{name}安静地陪着你。"),
        next_trigger_seconds=1800,
        fallback=True,
    )


async def decide(request: DecisionRequest) -> DecisionResponse:
    """Call the configured OpenAI-compatible chat endpoint with a safe fallback."""
    if not settings.mimo_base_url or not settings.mimo_api_key:
        return local_fallback(request)

    context = request.context
    event = request.event
    system = (
        "You are MiPet, a warm desktop cat/dog companion. "
        f"Pet name: {context.pet_name}. Species: {context.species}. MBTI: {context.mbti}. "
        "Respond in concise natural Chinese. Return ONLY valid JSON with keys: "
        "action, animation, emotion, dialogue, memory_write, next_trigger_seconds. "
        "action/animation must be one of idle, walk, eat, pet. "
        "Use the pet state and event to make the response feel personal."
    )
    payload = {
        "model": settings.mimo_model,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": json.dumps(
                    {"state": context.state.model_dump(), "event": event.model_dump(), "recent_messages": context.recent_messages},
                    ensure_ascii=False,
                ),
            },
        ],
        "temperature": 0.8,
    }
    url = settings.mimo_base_url.rstrip("/") + "/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(url, headers={"Authorization": f"Bearer {settings.mimo_api_key}"}, json=payload)
            response.raise_for_status()
            data = response.json()
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        content = str(content).strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(content)
        result = DecisionResponse.model_validate({**local_fallback(request).model_dump(), **parsed, "fallback": False})
        return result
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        logger.exception("MiPet model request failed; returning local fallback: %s", exc)
        return local_fallback(request)
