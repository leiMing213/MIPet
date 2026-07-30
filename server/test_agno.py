import asyncio
from app.agno.registry import get_or_create_agent

agent = get_or_create_agent(
    "a8e12650-81d2-4190-8ed9-5bbdc8a467dd",
    "mi's pet",
    "dog",
    "INTP"
)
print("Agent created:", agent is not None)

async def test():
    try:
        resp = await agent.arun("你好", stream=False)
        print("Response:", resp.content[:200] if resp.content else "EMPTY")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")

asyncio.run(test())
