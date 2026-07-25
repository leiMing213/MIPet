import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null
let petWindow: BrowserWindow | null = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    show: false,
    title: 'MiPet',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show()
    return petWindow
  }
  petWindow = new BrowserWindow({
    width: 380,
    height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  petWindow.setAlwaysOnTop(true, 'floating')
  petWindow.on('closed', () => { petWindow = null })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    petWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=pet`)
  } else {
    petWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'pet' } })
  }
  return petWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mipet.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  ipcMain.handle('pet:open', (_, profile) => {
    const window = createPetWindow()
    mainWindow?.hide()
    window.show()
    return true
  })

  ipcMain.handle('panel:open', () => {
    mainWindow?.show()
    mainWindow?.focus()
    petWindow?.hide()
    return true
  })

  ipcMain.handle('external:open', (_, url: string) => shell.openExternal(url))

  createMainWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
