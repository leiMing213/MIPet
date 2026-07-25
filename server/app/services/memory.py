from collections import defaultdict

from app.schemas import InteractionEvent, MemoryItem


class MemoryService:
    def __init__(self) -> None:
        self._memories: dict[str, list[MemoryItem]] = defaultdict(list)

    def write_from_event(self, pet_id: str, event: InteractionEvent) -> MemoryItem | None:
        candidates = {
            "feed": "主人主动给我准备了食物。",
            "clean": "主人及时帮我清理了生活空间。",
            "pet": "主人主动摸了摸我。",
        }
        content = candidates.get(event.type)
        if not content:
            return None
        item = MemoryItem(pet_id=pet_id, type=f"interaction_{event.type}", content=content, importance=0.55)
        self._memories[pet_id].append(item)
        return item

    def recent(self, pet_id: str, limit: int = 5) -> list[MemoryItem]:
        return list(reversed(self._memories[pet_id][-limit:]))


memory_service = MemoryService()
