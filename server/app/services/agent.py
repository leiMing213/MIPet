import json
import logging

from app.agno.registry import get_or_create_agent
from app.schemas import AgentPlanRequest, DecisionRequest, DecisionResponse, InteractionEvent
from app.services.model_gateway import local_fallback

logger = logging.getLogger(__name__)

ALLOWED_ACTIONS = {"idle", "walk", "eat", "pet"}


async def plan(request: AgentPlanRequest) -> DecisionResponse:
    """Agent planner using Agno. Falls back to rules if LLM unavailable."""
    ctx = request.context
    agent = get_or_create_agent(ctx.pet_id, ctx.pet_name, ctx.species, ctx.mbti)

    def rule_fallback() -> DecisionResponse:
        state = ctx.state
        fb_req = DecisionRequest(context=ctx, event=InteractionEvent(type="idle"))
        if state.hunger >= 82:
            result = local_fallback(fb_req)
            result.action = "idle"
            result.animation = "idle"
            result.dialogue = "饭盆空了这件事，我已经观察了一会儿。"
            return result
        result = local_fallback(fb_req)
        result.action = "idle" if ctx.mbti in {"INFP", "INTJ"} else "walk"
        result.animation = result.action
        result.dialogue = "我先安静陪着你。" if result.action == "idle" else "我来看看你在忙什么。"
        return result

    if agent is None:
        return rule_fallback()

    try:
        prompt = f"当前触发：{request.trigger}。请决定接下来的行为，返回JSON：action/animation/emotion/dialogue/memory_write/next_trigger_seconds"
        response = await agent.arun(prompt, stream=False)
        content = response.content.strip() if response.content else ""
        content = content.removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(content)
        if parsed.get("action") not in ALLOWED_ACTIONS:
            parsed["action"] = "idle"
        if parsed.get("animation") not in ALLOWED_ACTIONS:
            parsed["animation"] = parsed["action"]
        return DecisionResponse.model_validate({**rule_fallback().model_dump(), **parsed, "fallback": False})
    except Exception:
        logger.exception("Agno agent plan failed")
        return rule_fallback()
