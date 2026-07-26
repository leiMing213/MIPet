# MiPet 开发上下文与换机交接

> 更新时间：2026-07-27  
> 仓库：<https://github.com/leiMing213/MIPet>  
> Windows 工作目录：`D:\MyFiles\MIPet`

这份文档用于沉淀当前开发对话中的需求背景、实现状态、关键技术细节和协作约定。换电脑或开启新的开发对话后，应先阅读本文件，再继续修改代码。

## 1. 产品目标

MiPet 是一款 Windows 桌面宠物应用。当前核心方向是：

- 宠物常驻透明桌面窗口，不显示黑色背景或多余边框。
- 宠物可以拖动、散步、喂食、清洁、抚摸和聊天。
- 用户靠近宠物时显示对话和操作区，移开后只保留宠物本身。
- 宠物眼睛跟踪整个桌面的鼠标，而不是只跟踪宠物窗口内部。
- 首次使用完成领养流程，之后点击宠物的三个点进入管理客户端。
- 管理客户端偏生活化、克制，不要使用过重的“AI 产品模板”视觉。
- 对话、状态、成长和记忆需要持久化。
- 后续可以继续接入生图或生视频 API，提升宠物形象和动作质量。

## 2. 当前 Git 状态

记录本文前的稳定主线：

- `main` 与 `origin/main` 一致。
- 主线最新提交：`62c7ca6 修复宠物拖拽立即中断`。
- 工作区在记录本文前没有未提交代码。

近期关键提交：

| 提交 | 内容 |
| --- | --- |
| `62c7ca6` | 修复宠物拖拽立即中断 |
| `14c9a31` | 重构宠物管理客户端 |
| `1697a21` | 修复全桌面鼠标眼神跟踪 |
| `9881568` | 优化宠物悬停展示和眼神跟踪 |
| `c534257` | 修复流式聊天记录持久化 |
| `4ec7649` | 优化宠物展示 |
| `e3e8857` | 添加 SQLite 持久化 |
| `001857f` | 修复客户端黑边 |

当前仍保留的分支和恢复点：

- `codex/client-dashboard`
- `codex/fix-pet-drag`
- `feature/chat-persistence`
- `feature/pet-hover-tracking`
- `test/123`
- `test/123-clean`
- `stash@{0}: backup-before-reverting-merge-4da56e8`

这些旧分支和 stash 暂时不要删除，除非项目负责人明确确认。

## 3. 两人协作约定

当前只有两人协作，采用轻量 GitHub Flow：

1. `main` 始终保持可运行，不能直接在 `main` 上开发。
2. 一个完整需求或缺陷使用一个短期分支，不需要为每个小提交单独建分支。
3. 分支建议命名：
   - 新功能：`feature/功能名`
   - 缺陷：`fix/问题名`
   - 重构：`refactor/模块名`
   - 文档：`docs/主题名`
4. 提交描述使用中文。
5. 完成后只提交并推送当前功能分支。
6. 未经项目负责人明确说“合到 main”，不能合并或推送 `main`。
7. 合并前至少运行 `npm run build`，并人工验证本次需求的关键路径。

推荐流程：

```powershell
git switch main
git pull --ff-only
git switch -c feature/example

# 修改并验证
npm run build
git add -- <本次修改的文件>
git commit -m "中文提交描述"
git push -u origin feature/example
```

然后等待负责人确认是否创建 PR 或合入 `main`。

## 4. 技术架构

### 4.1 客户端

- Electron 36
- React 19
- TypeScript
- electron-vite / Vite 6
- Three.js：3D 宠物渲染和眼睛跟踪
- lucide-react：管理客户端图标

主要文件：

- `src/main/index.ts`：Electron 主进程、窗口、托盘、后端进程、拖拽和散步。
- `src/preload/index.ts`：受控 IPC Bridge。
- `src/shared/types.ts`：主进程、预加载和渲染端共享类型。
- `src/renderer/App.tsx`：首次领养、管理客户端、桌宠交互和聊天。
- `src/renderer/Pet3D.tsx`：Three.js 宠物、动画和眼睛跟踪。
- `src/renderer/styles.css`：领养页、桌宠和管理客户端样式。
- `src/renderer/data/personalities.ts`：16 种 MBTI 人格数据。
- `src/renderer/data/mbtiBehaviors.ts`：人格对应的动作参数。

### 4.2 后端

- FastAPI
- Uvicorn
- SQLite
- httpx
- pydantic-settings

主要文件：

- `server/app/main.py`：HTTP API 和 SSE 聊天入口。
- `server/app/database.py`：SQLite 表和数据访问。
- `server/app/schemas.py`：请求和响应模型。
- `server/app/services/model_gateway.py`：OpenAI 兼容聊天模型网关及本地降级回复。
- `server/app/services/image_gateway.py`：参考图生图及异步任务查询。
- `server/app/services/memory.py`：互动记忆和成长数据。
- `server/app/services/agent.py`：轻量行为计划。

开发模式下，Electron 主进程会自动启动：

```text
server\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8787 --app-dir server
```

开发页面默认运行在 `http://localhost:5173/`，后端运行在 `http://127.0.0.1:8787/`。

## 5. 已完成的核心功能

### 5.1 首次领养

首次启动且没有宠物数据时，进入五步领养流程：

1. 用户昵称和可选用户 MBTI。
2. 选择猫或狗。
3. 选择宠物 MBTI。
4. 使用默认形象或上传真实宠物照片生成形象。
5. 给宠物命名并完成领养。

首次领养和日常管理已经分开。存在宠物档案时，主窗口应进入管理客户端，而不是重新进入领养流程最后一步。

### 5.2 管理客户端

点击桌宠上的三个点会打开管理客户端，当前包含：

- 总览：宠物状态、快捷照顾、等级、XP 和最近成长记录。
- 聊天：读取历史消息并进行 SSE 流式聊天。
- 宠物档案：修改宠物名字、用户称呼，或重新选择物种、人格和形象。
- 回到桌面：隐藏管理窗口并重新显示桌宠。

喂食、清洁、摸摸和散步会更新本地状态，同时写入 SQLite；不同 Electron 窗口通过同源 `localStorage` 的 `storage` 事件同步状态。

管理客户端的视觉原则：

- 暖灰背景、深绿侧栏、少量橙色点缀。
- 避免大面积紫色渐变、玻璃拟态和堆叠“AI 能力卡片”。
- 文案更像陪伴型生活应用，而不是模型控制台。
- 页面内出现的按钮必须有真实功能，不能只做静态展示。

### 5.3 桌宠窗口

桌宠窗口尺寸为 `360 × 380`，具有以下设置：

- 无边框、透明背景、始终置顶、跳过任务栏。
- 在多个工作区可见。
- 默认允许鼠标穿透，进入宠物或控件区域时恢复交互。
- 拖动位置会保存到用户数据目录下的 `pet-window.json`。
- 散步由主进程每 16ms 更新窗口位置，并限制在显示器工作区内。

为了规避部分 Windows GPU/DWM 组合产生的透明窗口黑块，主进程启用了：

```text
disable-gpu-compositing
ignore-gpu-blocklist
```

### 5.4 悬停和拖拽

- 鼠标进入宠物或操作区后显示对话气泡、名字、状态和互动按钮。
- 鼠标离开后延迟 220ms 隐藏，允许用户从宠物移动到操作按钮。
- 拖拽使用渲染端 Pointer Events 通知主进程，主进程读取系统鼠标坐标移动透明窗口。
- `62c7ca6` 修复了一个关键缺陷：`isDragging` 改变时副作用清理函数会立刻发送结束拖拽，导致按下后立即中断。现在使用稳定的 `isDraggingRef`，全局事件只注册一次。
- 透明窗口转发的鼠标事件会使用 `document.elementFromPoint()` 重新命中宠物区域，避免只依赖不可靠的 `event.target`。

### 5.5 全桌面眼睛跟踪

`Pet3D` 每 50ms 调用 `window.mipet.getCursorPosition()` 获取 Electron `screen.getCursorScreenPoint()` 返回的全局坐标，再换算为宠物画布坐标，并在动画帧中平滑插值。

因此眼睛应跟踪整个桌面和多显示器上的鼠标，而不仅是宠物透明窗口内部。

### 5.6 聊天、成长和持久化

当前主要 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 后端健康检查 |
| `POST` | `/v1/pets` | 创建或更新宠物快照 |
| `GET` | `/v1/pets/latest` | 获取最近宠物 |
| `GET` | `/v1/pets/{pet_id}` | 获取指定宠物 |
| `PUT` | `/v1/pets/{pet_id}/state` | 更新宠物状态 |
| `POST` | `/v1/pets/{pet_id}/events` | 写入互动和成长记录 |
| `GET` | `/v1/pets/{pet_id}/memories` | 获取记忆 |
| `GET` | `/v1/pets/{pet_id}/messages` | 获取聊天历史 |
| `GET` | `/v1/pets/{pet_id}/growth` | 获取成长记录 |
| `POST` | `/v1/pets/{pet_id}/chat/stream` | SSE 流式聊天 |
| `POST` | `/v1/pets/{pet_id}/appearance` | 生成宠物形象 |
| `GET` | `/v1/pets/{pet_id}/appearance/tasks/{task_id}` | 查询异步生图任务 |

未配置模型 API 时，聊天服务会使用本地降级回复，便于离线联调。

## 6. 新电脑环境搭建

建议使用：

- Windows 10/11
- Git
- Node.js 22
- pnpm
- Python 3.11 或兼容版本

### 6.1 拉取代码

```powershell
git clone https://github.com/leiMing213/MIPet.git
cd MIPet
git switch main
git pull --ff-only
```

不要直接在 `main` 上开始修改；确定新需求后再创建功能分支。

### 6.2 安装前端依赖

仓库包含 `pnpm-lock.yaml`，优先使用 pnpm：

```powershell
corepack enable
pnpm install
```

当前也可以通过 `npm run dev` 和 `npm run build` 调用脚本，但不要随意混用包管理器更新依赖锁文件。

### 6.3 安装 Python 后端

```powershell
py -3.11 -m venv server\.venv
server\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
```

### 6.4 配置环境变量

```powershell
Copy-Item .env.example .env
```

按需填写：

```text
MIMO_BASE_URL=
MIMO_API_KEY=
MIMO_MODEL=
IMAGE2_BASE_URL=
IMAGE2_API_KEY=
IMAGE2_MODEL=
IMAGE2_ENDPOINT=
IMAGE2_TASK_BASE_URL=
```

`.env` 包含密钥，已经被 `.gitignore` 忽略，不能提交到 Git。

### 6.5 启动和验证

```powershell
npm run dev
```

验证后端：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

构建验证：

```powershell
npm run build
```

生成 Windows 安装包：

```powershell
npm run dist
```

注意：正式打包的 Python 后端资源仍需要继续完善，见“已知问题”。

## 7. 用户数据与换机迁移

Electron 用户数据目录：

```text
%APPDATA%\mipet-desktop-pet
```

当前主要数据：

- `mipet.db`：宠物、状态、聊天、记忆和成长记录。
- `pet-window.json`：桌宠窗口位置。
- Chromium Local Storage：客户端本地缓存。

### 7.1 迁移到新电脑

如果需要保留宠物：

1. 完全退出旧电脑上的 MiPet。
2. 复制整个 `%APPDATA%\mipet-desktop-pet` 文件夹。
3. 在新电脑上安装依赖，但先不要启动 MiPet。
4. 将该文件夹放到新电脑对应的 `%APPDATA%` 目录。
5. 再启动 MiPet。

不要在应用运行时直接覆盖 SQLite 或 Chromium 数据目录。

### 7.2 当前旧数据备份

2026-07-26 为了重新测试首次领养，曾将旧用户目录移动到：

```text
C:\Users\热心市民小雷\AppData\Roaming\mipet-desktop-pet.backup-20260726-235853
```

当前正在使用的数据位于正常的 `mipet-desktop-pet` 目录。旧备份暂时不要删除。换电脑时，如果两套数据都可能有用，建议一起复制并清楚标注。

## 8. 已知问题和技术债

后续开发前需要关注：

1. `src/renderer/App.tsx` 已经较大，首次领养、管理台、桌宠和聊天最好逐步拆成独立组件和 hooks。
2. 文件中仍保留未使用的 `LegacyPetWindow`，确认无恢复用途后再删除。
3. `API_BASE` 当前硬编码为 `http://127.0.0.1:8787`，正式发布前应集中配置。
4. 当前主要依靠构建和人工点击验证，尚无桌宠拖拽、IPC 和聊天流的自动化回归测试。
5. `package.json` 的正式打包逻辑期望存在 `server/mipet-server.exe`，但目前 `extraResources` 只复制了图标；打包版后端需要补充构建和拷贝流程。
6. 生图请求的客户端调用路径和任务轮询需要统一以真实 `pet_id` 组织，避免继续使用过渡性路径。
7. 管理台与桌宠主要通过 `localStorage` 事件同步，未来状态复杂后可考虑统一状态通道或主进程事件总线。
8. 仓库同时存在 `package-lock.json` 和 `pnpm-lock.yaml`，后续应确认唯一包管理器后再清理，不能贸然删除锁文件。
9. 旧分支和 stash 较多，当前以恢复安全为先；清理前必须由负责人确认。

## 9. 每次需求完成前的检查清单

- 是否在独立分支，而不是 `main`？
- 是否只修改了本需求范围内的文件？
- 是否保留了用户已有改动？
- 是否运行 `git diff --check`？
- 是否运行 `npm run build`？
- 是否实际点击验证关键交互？
- 是否检查后端 `/health` 和最新错误日志？
- 提交描述是否为中文？
- 是否只推送功能分支？
- 是否在未获明确许可时避免合入 `main`？

## 10. 新对话建议开场

换电脑或打开新的 Codex 对话后，可以直接发送：

```text
请先完整阅读 docs/DEVELOPMENT_HANDOFF.md 和仓库当前状态。
后续每个需求都在独立分支开发，提交描述使用中文；未经我明确确认，不要合入或推送 main。
```

然后再补充具体需求。
