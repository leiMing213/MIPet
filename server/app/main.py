from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import AgentPlanRequest, AppearanceRequest, AppearanceResponse, DecisionRequest, DecisionResponse, InteractionEvent, MemoryItem
from app.services.agent import plan
from app.services.image_gateway import generate_pet_image, query_pet_image_task
from app.services.memory import memory_service
from app.services.model_gateway import decide

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
    return {"status": "ok", "service": "mipet-ai"}


@app.post("/v1/pets/{pet_id}/events", response_model=MemoryItem | None)
async def record_event(pet_id: str, event: InteractionEvent):
    return memory_service.write_from_event(pet_id, event)


@app.get("/v1/pets/{pet_id}/memories", response_model=list[MemoryItem])
async def list_memories(pet_id: str):
    return memory_service.recent(pet_id)


@app.post("/v1/pets/{pet_id}/decision", response_model=DecisionResponse)
async def decision(pet_id: str, request: DecisionRequest):
    return await decide(request)


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
