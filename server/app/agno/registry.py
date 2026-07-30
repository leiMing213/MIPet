import logging

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.memory.manager import MemoryManager

from app.agno.config import get_data_dir, get_model
from app.agno.prompts import build_system_prompt
from app.agno.tools import get_pet_state_tool

logger = logging.getLogger(__name__)

_agents: dict[str, Agent] = {}


def get_or_create_agent(pet_id: str, pet_name: str, species: str, mbti: str) -> Agent | None:
    """Get an existing agent or create a new one for this pet."""
    if pet_id in _agents:
        return _agents[pet_id]

    model = get_model()
    if model is None:
        return None

    data_dir = get_data_dir()
    db_file = str(data_dir / "agno.db")

    db = SqliteDb(db_file=db_file, session_table="agno_sessions", memory_table="agno_memories")

    agent = Agent(
        model=model,
        id=f"mipet-{pet_id}",
        session_id=pet_id,
        system_message=build_system_prompt(pet_name, species, mbti),
        tools=[get_pet_state_tool(pet_id)],
        db=db,
        add_history_to_context=True,
        num_history_runs=10,
        memory_manager=MemoryManager(model=model, db=db),
        enable_user_memories=True,
        add_memories_to_context=True,
        markdown=False,
    )

    _agents[pet_id] = agent
    logger.info("Created Agno agent for pet %s (%s, %s)", pet_id, mbti, species)
    return agent


def remove_agent(pet_id: str) -> None:
    """Remove a cached agent instance."""
    _agents.pop(pet_id, None)
