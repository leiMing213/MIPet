import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { PetWalkOptions } from '../shared/types'

// Keep WebGL available for the 3D scene, but use Chromium's software window
// compositor. Some Windows GPU/DWM combinations otherwise present a layered
// transparent BrowserWindow as an opaque black rectangle.
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

const PET_WIDTH = 360
const PET_HEIGHT = 380
const SCREEN_MARGIN = 12

interface SavedPetWindowState {
  x: number
  y: number
}

let mainWindow: BrowserWindow | null = null
let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let dragTimer: NodeJS.Timeout | null = null
let walkTimer: NodeJS.Timeout | null = null
let dragOffset = { x: 0, y: 0 }
let backendProcess: ChildProcess | null = null

function startBackend() {
  if (backendProcess && backendProcess.exitCode === null) return

  const projectRoot = app.getAppPath()
  const executable = app.isPackaged
    ? join(process.resourcesPath, 'server', 'mipet-server.exe')
    : join(projectRoot, 'server', '.venv', 'Scripts', 'python.exe')

  if (!existsSync(executable)) {
    console.warn(`[MiPet] AI backend executable not found: ${executable}`)
    return
  }

  const args = app.isPackaged
    ? []
    : ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8787', '--app-dir', 'server']

  backendProcess = spawn(executable, args, {
    cwd: projectRoot,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      MIPET_DATA_DIR: app.getPath('userData')
    }
  })
  backendProcess.once('error', error => {
    console.error('[MiPet] Failed to start AI backend:', error)
    backendProcess = null
  })
  backendProcess.once('exit', () => { backendProcess = null })
}

function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return
  if (process.platform === 'win32' && backendProcess.pid) {
    spawn('taskkill', ['/pid', String(backendProcess.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } else {
    backendProcess.kill()
  }
  backendProcess = null
}

function petStatePath() {
  return join(app.getPath('userData'), 'pet-window.json')
}

function readSavedPetPosition(): SavedPetWindowState | null {
  try {
    if (!existsSync(petStatePath())) return null
    const saved = JSON.parse(readFileSync(petStatePath(), 'utf8')) as SavedPetWindowState
    return Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null
  } catch {
    return null
  }
}

function savePetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return
  const [x, y] = petWindow.getPosition()
  try {
    writeFileSync(petStatePath(), JSON.stringify({ x, y } satisfies SavedPetWindowState), 'utf8')
  } catch {
    // The pet can keep running even if Windows temporarily denies the settings write.
  }
}

function clampPetPosition(x: number, y: number) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + PET_WIDTH / 2),
    y: Math.round(y + PET_HEIGHT / 2)
  })
  const area = display.workArea
  return {
    x: Math.min(Math.max(Math.round(x), area.x - SCREEN_MARGIN), area.x + area.width - PET_WIDTH + SCREEN_MARGIN),
    y: Math.min(Math.max(Math.round(y), area.y - SCREEN_MARGIN), area.y + area.height - PET_HEIGHT + SCREEN_MARGIN)
  }
}

function initialPetPosition() {
  const saved = readSavedPetPosition()
  if (saved) return clampPetPosition(saved.x, saved.y)
  const area = screen.getPrimaryDisplay().workArea
  return clampPetPosition(
    area.x + area.width - PET_WIDTH - 28,
    area.y + area.height - PET_HEIGHT - 18
  )
}

function stopPetMovement() {
  if (dragTimer) clearInterval(dragTimer)
  if (walkTimer) clearInterval(walkTimer)
  dragTimer = null
  walkTimer = null
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    show: false,
    title: 'MiPet',
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  mainWindow.setMenuBarVisibility(false)

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => { mainWindow = null })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive()
    return petWindow
  }

  const position = initialPetPosition()
  petWindow = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: PET_WIDTH,
    height: PET_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    thickFrame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  petWindow.setAlwaysOnTop(true, 'floating')
  petWindow.setBackgroundColor('#00000000')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.setIgnoreMouseEvents(true, { forward: true })
  petWindow.on('closed', () => {
    stopPetMovement()
    petWindow = null
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void petWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=pet`)
  } else {
    void petWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'pet' } })
  }
  petWindow.once('ready-to-show', () => petWindow?.showInactive())
  return petWindow
}

function showPet() {
  const window = createPetWindow()
  window.showInactive()
}

function showPanel() {
  const window = createMainWindow()
  window.show()
  window.focus()
}

function beginPetDrag() {
  if (!petWindow || petWindow.isDestroyed()) return
  stopPetMovement()
  const cursor = screen.getCursorScreenPoint()
  const [windowX, windowY] = petWindow.getPosition()
  dragOffset = { x: cursor.x - windowX, y: cursor.y - windowY }

  dragTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return stopPetMovement()
    const point = screen.getCursorScreenPoint()
    const next = clampPetPosition(point.x - dragOffset.x, point.y - dragOffset.y)
    petWindow.setPosition(next.x, next.y, false)
  }, 16)
}

function endPetDrag() {
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = null
  savePetPosition()
}

function walkPet(options: PetWalkOptions) {
  if (!petWindow || petWindow.isDestroyed()) return
  stopPetMovement()
  const [startX, startY] = petWindow.getPosition()
  const direction = options.direction === -1 ? -1 : 1
  const requestedDistance = direction * Math.min(280, Math.max(60, options.distance || 160))
  const destination = clampPetPosition(startX + requestedDistance, startY)
  const distance = destination.x - startX
  const duration = Math.min(2400, Math.max(500, options.duration || 900))
  const startedAt = Date.now()

  walkTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return stopPetMovement()
    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    petWindow.setPosition(Math.round(startX + distance * eased), startY, false)
    if (progress >= 1) {
      if (walkTimer) clearInterval(walkTimer)
      walkTimer = null
      savePetPosition()
      petWindow.webContents.send('pet:walk-finished')
    }
  }, 16)
}

function createTray() {
  if (tray) return
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'mipet-icon.png')
    : join(app.getAppPath(), 'resources', 'mipet-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('MiPet 桌面宠物')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示桌宠', click: showPet },
    { label: '打开 MiPet 面板', click: showPanel },
    { type: 'separator' },
    {
      label: '退出 MiPet',
      click: () => {
        isQuitting = true
        stopPetMovement()
        savePetPosition()
        app.quit()
      }
    }
  ]))
  tray.on('double-click', showPet)
}

function registerIpc() {
  ipcMain.handle('pet:open', () => {
    showPet()
    mainWindow?.hide()
    return true
  })
  ipcMain.handle('panel:open', () => {
    showPanel()
    return true
  })
  ipcMain.handle('cursor:position', () => screen.getCursorScreenPoint())
  ipcMain.handle('system:idle-time', () => powerMonitor.getSystemIdleTime())
  ipcMain.on('pet:mouse-passthrough', (event, passthrough: boolean) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return
    petWindow.setIgnoreMouseEvents(Boolean(passthrough), { forward: true })
  })
  ipcMain.on('pet:drag-start', (event) => {
    if (petWindow && event.sender === petWindow.webContents) beginPetDrag()
  })
  ipcMain.on('pet:drag-end', (event) => {
    if (petWindow && event.sender === petWindow.webContents) endPetDrag()
  })
  ipcMain.on('pet:walk', (event, options: PetWalkOptions) => {
    if (petWindow && event.sender === petWindow.webContents) walkPet(options)
  })
  ipcMain.handle('app:quit', () => {
    isQuitting = true
    stopPetMovement()
    savePetPosition()
    app.quit()
  })
  ipcMain.handle('external:open', (_, url: string) => shell.openExternal(url))
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mipet.desktop')
  Menu.setApplicationMenu(null)
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createTray()
  startBackend()
  createMainWindow()

  screen.on('display-removed', () => {
    if (!petWindow || petWindow.isDestroyed()) return
    const [x, y] = petWindow.getPosition()
    const next = clampPetPosition(x, y)
    petWindow.setPosition(next.x, next.y)
    savePetPosition()
  })
})

app.on('second-instance', () => showPanel())
app.on('activate', showPanel)
app.on('before-quit', () => {
  isQuitting = true
  stopPetMovement()
  savePetPosition()
  stopBackend()
})

// On Windows the app stays alive in the notification area when its windows are hidden.
app.on('window-all-closed', () => undefined)
