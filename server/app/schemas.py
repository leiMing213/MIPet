from typing import Literal

from pydantic import BaseModel, Field


class PetState(BaseModel):
    hunger: int = Field(68, ge=0, le=100)
    cleanliness: int = Field(86, ge=0, le=100)
    mood: int = Field(78, ge=0, le=100)
    affection: int = Field(12, ge=0, le=100)


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


class AppearanceRequest(BaseModel):
    image_data_url: str
    prompt: str


class AppearanceResponse(BaseModel):
    status: str
    image_url: str | None = None
    task_id: str | None = None
    progress: int = 0
    message: str | None = None
