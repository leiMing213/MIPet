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
    session_id: str | None = None


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


class ChatSession(BaseModel):
    id: str
    pet_id: str = Field(alias="petId")
    title: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


class CreateSessionRequest(BaseModel):
    title: str = "新对话"


class UpdateSessionRequest(BaseModel):
    title: str


class ChatMessage(BaseModel):
    id: int
    pet_id: str = Field(alias="petId")
    role: Literal["user", "assistant"]
    content: str
    session_id: str | None = Field(None, alias="sessionId")
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


# --- MBTI Evolution ---

class QuestionOption(BaseModel):
    label: str
    dimension: Literal["EI", "SN", "TF", "JP"]
    direction: Literal["+", "-"]


class MbtiQuestionCreate(BaseModel):
    content: str
    options: list[QuestionOption]
    sort_order: int = Field(0, alias="sortOrder")

    model_config = ConfigDict(populate_by_name=True)


class MbtiQuestionUpdate(BaseModel):
    content: str | None = None
    options: list[QuestionOption] | None = None
    sort_order: int | None = Field(None, alias="sortOrder")
    is_active: bool | None = Field(None, alias="isActive")

    model_config = ConfigDict(populate_by_name=True)


class MbtiQuestion(BaseModel):
    id: int
    pet_id: str = Field(alias="petId")
    content: str
    options: list[QuestionOption]
    sort_order: int = Field(alias="sortOrder")
    is_active: bool = Field(True, alias="isActive")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


class MbtiTriggerStatus(BaseModel):
    should_trigger: bool = Field(alias="shouldTrigger")
    reason: str | None = None
    days_since_creation: int = Field(alias="daysSinceCreation")
    days_since_last_eval: int | None = Field(None, alias="daysSinceLastEval")
    interaction_count_since_last: int = Field(alias="interactionCountSinceLast")

    model_config = ConfigDict(populate_by_name=True)


class QuestionAnswer(BaseModel):
    question_id: int = Field(alias="questionId")
    selected_option_index: int = Field(alias="selectedOptionIndex")

    model_config = ConfigDict(populate_by_name=True)


class MbtiEvaluationRequest(BaseModel):
    answers: list[QuestionAnswer]
    trigger_type: str = Field("manual", alias="triggerType")
    session_id: str | None = Field(None, alias="sessionId")

    model_config = ConfigDict(populate_by_name=True)


class MbtiEvaluationResult(BaseModel):
    evaluation_id: int = Field(alias="evaluationId")
    old_mbti: str = Field(alias="oldMbti")
    suggested_mbti: str | None = Field(None, alias="suggestedMbti")
    reasoning: str
    changed: bool

    model_config = ConfigDict(populate_by_name=True)


class MbtiConfirmRequest(BaseModel):
    confirmed: bool


class MbtiConfirmResult(BaseModel):
    mbti: str
    changed: bool


class MbtiEvaluationRecord(BaseModel):
    id: int
    pet_id: str = Field(alias="petId")
    trigger_type: str = Field(alias="triggerType")
    old_mbti: str = Field(alias="oldMbti")
    suggested_mbti: str | None = Field(None, alias="suggestedMbti")
    reasoning: str | None = None
    user_confirmed: bool | None = Field(None, alias="userConfirmed")
    confirmed_at: str | None = Field(None, alias="confirmedAt")
    created_at: str = Field(alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)
