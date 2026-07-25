# MiPet AI Service

这是 MiPet 的 FastAPI 服务骨架，当前包含：

- 宠物互动事件接收
- 结构化记忆写入与查询
- 受约束的轻量 Agent 行为计划
- MiMo/OpenAI 兼容模型网关占位

## 运行

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8787
```

## 环境变量

```text
MIMO_BASE_URL=
MIMO_API_KEY=
MIMO_MODEL=
```

未配置模型时，服务会返回本地降级结果，便于客户端联调。
