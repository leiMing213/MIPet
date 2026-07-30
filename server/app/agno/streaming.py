import json
import logging
from collections.abc import AsyncGenerator

from agno.agent import Agent
from agno.run.agent import RunContentEvent

from app.schemas import DecisionRequest
from app.services.model_gateway import local_fallback

logger = logging.getLogger(__name__)


async def agent_stream_to_sse(agent: Agent, message: str, request: DecisionRequest) -> AsyncGenerator[str, None]:
    """Convert Agno agent streaming response to SSE format.

    Yields: 'data: {"token": "..."}\n\n' per chunk, ending with 'data: {"done": true, "animation": "idle"}\n\n'
    """
    try:
        async for event in agent.arun(message, stream=True):
            if isinstance(event, RunContentEvent) and event.content:
                yield f"data: {json.dumps({'token': event.content}, ensure_ascii=False)}\n\n"

        yield f"data: {json.dumps({'done': True, 'animation': 'idle'})}\n\n"

    except Exception as exc:
        logger.exception("Agno streaming failed, falling back: %s", exc)
        fallback = local_fallback(request)
        yield f"data: {json.dumps({'token': fallback.dialogue}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'done': True, 'animation': fallback.animation})}\n\n"
