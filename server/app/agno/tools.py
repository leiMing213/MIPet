import json

from agno.tools import tool

from app.database import database


def get_pet_state_tool(pet_id: str):
    @tool(name="get_pet_state")
    def get_pet_state() -> str:
        """查看自己当前的状态值（饥饿、清洁、心情、亲密度、等级）。当需要根据自身状态来回应时使用。"""
        snapshot = database.get_pet(pet_id)
        if not snapshot:
            return "无法获取当前状态。"
        state = snapshot.state
        return json.dumps(
            {
                "hunger": state.hunger,
                "cleanliness": state.cleanliness,
                "mood": state.mood,
                "affection": state.affection,
                "level": state.level,
                "xp": state.xp,
                "evolution_stage": state.evolution_stage,
            },
            ensure_ascii=False,
        )

    return get_pet_state
