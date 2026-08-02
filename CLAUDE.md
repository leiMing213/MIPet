# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MIPet is a Windows AI desktop pet application with MBTI-driven personality. Electron + React + TypeScript frontend, Python FastAPI backend.

## Commands

```bash
# Frontend (Electron + React)
npm run dev              # Start Electron dev mode (uses scripts/dev.mjs → electron-vite dev)
npm run build            # Build Electron app
npm run dist             # Build + package with electron-builder

# Backend (FastAPI)
npm run server:dev       # Start backend with reload on port 8787
# Or manually:
cd server && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8787

# Full dev: run both commands in parallel (backend + frontend)
```

No test framework is configured.

## Architecture

Two-process Electron app with a spawned Python backend:

```
Electron Main (src/main/index.ts)
├── Main window: control panel UI (?mode=panel)
├── Pet window: transparent always-on-top overlay (?mode=pet)
├── Spawns FastAPI backend on startup
└── IPC: drag, walk, mouse passthrough

Preload (src/preload/index.ts)
└── Exposes window.mipet bridge via contextBridge

Renderer (src/renderer/)
├── App.tsx: routes MainWindow vs PetWindow based on ?mode= param
├── Two windows share state via localStorage + StorageEvent
└── HTTP fetch to http://127.0.0.1:8787 for all API calls

FastAPI Backend (server/app/)
├── main.py: REST endpoints
├── database.py: SQLite (WAL mode, thread-safe RLock)
├── schemas.py: Pydantic models with camelCase aliases
├── services/: model_gateway, image_gateway, memory, mbti_evolution, animation_builder
└── agno/: Agent framework (skills, tools, registry, streaming)
```

## Key Patterns

- **IPC bridge**: Typed `MipetBridge` in preload, accessed as `window.mipet`. Fallback bridge exists for non-Electron environments.
- **State**: React useState + localStorage persistence. No Redux/zustand in active use.
- **Streaming chat**: SSE via `POST /v1/pets/{id}/chat/stream`, consumed with EventSource-like fetch.
- **Pydantic convention**: All schemas use `Field(alias="camelCase")` + `ConfigDict(populate_by_name=True)`.
- **Agent framework**: Agno SDK with Skills (loaded from `server/app/agno/skills/`), Tools, and session-based memory. Falls back to local responses when no API keys configured.
- **Pet window mouse passthrough**: `setIgnoreMouseEvents(true, { forward: true })` toggles based on hover/chat/drag state. Guard with `chatOpenRef` to prevent passthrough while chat input is active.
- **Two-window sync**: localStorage writes in one window trigger `StorageEvent` in the other.

## Environment

- Python venv: `server/.venv/`
- Database: `server/data/mipet.db` (or `MIPET_DATA_DIR` env var)
- Model keys in `.env`: `MIMO_BASE_URL/API_KEY/MODEL` (chat LLM), `IMAGE2_*` (image gen), `VISION_*` (vision)
- Platform: Windows only (Electron paths, `.exe` references)
- TypeScript: strict mode, `@` alias maps to `src/renderer/`
- Language: UI strings and commit messages in Chinese

## Agno Skills

Skills are loaded from `server/app/agno/skills/` directories. Each skill has a `SKILL.md` with frontmatter. Skill names must use only letters, digits, and hyphens (no underscores).

## Backend Auto-Start

In dev: Electron main spawns `server/.venv/Scripts/python.exe -m uvicorn ...`
In prod: spawns bundled `mipet-server.exe`
