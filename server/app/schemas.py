from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PetState(BaseModel):
    hunger: int = Field(68, ge=0, le=100)
    cleanliness: int = Field(86, ge=0, le=100)
    mood: int = Field(78, ge=0, le=100)
    affection: int = Field(12, ge=0, le=100)
    action: Literal["idle", "walk", "eat", "pet", "yawn"] = "idle"
    level: int = Field(1, ge=1)
    xp: int = Field(0, ge=0)
    evolution_stage: int = Field(1, ge=1, le=3, alias="evolutionStage")

    model_config = ConfigDict(populate_by_name=True)


class PetAnimationClip(BaseModel):
    src: str
    frame_width: int = Field(alias="frameWidth")
    frame_height: int = Field(alias="frameHeight")
    frame_count: int = Field(alias="frameCount")
    fps: int
    columns: int | None = None
    rows: int | None = None
    loop: bool = True
    mode: Literal["sheet", "overlay"] | None = None
    base_src: str | None = Field(None, alias="baseSrc")
    overlay_src: str | None = Field(None, alias="overlaySrc")
    overlay_frame_width: int | None = Field(None, alias="overlayFrameWidth")
    overlay_frame_height: int | None = Field(None, alias="overlayFrameHeight")
    overlay_offset_x: int | None = Field(None, alias="overlayOffsetX")
    overlay_offset_y: int | None = Field(None, alias="overlayOffsetY")

    model_config = ConfigDict(populate_by_name=True)


class PetAnimationPack(BaseModel):
    version: Literal["v1"] = "v1"
    idle: PetAnimationClip | None = None
    walk: PetAnimationClip | None = None
    eat: PetAnimationClip | None = None
    pet: PetAnimationClip | None = None
    yawn: PetAnimationClip | None = None

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
    custom_animation: PetAnimationPack | None = Field(None, alias="customAnimation")
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


class AppearanceGenerateRequest(BaseModel):
    species: Literal["cat", "dog"]
    mbti: str
    image_data_url: str | None = None


class SpriteSheetRequest(BaseModel):
    action: Literal["walk", "eat", "pet", "idle", "yawn"]
    species: Literal["cat", "dog"]
    mbti: str
    reference_image_url: str | None = None


class SpriteSheetResponse(BaseModel):
    status: str
    task_id: str | None = None
    clip: PetAnimationClip | None = None
    message: str | None = None


class AppearanceResponse(BaseModel):
    status: str
    image_url: str | None = None
    task_id: str | None = None
    progress: int = 0
    message: str | None = None
    animation_pack: PetAnimationPack | None = Field(None, alias="animationPack")

    model_config = ConfigDict(populate_by_name=True)
