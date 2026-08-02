import logging
from typing import Any

import httpx

from app.services.model_gateway import settings

logger = logging.getLogger(__name__)

ANALYZE_PROMPT = """分析这张宠物照片，提取以下特征并返回JSON：
{
  "species": "cat" 或 "dog",
  "fur_color": "主色描述（英文）",
  "fur_pattern": "花纹类型（solid/tabby/bicolor/tricolor/tuxedo/spotted/merle等）",
  "ear_type": "耳朵形状（pointed/floppy/folded/round等）",
  "face_shape": "脸型（round/oval/triangular/square等）",
  "eye_color": "眼睛颜色（英文）",
  "body_type": "体型（slim/medium/stocky/fluffy等）",
  "distinctive_features": ["特征列表，如长尾巴/短腿/大眼睛等，英文"],
  "breed_guess": "可能的品种（英文）",
  "overall_vibe": "整体气质一句话描述（英文，用于生图prompt）"
}
只返回JSON，不要其他文字。"""


async def analyze_pet_photo(image_data_url: str) -> dict[str, Any]:
    if not settings.vision_base_url or not settings.vision_api_key:
        return _default_features()

    url = settings.vision_base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": settings.vision_model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_data_url}},
                {"type": "text", "text": ANALYZE_PROMPT},
            ],
        }],
        "max_tokens": 800,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.vision_api_key}"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, str):
            import json
            content = content.strip().removeprefix("```json").removesuffix("```").strip()
            return json.loads(content)
        return content
    except Exception as exc:
        logger.exception("Vision analysis failed: %s", exc)
        return _default_features()


def _default_features() -> dict[str, Any]:
    return {
        "species": "cat",
        "fur_color": "orange",
        "fur_pattern": "tabby",
        "ear_type": "pointed",
        "face_shape": "round",
        "eye_color": "golden",
        "body_type": "medium",
        "distinctive_features": ["big eyes", "fluffy tail"],
        "breed_guess": "domestic shorthair",
        "overall_vibe": "cute and curious domestic cat with warm orange fur",
    }
