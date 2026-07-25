import base64
import re
from typing import Any

import httpx

from app.services.model_gateway import settings


def _extract_result(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize the common synchronous and asynchronous image API responses."""
    items = data.get("data") if isinstance(data.get("data"), list) else []
    if not items and isinstance(data.get("candidates"), list):
        items = data["candidates"]
    first = items[0] if items else data
    image_url = first.get("url") or first.get("image_url")
    b64 = first.get("b64_json") or first.get("base64")
    if b64 and not image_url:
        image_url = f"data:image/png;base64,{b64}"
    task_id = data.get("id") or data.get("task_id") or first.get("id")
    status = data.get("status") or first.get("status") or ("completed" if image_url else "pending")
    return {
        "status": status,
        "image_url": image_url,
        "task_id": task_id,
        "progress": data.get("progress") or first.get("progress") or 0,
        "message": data.get("message") or first.get("message"),
    }


async def generate_pet_image(reference_data_url: str, prompt: str) -> dict[str, Any]:
    if not settings.image2_base_url or not settings.image2_api_key:
        raise RuntimeError("Image-2 is not configured")
    if not re.match(r"^data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$", reference_data_url):
        raise ValueError("reference image must be a base64 data URL")
    # Decode once to reject malformed or excessively large uploads before sending them upstream.
    encoded = reference_data_url.split(",", 1)[1]
    if len(encoded) > 20_000_000:
        raise ValueError("reference image is too large")
    base64.b64decode(encoded, validate=True)
    url = settings.image2_base_url.rstrip("/") + settings.image2_endpoint
    payload = {
        "model": settings.image2_model,
        "prompt": prompt,
        "n": 1,
        "size": "1:1",
        "imageSize": "1K",
        "async": True,
        "image": [reference_data_url],
    }
    transport = httpx.AsyncHTTPTransport(retries=2)
    async with httpx.AsyncClient(timeout=90, transport=transport) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {settings.image2_api_key}"}, json=payload)
        response.raise_for_status()
        return _extract_result(response.json())


async def query_pet_image_task(task_id: str) -> dict[str, Any]:
    """Query an async Right Code draw task without exposing the API key to the client."""
    url = settings.image2_task_base_url.rstrip("/") + "/tasks/" + task_id
    transport = httpx.AsyncHTTPTransport(retries=2)
    try:
        async with httpx.AsyncClient(timeout=30, transport=transport) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {settings.image2_api_key}"})
        if response.status_code in {429, 500, 502, 503, 504}:
            return {
                "status": "in_progress",
                "image_url": None,
                "task_id": task_id,
                "progress": 0,
                "message": "图片服务繁忙，正在自动重试查询",
            }
        response.raise_for_status()
        data = response.json()
    except httpx.RequestError:
        return {
            "status": "in_progress",
            "image_url": None,
            "task_id": task_id,
            "progress": 0,
            "message": "任务查询网络波动，正在自动重试",
        }
    result = _extract_result(data)
    result["message"] = data.get("message") or result.get("message")
    result["progress"] = data.get("progress") or result.get("progress") or 0
    if data.get("error"):
        result["message"] = data["error"].get("message") if isinstance(data["error"], dict) else str(data["error"])
    return result
