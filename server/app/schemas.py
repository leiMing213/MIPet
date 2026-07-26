from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PetState(BaseModel):
    hunger: int = Field(68, ge=0, le=100)
    cleanliness: int = Field(86, ge=0, le=100)
    mood: int = Field(78, ge=0, le=100)
    affection: int = Field(12, ge=0, le=100)
    action: Literal["idle", "walk", "eat", "pet"] = "idle"
    level: int = Field(1, ge=1)
    xp: int = Field(0, ge=0)
    evolution_stage: int = Field(1, ge=1, le=3, alias="evolutionStage")

    model_config = ConfigDict(populate_by_name=True)


class PetProfile(BaseModel):
    id: str
    name: str
    species: Literal["cat", "dog"]
    mbti: str
    owner_name: str = Field(alias="ownerName")
    owner_mbti: str | None = Field(None, alias="ownerMbti")
    appearance_mode: Literal["default", "custom"] = Field("default", alias="appearanceMode")
    custom_image: str | None = Field(None, alias="customImage")
    created_at: str = Field(alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


class PetSnapshot(BaseModel):
    profile: PetProfile
    state: PetState


class PetContext(BaseModel):
    pet_id: str
    pet_name: str = "团子"
    species: Literal["cat", "dog"] = "cat"
    mbti: str = "INFP"
    state: PetState = PetState()
    recent_messages: list[str] = []


class InteractionEvent(BaseModel):
    type: Literal["chat", "pet", "feed", "clean", "walk", "idle"]
    content: str | None = None
    metadata: dict[str, str | int | float | bool] = {}


class DecisionRequest(BaseModel):
    context: PetContext
    event: InteractionEvent


class DecisionResponse(BaseModel):
    action: str
    animation: str
    emotion: str
    dialogue: str
    memory_write: str | None = None
    next_trigger_seconds: int | None = None
    fallback: bool = False


class AgentPlanRequest(BaseModel):
    context: PetContext
    trigger: Literal["timer", "important_event", "state_change", "user_request"]


class MemoryItem(BaseModel):
    pet_id: str
    type: str
    content: str
    importance: float = Field(0.5, ge=0, le=1)
    confidence: float = Field(0.8, ge=0, le=1)
    created_at: str | None = Field(None, alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


class ChatMessage(BaseModel):
    id: int
    pet_id: str = Field(alias="petId")
    role: Literal["user", "assistant"]
    content: str
    created_at: str = Field(alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


class GrowthRecord(BaseModel):
    id: int
    pet_id: str = Field(alias="petId")
    event_type: str = Field(alias="eventType")
    xp_delta: int = Field(alias="xpDelta")
    level: int
    evolution_stage: int = Field(alias="evolutionStage")
    detail: str | None = None
    created_at: str = Field(alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


class InteractionResult(BaseModel):
    memory: MemoryItem | None = None
    state: PetState | None = None


class AppearanceRequest(BaseModel):
    image_data_url: str
    prompt: str


class AppearanceResponse(BaseModel):
    status: str
    image_url: str | None = None
    task_id: str | None = None
    progress: int = 0
    message: str | None = None
