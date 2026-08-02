# MiPet — AI 桌面宠物

MiPet 是一款基于 MBTI 人格驱动的 Windows AI 桌面宠物应用。宠物拥有独立性格，能流式对话、自主行为、记忆成长，并随长期陪伴发生性格演化。

## 核心特性

- **MBTI 人格系统**：16 种性格类型驱动对话风格与行为模式，互动量/周期自动触发问卷 + LLM 综合评估实现人格动态演化
- **Agent 智能中枢**：基于 Agno 框架，Skills · Tools · Memory 三位一体，MiMo 大模型底层推理驱动自主决策
- **流式对话**：SSE 逐 token 实时推送，多会话隔离管理
- **AI 外观生成**：图像生成 + Vision 视觉分析 + Sprite 自动切割，智能生成宠物形象与动画
- **双窗口架构**：管理面板 + 透明置顶桌宠悬浮窗，localStorage 实时状态同步
- **长期记忆**：事件记忆 + 对话记忆 + 成长经验多层累积

## 技术栈

| 层级 | 技术 |
|------|------|
| 客户端 | Electron 36 + React 19 + TypeScript + Three.js |
| 后端 | Python FastAPI + Uvicorn |
| 智能引擎 | Agno Agent SDK + MiMo 推理模型 |
| 存储 | SQLite (WAL mode) |
| 图像 | AI Image Generation + Vision Model + Pillow |
| 构建 | electron-vite + electron-builder (NSIS) |

## 快速开始

### 环境准备

- Node.js 18+
- Python 3.11+
- Windows 操作系统

### 安装

```bash
# 前端依赖
npm install

# 后端依赖
cd server
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
```

### 配置环境变量

复制 `.env.example` 到 `.env` 并填写：

```env
MIMO_BASE_URL=        # 对话模型 API 地址
MIMO_API_KEY=         # 对话模型 API Key
MIMO_MODEL=           # 对话模型名称
IMAGE2_BASE_URL=      # 图像生成 API 地址
IMAGE2_API_KEY=       # 图像生成 API Key
IMAGE2_MODEL=         # 图像生成模型
VISION_BASE_URL=      # 视觉模型 API 地址
VISION_API_KEY=       # 视觉模型 API Key
VISION_MODEL=         # 视觉模型名称
```

### 启动开发

```bash
# 终端 1：启动后端
npm run server:dev

# 终端 2：启动前端（Electron）
npm run dev
```

### 构建发布

```bash
npm run build    # 编译
npm run dist     # 打包为 Windows 安装包
```

## 项目结构

```
MiPet/
├── src/
│   ├── main/           # Electron 主进程
│   ├── preload/        # 预加载脚本（contextBridge）
│   ├── renderer/       # React 渲染层
│   └── shared/         # 共享类型定义
├── server/
│   └── app/
│       ├── main.py     # FastAPI 路由
│       ├── database.py # 数据持久化
│       ├── schemas.py  # Pydantic 模型
│       ├── services/   # 业务服务（对话/MBTI/图像/记忆）
│       └── agno/       # Agent 框架（Skills/Tools/Registry）
├── docs/               # 文档与架构图
└── scripts/            # 开发脚本
```

## 许可证

MIT
