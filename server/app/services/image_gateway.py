import base64
import re
from typing import Any

import httpx

from app.services.model_gateway import settings

IMAGE_ASPECT_RATIO = "1:1"
IMAGE_RESOLUTION = "1K"
SPRITE_SHEET_ASPECT_RATIO = "16:9"
SPRITE_SHEET_RESOLUTION = "2K"


def _extract_result(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize the common synchronous and asynchronous image API responses."""
    items = data.get("data") if isinstance(data.get("data"), list) else []
    if not items and isinstance(data.get("candidates"), list):
        items = data["candidates"]
    first = items[0] if items else {}
    image_url = None
    metadata = data.get("metadata")
    if isinstance(metadata, dict):
        image_url = metadata.get("url") or metadata.get("image_url")
    if not image_url:
        image_url = data.get("url") or data.get("image_url") or first.get("url") or first.get("image_url")
    b64 = first.get("b64_json") or first.get("base64")
    if b64 and not image_url:
        image_url = f"data:image/png;base64,{b64}"
    task_id = data.get("id") or data.get("task_id") or first.get("id")
    status = data.get("status") or first.get("status")
    if not status:
        if image_url:
            status = "completed"
        elif task_id:
            status = "in_progress"
        else:
            status = "pending"
    progress = data.get("progress") or first.get("progress")
    if progress is None:
        progress = 100 if image_url else 0
    return {
        "status": status,
        "image_url": image_url,
        "task_id": task_id,
        "progress": progress,
        "message": data.get("message") or first.get("message"),
    }


def build_pet_prompt(species: str, mbti: str, features: dict[str, Any] | None = None) -> str:
    """Build a generation prompt for the pet image."""
    base_style = (
        "IMPORTANT: show the ENTIRE animal body, absolutely nothing cropped, "
        "all four paws visible, entire tail from base to tip visible, both ears fully visible, "
        "the pet must be small relative to the canvas with large margins on all sides, "
        "zoomed out wide shot, the pet occupies at most 60% of the image area, "
        "single pet only, standing on all four legs, front-facing or slight three-quarter angle, "
        "semi-realistic anime illustration style, natural anatomy, "
        "detailed fur texture, expressive eyes, soft studio lighting, no text"
    )
    composition = (
        "pure white background #FFFFFF, solid flat white everywhere, "
        "no scenery, no objects, no floor, no shadow, no gradient, no texture, "
        "massive white margins around the pet on all sides, "
        "character cutout suitable for transparent-background extraction"
    )

    if features:
        fur = features.get("fur_color", "orange")
        pattern = features.get("fur_pattern", "solid")
        ear = features.get("ear_type", "pointed")
        vibe = features.get("overall_vibe", "")
        breed = features.get("breed_guess", "")
        detail = (
            f"{fur} {pattern} fur, {ear} ears, {breed}, {vibe}, "
            "keep the uploaded pet's real markings and facial identity"
        )
    else:
        if species == "dog":
            detail = (
                "stylized realistic dog, natural canine anatomy, believable muzzle and body proportions, "
                "soft fur shading, lively but grounded expression"
            )
        else:
            detail = (
                "stylized realistic cat, natural feline anatomy, elegant face shape and body proportions, "
                "soft fur shading, calm expressive look"
            )

    personality_hints = {
        "INTJ": "calm intelligent gaze, restrained and confident temperament",
        "INTP": "observant expression, slightly curious posture",
        "ENTJ": "confident stance, focused commanding energy",
        "ENTP": "spirited expression, clever playful energy",
        "INFJ": "gentle thoughtful eyes, quiet emotional depth",
        "INFP": "soft dreamy expression, delicate poetic mood",
        "ENFJ": "warm welcoming look, emotionally expressive presence",
        "ENFP": "bright lively expression, energetic and charming mood",
        "ISTJ": "tidy composed appearance, dependable temperament",
        "ISFJ": "soft caring expression, calm trustworthy mood",
        "ESTJ": "upright posture, disciplined and reliable energy",
        "ESFJ": "friendly affectionate presence, warm smile",
        "ISTP": "cool alert look, understated athletic energy",
        "ISFP": "gentle artistic vibe, natural and refined mood",
        "ESTP": "alert dynamic posture, bold adventurous energy",
        "ESFP": "radiant lively presence, cheerful expressive mood",
    }
    personality = personality_hints.get(mbti.upper(), "natural expressive look, warm believable personality")

    return f"{base_style}, {composition}, {detail}, {personality}"


async def generate_pet_image(reference_data_url: str, prompt: str) -> dict[str, Any]:
    """Generate a pet image with a reference photo (custom mode)."""
    if not settings.image2_base_url or not settings.image2_api_key:
        raise RuntimeError("Image generation service is not configured")
    if not re.match(r"^data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$", reference_data_url):
        raise ValueError("reference image must be a base64 data URL")
    encoded = reference_data_url.split(",", 1)[1]
    if len(encoded) > 20_000_000:
        raise ValueError("reference image is too large")
    base64.b64decode(encoded, validate=True)
    url = settings.image2_base_url.rstrip("/") + settings.image2_endpoint
    payload = {
        "model": settings.image2_model,
        "prompt": prompt,
        "n": 1,
        "size": IMAGE_ASPECT_RATIO,
        "imageSize": IMAGE_RESOLUTION,
        "async": True,
        "image": [reference_data_url],
    }
    transport = httpx.AsyncHTTPTransport(retries=2)
    async with httpx.AsyncClient(timeout=90, transport=transport) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {settings.image2_api_key}"}, json=payload)
        response.raise_for_status()
        return _extract_result(response.json())


async def generate_pet_image_default(prompt: str) -> dict[str, Any]:
    """Generate a pet image from text only (default mode, no reference photo)."""
    if not settings.image2_base_url or not settings.image2_api_key:
        raise RuntimeError("Image generation service is not configured")
    url = settings.image2_base_url.rstrip("/") + settings.image2_endpoint
    payload = {
        "model": settings.image2_model,
        "prompt": prompt,
        "n": 1,
        "size": IMAGE_ASPECT_RATIO,
        "imageSize": IMAGE_RESOLUTION,
        "async": True,
    }
    transport = httpx.AsyncHTTPTransport(retries=2)
    async with httpx.AsyncClient(timeout=90, transport=transport) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {settings.image2_api_key}"}, json=payload)
        response.raise_for_status()
        return _extract_result(response.json())


def build_sprite_sheet_prompt(action: str, character_description: str, species: str = "cat") -> str:
    """Build a prompt for a horizontal sprite sheet with 6 frames.

    CRITICAL: Frame 1 must always be the neutral standing idle pose
    so the animation can transition seamlessly from the static image.
    The last frame must also return to the idle pose for clean looping.
    """
    cat_yawn = (
        "6-frame cat yawning animation sprite sheet, exactly 6 equally-sized frames in a single horizontal row, "
        "frame 1: cat in neutral relaxed standing pose, mouth closed, eyes open, "
        "frame 2: cat's mouth slightly parts open, eyes begin to squint, "
        "frame 3: cat's mouth opens wider, eyes half-closed, subtle head lift only, "
        "frame 4: cat in full yawn, mouth wide open, tongue visible, eyes closed, "
        "frame 5: cat's mouth closing, tongue retracting, eyes reopening, "
        "frame 6: cat returns to the exact neutral standing pose from frame 1, mouth closed, eyes open, identical silhouette and placement"
    )
    dog_pant = (
        "6-frame dog panting animation sprite sheet, exactly 6 equally-sized frames in a single horizontal row, "
        "frame 1: dog in neutral relaxed standing pose, mouth closed, tongue inside, "
        "frame 2: dog's mouth opens slightly, tongue tip appears, "
        "frame 3: dog's mouth opens wider, tongue extends out, "
        "frame 4: dog's mouth fully open, tongue hanging out, happy panting expression, "
        "frame 5: dog's mouth begins closing, tongue retracts, "
        "frame 6: dog returns to the exact neutral standing pose from frame 1, mouth closed, identical silhouette and placement"
    )

    action_descriptions = {
        "yawn": cat_yawn if species == "cat" else dog_pant,
    }
    action_desc = action_descriptions.get(action, cat_yawn if species == "cat" else dog_pant)

    return (
        f"{action_desc}, "
        f"same character in every frame: {character_description}, "
        "IGNORE any wide-shot or large-margin instructions from the base description for this sprite sheet. "
        "IMPORTANT: all 6 frames must show the EXACT same character with identical body silhouette, "
        "identical ear shape, identical head width, identical torso width, identical paw placement, identical tail outline, "
        "identical scale and identical centered position inside each cell, "
        "the full body must stay visible in every frame with small consistent margins only, "
        "only the mouth, tongue, eyelids, and a very subtle head lift may change between frames, "
        "do not change the overall outline of the cat or dog, do not redraw body proportions, do not move the body between frames, "
        "frame 1 and frame 6 must be visually identical so the action starts and ends on the same pose, "
        "pure solid white background or transparent background only, no scenery, no shadow, no floor, "
        "evenly divided horizontal strip with 6 equal cells, game sprite sheet format, "
        "no text, no numbers, no labels, no frame borders, no dividing lines"
    )


async def generate_sprite_sheet(reference_data_url: str | None, prompt: str) -> dict[str, Any]:
    """Generate a sprite sheet image (with or without reference)."""
    if not settings.image2_base_url or not settings.image2_api_key:
        raise RuntimeError("Image generation service is not configured")
    url = settings.image2_base_url.rstrip("/") + settings.image2_endpoint
    payload: dict[str, Any] = {
        "model": settings.image2_model,
        "prompt": prompt,
        "n": 1,
        "size": SPRITE_SHEET_ASPECT_RATIO,
        "imageSize": SPRITE_SHEET_RESOLUTION,
        "async": True,
    }
    if reference_data_url:
        payload["image"] = [reference_data_url]
    transport = httpx.AsyncHTTPTransport(retries=2)
    async with httpx.AsyncClient(timeout=90, transport=transport) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {settings.image2_api_key}"}, json=payload)
        response.raise_for_status()
        return _extract_result(response.json())


async def query_pet_image_task(task_id: str) -> dict[str, Any]:
    """Query an async image generation task."""
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
