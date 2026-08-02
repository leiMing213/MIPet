import logging
from pathlib import Path

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.memory.manager import MemoryManager
from agno.skills import Skills
from agno.skills.loaders.local import LocalSkills

from app.agno.config import get_data_dir, get_model
from app.agno.prompts import build_description, build_instructions
from app.agno.tools import get_mbti_data_tools, get_pet_state_tool

logger = logging.getLogger(__name__)

_agents: dict[str, Agent] = {}

SKILLS_DIR = Path(__file__).parent / "skills"


def get_or_create_agent(pet_id: str, pet_name: str, species: str, mbti: str, session_id: str | None = None) -> Agent | None:
    """Get an existing agent or create a new one for this pet/session."""
    effective_session = session_id or pet_id
    cache_key = f"{pet_id}:{effective_session}"

    if cache_key in _agents:
        return _agents[cache_key]

    model = get_model()
    if model is None:
        return None

    data_dir = get_data_dir()
    db_file = str(data_dir / "agno.db")

    db = SqliteDb(db_file=db_file, session_table="agno_sessions", memory_table="agno_memories")

    agent = Agent(
        model=model,
        id=f"mipet-{pet_id}",
        session_id=effective_session,
        description=build_description(pet_name, species, mbti),
        instructions=build_instructions(pet_name, species, mbti),
        skills=Skills(loaders=[LocalSkills(path=str(SKILLS_DIR))]),
        tools=[get_pet_state_tool(pet_id), *get_mbti_data_tools(pet_id)],
        db=db,
        add_history_to_context=True,
        num_history_runs=10,
        memory_manager=MemoryManager(model=model, db=db),
        enable_user_memories=True,
        add_memories_to_context=True,
        markdown=False,
    )

    _agents[cache_key] = agent
    logger.info("Created Agno agent for pet %s session %s (%s, %s)", pet_id, effective_session, mbti, species)
    return agent


def remove_agent(pet_id: str) -> None:
    """Remove a cached agent instance."""
    _agents.pop(pet_id, None)


def remove_agent_session(pet_id: str, session_id: str) -> None:
    """Remove the cached agent for a specific session."""
    _agents.pop(f"{pet_id}:{session_id}", None)


def invalidate_pet_agents(pet_id: str) -> None:
    """Remove all cached agents for a pet (all sessions). Called after MBTI change."""
    keys_to_remove = [k for k in _agents if k.startswith(f"{pet_id}:")]
    for key in keys_to_remove:
        del _agents[key]
    logger.info("Invalidated %d agent(s) for pet %s", len(keys_to_remove), pet_id)
