import json
import logging
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.agno.registry import get_or_create_agent
from app.agno.streaming import agent_stream_to_sse
from app.database import database
from app.schemas import AgentPlanRequest, AppearanceRequest, AppearanceResponse, ChatMessage, DecisionRequest, DecisionResponse, GrowthRecord, InteractionEvent, InteractionResult, MemoryItem, PetSnapshot, PetState
from app.services.agent import plan
from app.services.image_gateway import generate_pet_image, query_pet_image_task
from app.services.memory import memory_service
from app.services.model_gateway import local_fallback

logger = logging.getLogger(__name__)

app = FastAPI(title="MiPet AI Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "mipet-ai", "database": str(database.path)}


@app.post("/v1/pets", response_model=PetSnapshot)
async def save_pet(snapshot: PetSnapshot):
    return database.upsert_pet(snapshot)


@app.get("/v1/pets/latest", response_model=PetSnapshot | None)
async def latest_pet():
    return database.latest_pet()


@app.get("/v1/pets/{pet_id}", response_model=PetSnapshot | None)
async def get_pet(pet_id: str):
    return database.get_pet(pet_id)


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
    return AppearanceResponse(**result)


@app.get("/v1/pets/{pet_id}/appearance/tasks/{task_id}", response_model=AppearanceResponse)
async def query_appearance(pet_id: str, task_id: str):
    result = await query_pet_image_task(task_id)
    return AppearanceResponse(**result)
