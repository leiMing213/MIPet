import json
from collections.abc import AsyncGenerator

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.schemas import DecisionRequest, DecisionResponse


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


def _build_chat_payload(request: DecisionRequest, stream: bool = False) -> tuple[str, dict, dict]:
    context = request.context
    event = request.event
    system = (
        f"你是一只桌面宠物，名字叫{context.pet_name}，物种是{context.species}，MBTI是{context.mbti}。"
        "你说话风格简洁温暖，符合你的MBTI性格特征。直接用自然的中文回复用户的话，不要输出JSON，不要加任何格式标记。"
    )
    payload = {
        "model": settings.mimo_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": event.content or "你好"},
        ],
        "temperature": 0.8,
        "stream": stream,
    }
    url = settings.mimo_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.mimo_api_key}"}
    return url, headers, payload


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
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        return local_fallback(request)


async def stream_chat(request: DecisionRequest) -> AsyncGenerator[str, None]:
    """Stream chat response as SSE events."""
    if not settings.mimo_base_url or not settings.mimo_api_key:
        fallback = local_fallback(request)
        for char in fallback.dialogue:
            yield f"data: {json.dumps({'token': char}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'done': True, 'animation': fallback.animation})}\n\n"
        return

    url, headers, payload = _build_chat_payload(request, stream=True)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    chunk_str = line[6:]
                    if chunk_str.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(chunk_str)
                        delta = chunk["choices"][0].get("delta", {})
                        token = delta.get("content", "")
                        if token:
                            yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
        yield f"data: {json.dumps({'done': True, 'animation': 'idle'})}\n\n"
    except (httpx.HTTPError, Exception):
        fallback = local_fallback(request)
        yield f"data: {json.dumps({'token': fallback.dialogue}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'done': True, 'animation': fallback.animation})}\n\n"
