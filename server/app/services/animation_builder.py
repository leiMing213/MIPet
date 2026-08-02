from __future__ import annotations

import base64
import hashlib
import io
import logging
from collections import deque
from typing import Any

import httpx
from PIL import Image, ImageChops, ImageFilter, ImageOps

logger = logging.getLogger(__name__)

BACKGROUND_TOLERANCE = 48
MASK_WORKING_SIZE = 800

_asset_cache: dict[str, dict[str, Any]] = {}
_sprite_clip_cache: dict[str, dict[str, Any]] = {}


async def enrich_pet_render_assets(result: dict[str, Any]) -> dict[str, Any]:
    """Remove background from a completed generated image so only the pet shows."""
    image_url = result.get("image_url")
    if result.get("status") != "completed" or not isinstance(image_url, str) or not image_url:
        return result

    cache_key = hashlib.sha1(image_url.encode("utf-8"), usedforsecurity=False).hexdigest()
    cached = _asset_cache.get(cache_key)
    if cached is not None:
        return {**result, **cached}

    try:
        source = await _load_image(image_url)
        cutout = _remove_background(source)
        cutout = _crop_to_content(cutout)
        enriched = {
            "image_url": _image_to_data_url(cutout),
        }
        _asset_cache[cache_key] = enriched
        return {**result, **enriched}
    except Exception:
        logger.exception("Failed to remove background from pet image")
        return result


async def process_sprite_sheet_from_url(
    image_url: str,
    frame_count: int = 6,
    loop: bool = True,
    action: str | None = None,
) -> dict[str, Any]:
    """Download sprite sheet, normalize each frame, and return clip data."""
    image = await _load_image(image_url)
    frames = _split_sprite_sheet(image, frame_count)
    cleaned_frames = [_remove_background(frame) for frame in frames]
    content_boxes = [_content_bbox(frame) for frame in cleaned_frames]
    valid_boxes = [bbox for bbox in content_boxes if bbox is not None]

    if not cleaned_frames or not valid_boxes:
        processed = _remove_background(image)
        width, height = processed.size
        return {
            "src": _image_to_data_url(processed),
            "frameWidth": width,
            "frameHeight": height,
            "frameCount": 1,
            "fps": 1,
            "columns": 1,
            "rows": 1,
            "loop": loop,
        }

    shared_bbox = _expand_bbox(_union_bboxes(valid_boxes), cleaned_frames[0].size)
    target_width = max(1, shared_bbox[2] - shared_bbox[0])
    target_height = max(1, shared_bbox[3] - shared_bbox[1])
    normalized_frames = [
        _crop_to_shared_bbox(frame, shared_bbox, target_width, target_height)
        for frame in cleaned_frames
    ]

    # Force the last frame to match the first frame exactly so the action
    # can end on the same silhouette it started with.
    normalized_frames[-1] = normalized_frames[0].copy()

    sheet = Image.new("RGBA", (target_width * frame_count, target_height), (0, 0, 0, 0))
    for index, frame in enumerate(normalized_frames):
        sheet.paste(frame, (index * target_width, 0), frame)

    clip = {
        "src": _image_to_data_url(sheet),
        "frameWidth": target_width,
        "frameHeight": target_height,
        "frameCount": frame_count,
        "fps": 6,
        "columns": frame_count,
        "rows": 1,
        "loop": loop,
    }
    overlay_clip = _build_overlay_clip(normalized_frames, action)
    if overlay_clip is not None:
        clip.update(overlay_clip)
    return clip


async def normalize_animation_pack(pack: dict[str, Any] | None) -> dict[str, Any] | None:
    """Re-process stored sprite clips so old animation assets follow the latest rules."""
    if not isinstance(pack, dict):
        return pack

    normalized = dict(pack)
    for action, clip in pack.items():
        if action == "version" or not isinstance(clip, dict):
            continue
        src = clip.get("src")
        if not isinstance(src, str) or not src:
            continue

        frame_count = clip.get("frameCount") or clip.get("columns") or 1
        if not isinstance(frame_count, int) or frame_count < 1:
            frame_count = 1
        if action == "yawn" and frame_count == 8:
            # Older yawn assets were generated as 6 frames but persisted with
            # stale 8-frame metadata, which causes the renderer to cut each
            # frame in the wrong place and show only partial body slices.
            frame_count = 6
        loop = clip.get("loop")
        if not isinstance(loop, bool):
            loop = action not in {"yawn"}

        cache_key = hashlib.sha1(
            f"{action}|{src}|{frame_count}|{loop}".encode("utf-8"),
            usedforsecurity=False,
        ).hexdigest()
        cached = _sprite_clip_cache.get(cache_key)
        if cached is None:
            cached = await process_sprite_sheet_from_url(src, frame_count=frame_count, loop=loop, action=action)
            fps = clip.get("fps")
            if isinstance(fps, int) and fps > 0:
                cached = {**cached, "fps": fps}
            _sprite_clip_cache[cache_key] = cached

        normalized[action] = cached
    return normalized


def _remove_background(source: Image.Image) -> Image.Image:
    """Remove solid-color background using flood fill from edges."""
    original = source.convert("RGBA")
    alpha_extrema = original.getchannel("A").getextrema()
    if alpha_extrema[0] < 250:
        return original
    working = original.copy()
    if max(working.size) > MASK_WORKING_SIZE:
        working.thumbnail((MASK_WORKING_SIZE, MASK_WORKING_SIZE), Image.Resampling.LANCZOS)

    bg_color = _sample_background_color(working)
    background_mask = _flood_fill_background(working.convert("RGB"), bg_color)

    alpha = ImageOps.invert(background_mask)
    if working.size != original.size:
        alpha = alpha.resize(original.size, Image.Resampling.LANCZOS)

    alpha = alpha.filter(ImageFilter.MaxFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))
    alpha = alpha.point(lambda v: 0 if v < 20 else min(255, int(v * 1.15)))

    isolated = original.copy()
    isolated.putalpha(alpha)
    return isolated


def _crop_to_content(image: Image.Image) -> Image.Image:
    """Crop to the bounding box of non-transparent pixels with padding."""
    bbox = _content_bbox(image)
    if bbox is None:
        return image

    left, top, right, bottom = _expand_bbox(bbox, image.size)
    return image.crop((left, top, right, bottom))


def _split_sprite_sheet(image: Image.Image, frame_count: int) -> list[Image.Image]:
    width, height = image.size
    frames: list[Image.Image] = []
    for index in range(frame_count):
        left = round(index * width / frame_count)
        right = round((index + 1) * width / frame_count)
        cell_width = max(1, right - left)
        inset_x = max(1, int(cell_width * 0.02))
        inset_y = max(1, int(height * 0.01))
        cropped = image.crop((
            min(width, left + inset_x),
            inset_y,
            max(min(width, right - inset_x), min(width, left + inset_x + 1)),
            max(inset_y + 1, height - inset_y),
        ))
        frames.append(cropped.convert("RGBA"))
    return frames


def _content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = image.split()[3]
    return alpha.point(lambda v: 255 if v > 10 else 0).getbbox()


def _expand_bbox(
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
) -> tuple[int, int, int, int]:
    pad = max(8, int(min(image_size[0], image_size[1]) * 0.03))
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(image_size[0], bbox[2] + pad)
    bottom = min(image_size[1], bbox[3] + pad)
    return (left, top, right, bottom)


def _union_bboxes(
    boxes: list[tuple[int, int, int, int]],
) -> tuple[int, int, int, int]:
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[2] for box in boxes)
    bottom = max(box[3] for box in boxes)
    return (left, top, right, bottom)


def _crop_to_shared_bbox(
    frame: Image.Image,
    bbox: tuple[int, int, int, int],
    target_width: int,
    target_height: int,
) -> Image.Image:
    canvas = Image.new("RGBA", (target_width, target_height), (0, 0, 0, 0))
    left, top, right, bottom = bbox
    crop_left = max(0, left)
    crop_top = max(0, top)
    crop_right = min(frame.width, right)
    crop_bottom = min(frame.height, bottom)
    if crop_right <= crop_left or crop_bottom <= crop_top:
        return canvas

    cropped = frame.crop((crop_left, crop_top, crop_right, crop_bottom))
    paste_x = crop_left - left
    paste_y = crop_top - top
    canvas.paste(cropped, (paste_x, paste_y), cropped)
    return canvas


def _build_overlay_clip(
    frames: list[Image.Image],
    action: str | None,
) -> dict[str, Any] | None:
    if action not in {"yawn"} or len(frames) <= 1:
        return None

    base_frame = frames[0]
    motion_bbox, masks = _compute_motion_bbox_and_masks(frames, action)
    if motion_bbox is None:
        return {
            "mode": "overlay",
            "baseSrc": _image_to_data_url(base_frame),
            "overlaySrc": _image_to_data_url(Image.new("RGBA", (1, 1), (0, 0, 0, 0))),
            "overlayFrameWidth": 1,
            "overlayFrameHeight": 1,
            "overlayOffsetX": 0,
            "overlayOffsetY": 0,
        }

    left, top, right, bottom = motion_bbox
    overlay_width = max(1, right - left)
    overlay_height = max(1, bottom - top)
    overlay_sheet = Image.new("RGBA", (overlay_width * len(frames), overlay_height), (0, 0, 0, 0))

    for index, frame in enumerate(frames):
        cropped = frame.crop(motion_bbox)
        mask = masks[index].crop(motion_bbox)
        alpha = ImageChops.multiply(cropped.getchannel("A"), mask)
        cropped.putalpha(alpha)
        overlay_sheet.paste(cropped, (index * overlay_width, 0), cropped)

    return {
        "mode": "overlay",
        "baseSrc": _image_to_data_url(base_frame),
        "overlaySrc": _image_to_data_url(overlay_sheet),
        "overlayFrameWidth": overlay_width,
        "overlayFrameHeight": overlay_height,
        "overlayOffsetX": left,
        "overlayOffsetY": top,
    }


def _compute_motion_bbox_and_masks(
    frames: list[Image.Image],
    action: str | None,
) -> tuple[tuple[int, int, int, int] | None, list[Image.Image]]:
    base_frame = frames[0]
    masks = [_difference_mask(base_frame, frame) for frame in frames]
    boxes = [mask.getbbox() for mask in masks if mask.getbbox() is not None]
    if not boxes:
        return None, masks

    motion_bbox = _union_bboxes(boxes)
    motion_bbox = _expand_bbox(motion_bbox, base_frame.size)
    if action == "yawn":
        content_bbox = _content_bbox(base_frame)
        if content_bbox is not None:
            face_bbox = _face_core_bbox(content_bbox, base_frame.size)
            motion_bbox = (
                max(face_bbox[0], motion_bbox[0]),
                max(face_bbox[1], motion_bbox[1]),
                min(face_bbox[2], motion_bbox[2]),
                min(face_bbox[3], motion_bbox[3]),
            )
            if motion_bbox[2] <= motion_bbox[0] or motion_bbox[3] <= motion_bbox[1]:
                motion_bbox = face_bbox
            motion_bbox = _expand_bbox(motion_bbox, base_frame.size)

    return motion_bbox, masks


def _face_core_bbox(
    content_bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
) -> tuple[int, int, int, int]:
    left, top, right, bottom = content_bbox
    width = right - left
    height = bottom - top
    face_left = int(left + width * 0.16)
    face_right = int(left + width * 0.84)
    face_top = int(top + height * 0.03)
    face_bottom = int(top + height * 0.33)
    return _expand_bbox((face_left, face_top, face_right, face_bottom), image_size)


def _difference_mask(base_frame: Image.Image, frame: Image.Image) -> Image.Image:
    diff = ImageChops.difference(base_frame, frame).convert("RGBA")
    alpha = frame.getchannel("A")
    diff_alpha = diff.getchannel("A")

    rgb_diff = diff.convert("RGB")
    grayscale = ImageOps.grayscale(rgb_diff)
    combined = ImageChops.lighter(grayscale, diff_alpha)
    combined = ImageChops.multiply(combined, alpha)
    combined = combined.point(lambda value: 255 if value >= 28 else 0)
    combined = combined.filter(ImageFilter.MaxFilter(9))
    combined = combined.filter(ImageFilter.GaussianBlur(2.2))
    return combined.point(lambda value: 255 if value >= 10 else 0)


def _sample_background_color(image: Image.Image) -> tuple[int, int, int]:
    """Sample average color from the four corners."""
    width, height = image.size
    sample = max(4, min(width, height) // 12)
    blocks = [
        (0, 0, sample, sample),
        (width - sample, 0, width, sample),
        (0, height - sample, sample, height),
        (width - sample, height - sample, width, height),
    ]
    total_r = total_g = total_b = 0
    count = 0
    rgb = image.convert("RGB")
    for left, top, right, bottom in blocks:
        for x in range(left, right):
            for y in range(top, bottom):
                r, g, b = rgb.getpixel((x, y))
                total_r += r
                total_g += g
                total_b += b
                count += 1
    if count == 0:
        return (255, 255, 255)
    return (total_r // count, total_g // count, total_b // count)


def _flood_fill_background(image: Image.Image, bg_color: tuple[int, int, int]) -> Image.Image:
    """Flood fill from all edges to identify background pixels."""
    width, height = image.size
    pixels = image.load()
    mask = Image.new("L", (width, height), 0)
    mask_pixels = mask.load()
    queue: deque[tuple[int, int]] = deque()

    def try_enqueue(x: int, y: int) -> None:
        if mask_pixels[x, y] != 0:
            return
        if _is_background_pixel(pixels[x, y], bg_color):
            mask_pixels[x, y] = 255
            queue.append((x, y))

    for x in range(width):
        try_enqueue(x, 0)
        try_enqueue(x, height - 1)
    for y in range(height):
        try_enqueue(0, y)
        try_enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height:
                try_enqueue(nx, ny)

    return mask


def _is_background_pixel(pixel: tuple[int, int, int], bg_color: tuple[int, int, int]) -> bool:
    """Check if a pixel is close enough to the background color."""
    channel_delta = max(abs(pixel[i] - bg_color[i]) for i in range(3))
    total_delta = sum(abs(pixel[i] - bg_color[i]) for i in range(3))
    return channel_delta <= BACKGROUND_TOLERANCE and total_delta <= BACKGROUND_TOLERANCE * 2


async def _load_image(image_url: str) -> Image.Image:
    if image_url.startswith("data:image/"):
        encoded = image_url.split(",", 1)[1]
        data = base64.b64decode(encoded)
        return Image.open(io.BytesIO(data)).convert("RGBA")

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.get(image_url)
        response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGBA")


def _image_to_data_url(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
