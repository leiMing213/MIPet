# MiPet

MiPet 是一款 Windows AI 桌面宠物原型：用户可以选择猫或狗、选择16种宠物MBTI、使用默认形象或上传真实宠物照片，并通过聊天、抚摸、拖拽、喂养和清理建立长期关系。

## 当前实现

- Electron + React + TypeScript 客户端骨架
- 首次领养流程
- 用户昵称与可选用户MBTI
- 猫狗二选一
- 16种宠物MBTI卡片
- 默认形象与本地照片预览
- 透明桌宠窗口
- 待机、走路、进食、被抚摸四个基础动作
- 本地饥饿、清洁、心情、亲密度状态
- 鼠标点击、喂食、清理、走动和返回控制面板

## 开发

```powershell
npm install
npm run dev
```

## 构建

```powershell
npm run build
npm run dist
```

后续会接入 FastAPI、MiMo、Pet DNA、Image-2、记忆服务和轻量 Agent。
