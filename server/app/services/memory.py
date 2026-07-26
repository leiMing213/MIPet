from app.database import database
from app.schemas import InteractionEvent, MemoryItem, PetState


class MemoryService:
    def write_from_event(self, pet_id: str, event: InteractionEvent) -> tuple[MemoryItem | None, PetState | None]:
        state = database.record_interaction(pet_id, event)
        candidates = {
            "feed": "主人主动给我准备了食物。",
            "clean": "主人及时帮我清理了生活空间。",
            "pet": "主人主动摸了摸我。",
        }
        content = candidates.get(event.type)
        if not content:
            return None, state
        memory = database.add_memory(MemoryItem(
            pet_id=pet_id,
            type=f"interaction_{event.type}",
            content=content,
            importance=0.55,
        ))
        return memory, state

    def write_model_memory(self, pet_id: str, content: str) -> MemoryItem:
        return database.add_memory(MemoryItem(
            pet_id=pet_id,
            type="dialogue_summary",
            content=content,
            importance=0.7,
        ))

    def recent(self, pet_id: str, limit: int = 10) -> list[MemoryItem]:
        return database.recent_memories(pet_id, limit)


memory_service = MemoryService()
