import json
from datetime import datetime, timedelta, timezone

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


def get_mbti_data_tools(pet_id: str) -> list:
    @tool(name="get_chat_history")
    def get_chat_history(limit: int = 20) -> str:
        """获取主人最近的聊天消息记录，用于分析互动风格和性格倾向。limit参数控制返回消息数量。"""
        messages = database.recent_user_messages(pet_id, limit=limit)
        if not messages:
            return "暂无聊天记录。"
        return json.dumps(messages, ensure_ascii=False)

    @tool(name="get_interaction_stats")
    def get_interaction_stats() -> str:
        """获取互动统计数据（按类型分组：近7天 vs 总计），用于分析主人的行为偏好。"""
        since_7d = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        stats = database.interaction_stats(pet_id, since_7d)
        return json.dumps(stats, ensure_ascii=False)

    @tool(name="get_memories")
    def get_memories() -> str:
        """获取记忆条目，了解主人的长期行为模式和偏好。"""
        memories = database.recent_memories(pet_id, limit=20)
        if not memories:
            return "暂无记忆记录。"
        items = [{"type": m.type, "content": m.content, "importance": m.importance} for m in memories]
        return json.dumps(items, ensure_ascii=False)

    return [get_chat_history, get_interaction_stats, get_memories]
