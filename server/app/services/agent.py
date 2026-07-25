from app.schemas import AgentPlanRequest, DecisionRequest, DecisionResponse, InteractionEvent
from app.services.model_gateway import local_fallback


ALLOWED_ACTIONS = {"idle", "walk", "eat", "pet"}


async def plan(request: AgentPlanRequest) -> DecisionResponse:
    """Bounded observe -> gate -> decide planner.

    The agent never changes client state directly and can only choose from the
    four action ids understood by the desktop runtime.
    """
    state = request.context.state

    def fallback(event_type: str) -> DecisionResponse:
        return local_fallback(DecisionRequest(context=request.context, event=InteractionEvent(type=event_type)))

    if state.hunger >= 82:
        result = fallback("feed")
        result.action = "idle"
        result.animation = "idle"
        result.dialogue = "饭盆空了这件事，我已经观察了一会儿。"
        return result
    result = fallback("idle")
    result.action = "idle" if request.context.mbti in {"INFP", "INTJ"} else "walk"
    result.animation = result.action
    result.dialogue = "我先安静陪着你。" if result.action == "idle" else "我来看看你在忙什么。"
    return result
