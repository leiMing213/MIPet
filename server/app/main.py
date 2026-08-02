import json
import logging
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.agno.registry import get_or_create_agent
from app.agno.streaming import agent_stream_to_sse
from app.database import database
from app.schemas import AgentPlanRequest, AppearanceGenerateRequest, AppearanceRequest, AppearanceResponse, ChatMessage, DecisionRequest, DecisionResponse, GrowthRecord, InteractionEvent, InteractionResult, MemoryItem, PetAnimationPack, PetSnapshot, PetState, SpriteSheetRequest, SpriteSheetResponse
from app.services.agent import plan
from app.services.animation_builder import enrich_pet_render_assets, normalize_animation_pack, process_sprite_sheet_from_url
from app.services.image_gateway import build_pet_prompt, build_sprite_sheet_prompt, generate_pet_image, generate_pet_image_default, generate_sprite_sheet, query_pet_image_task
from app.services.memory import memory_service
from app.services.model_gateway import local_fallback
from app.services.vision_gateway import analyze_pet_photo

logger = logging.getLogger(__name__)

app = FastAPI(title="MiPet AI Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _normalize_snapshot_assets(snapshot: PetSnapshot | None) -> PetSnapshot | None:
    if snapshot is None:
        return snapshot

    if snapshot.profile.custom_image:
        result = await enrich_pet_render_assets({
            "status": "completed",
            "image_url": snapshot.profile.custom_image,
        })
        image_url = result.get("image_url")
        if isinstance(image_url, str) and image_url:
            snapshot.profile.custom_image = image_url

    if snapshot.profile.custom_animation:
        pack = snapshot.profile.custom_animation.model_dump(by_alias=True, exclude_none=True)
        normalized_pack = await normalize_animation_pack(pack)
        if normalized_pack:
            snapshot.profile.custom_animation = PetAnimationPack.model_validate(normalized_pack)
    return snapshot


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "mipet-ai", "database": str(database.path)}


@app.post("/v1/pets", response_model=PetSnapshot)
async def save_pet(snapshot: PetSnapshot):
    return database.upsert_pet(snapshot)


@app.get("/v1/pets/latest", response_model=PetSnapshot | None)
async def latest_pet():
    return await _normalize_snapshot_assets(database.latest_pet())


@app.get("/v1/pets/{pet_id}", response_model=PetSnapshot | None)
async def get_pet(pet_id: str):
    return await _normalize_snapshot_assets(database.get_pet(pet_id))


@app.put("/v1/pets/{pet_id}/state", response_model=PetState)
async def save_pet_state(pet_id: str, state: PetState):
    return database.update_state(pet_id, state)


@app.post("/v1/pets/{pet_id}/events", response_model=InteractionResult)
async def record_event(pet_id: str, event: InteractionEvent):
    memory, state = memory_service.write_from_event(pet_id, event)
    return InteractionResult(memory=memory, state=state)


@app.get("/v1/pets/{pet_id}/memories", response_model=list[MemoryItem])
async def list_memories(pet_id: str):
    return memory_service.recent(pet_id)


@app.get("/v1/pets/{pet_id}/messages", response_model=list[ChatMessage])
async def list_messages(pet_id: str):
    return database.recent_messages(pet_id)


@app.get("/v1/pets/{pet_id}/growth", response_model=list[GrowthRecord])
async def list_growth(pet_id: str):
    return database.recent_growth(pet_id)


@app.post("/v1/pets/{pet_id}/decision", response_model=DecisionResponse)
async def decision(pet_id: str, request: DecisionRequest):
    database.record_interaction(pet_id, request.event)
    if request.event.type == "chat" and request.event.content:
        database.add_message(pet_id, "user", request.event.content)

    ctx = request.context
    agent = get_or_create_agent(ctx.pet_id, ctx.pet_name, ctx.species, ctx.mbti)
    if agent is None:
        result = local_fallback(request)
    else:
        try:
            user_input = json.dumps(
                {"state": ctx.state.model_dump(), "event": request.event.model_dump()},
                ensure_ascii=False,
            )
            response = await agent.arun(user_input, stream=False)
            content = response.content.strip() if response.content else ""
            content = content.removeprefix("```json").removesuffix("```").strip()
            parsed = json.loads(content)
            result = DecisionResponse.model_validate({**local_fallback(request).model_dump(), **parsed, "fallback": False})
        except Exception:
            logger.exception("Agno decision failed")
            result = local_fallback(request)

    if result.dialogue:
        database.add_message(pet_id, "assistant", result.dialogue)
    if result.memory_write:
        memory_service.write_model_memory(pet_id, result.memory_write)
    return result


@app.post("/v1/pets/{pet_id}/chat/stream")
async def chat_stream(pet_id: str, request: DecisionRequest):
    return StreamingResponse(
        persisted_chat_stream(pet_id, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def persisted_chat_stream(pet_id: str, request: DecisionRequest) -> AsyncGenerator[str, None]:
    database.record_interaction(pet_id, request.event)
    is_chat = request.event.type == "chat"
    if is_chat and request.event.content:
        database.add_message(pet_id, "user", request.event.content)

    ctx = request.context
    agent = get_or_create_agent(ctx.pet_id, ctx.pet_name, ctx.species, ctx.mbti)

    if agent is None:
        fallback = local_fallback(request)
        yield f"data: {json.dumps({'token': fallback.dialogue}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'done': True, 'animation': fallback.animation})}\n\n"
        if is_chat and fallback.dialogue:
            database.add_message(pet_id, "assistant", fallback.dialogue)
        return

    reply_parts: list[str] = []
    assistant_saved = False
    async for event in agent_stream_to_sse(agent, request.event.content or "你好", request):
        if event.startswith("data: "):
            try:
                data = json.loads(event[6:])
            except (json.JSONDecodeError, TypeError):
                data = {}
            if not isinstance(data, dict):
                data = {}

            token = data.get("token")
            if isinstance(token, str) and token:
                reply_parts.append(token)

            if is_chat and data.get("done") and reply_parts and not assistant_saved:
                database.add_message(pet_id, "assistant", "".join(reply_parts))
                assistant_saved = True

        yield event

    if is_chat and reply_parts and not assistant_saved:
        database.add_message(pet_id, "assistant", "".join(reply_parts))


@app.post("/v1/pets/{pet_id}/agent/plan", response_model=DecisionResponse)
async def agent_plan(pet_id: str, request: AgentPlanRequest):
    return await plan(request)


@app.post("/v1/pets/{pet_id}/appearance", response_model=AppearanceResponse)
async def generate_appearance(pet_id: str, request: AppearanceRequest):
    result = await generate_pet_image(request.image_data_url, request.prompt)
    result = await enrich_pet_render_assets(result)
    return AppearanceResponse(**result)


@app.post("/v1/pets/appearance/generate", response_model=AppearanceResponse)
async def generate_appearance_auto(request: AppearanceGenerateRequest):
    """Generate pet image. Analyzes photo with vision if provided, then generates."""
    features = None
    if request.image_data_url:
        features = await analyze_pet_photo(request.image_data_url)

    prompt = build_pet_prompt(request.species, request.mbti, features)

    if request.image_data_url:
        result = await generate_pet_image(request.image_data_url, prompt)
    else:
        result = await generate_pet_image_default(prompt)
    result = await enrich_pet_render_assets(result)
    return AppearanceResponse(**result)


@app.get("/v1/pets/{pet_id}/appearance/tasks/{task_id}", response_model=AppearanceResponse)
async def query_appearance(pet_id: str, task_id: str):
    result = await query_pet_image_task(task_id)
    result = await enrich_pet_render_assets(result)
    return AppearanceResponse(**result)


@app.get("/v1/appearance/tasks/{task_id}", response_model=AppearanceResponse)
async def query_appearance_global(task_id: str):
    """Query task without requiring pet_id (for creation flow)."""
    result = await query_pet_image_task(task_id)
    result = await enrich_pet_render_assets(result)
    return AppearanceResponse(**result)


@app.post("/v1/appearance/sprite-sheet", response_model=SpriteSheetResponse)
async def generate_action_sprite_sheet(request: SpriteSheetRequest):
    """Generate a sprite sheet for a specific action using AI image generation."""
    character_desc = build_pet_prompt(request.species, request.mbti)
    prompt = build_sprite_sheet_prompt(request.action, character_desc, request.species)
    should_loop = request.action not in ("yawn",)

    result = await generate_sprite_sheet(request.reference_image_url, prompt)

    if result.get("status") == "completed" and result.get("image_url"):
        clip_data = await process_sprite_sheet_from_url(
            result["image_url"],
            frame_count=6,
            loop=should_loop,
            action=request.action,
        )
        return SpriteSheetResponse(status="completed", clip=clip_data)

    return SpriteSheetResponse(
        status=result.get("status", "in_progress"),
        task_id=result.get("task_id"),
        message=result.get("message"),
    )


@app.get("/v1/appearance/sprite-sheet/tasks/{task_id}", response_model=SpriteSheetResponse)
async def query_sprite_sheet_task(task_id: str, loop: bool = False, action: str | None = None):
    """Poll a sprite sheet generation task."""
    result = await query_pet_image_task(task_id)

    if result.get("status") == "completed" and result.get("image_url"):
        clip_data = await process_sprite_sheet_from_url(
            result["image_url"],
            frame_count=6,
            loop=loop,
            action=action,
        )
        return SpriteSheetResponse(status="completed", clip=clip_data)

    if result.get("status") == "failed":
        return SpriteSheetResponse(status="failed", task_id=task_id, message=result.get("message"))

    return SpriteSheetResponse(
        status="in_progress",
        task_id=task_id,
        message=result.get("message", f"生成中（{result.get('progress', 0)}%）"),
    )
