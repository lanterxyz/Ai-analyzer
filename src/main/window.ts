// Window management - frameless window with BrowserView
import { BrowserWindow, BrowserView, session, app } from 'electron'
import path from 'path'
import { createLogger } from './logger'

const logger = createLogger('window')

let mainWindow: BrowserWindow | null = null
let browserView: BrowserView | null = null

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    browserView = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createBrowserView(partition: string): BrowserView {
  const win = getMainWindow()
  if (!win) throw new Error('Main window not found')

  // Remove existing browser view
  if (browserView) {
    win.removeBrowserView(browserView)
  }

  const ses = session.fromPartition(partition)

  browserView = new BrowserView({
    webPreferences: {
      session: ses,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/target-preload.js'),
      partition
    }
  })

  win.addBrowserView(browserView)
  updateBrowserViewBounds()

  return browserView
}

export function getBrowserView(): BrowserView | null {
  return browserView
}

export function updateBrowserViewBounds(): void {
  if (!mainWindow || !browserView) return

  const { width, height } = mainWindow.getContentBounds()
  // Leave space for titlebar (32px), sidebar (220px), and status bar (28px)
  browserView.setBounds({
    x: 220,
    y: 32 + 40, // titlebar + browser toolbar
    width: width - 220,
    height: height - 32 - 40 - 28
  })
}

export function removeBrowserView(): void {
  if (mainWindow && browserView) {
    mainWindow.removeBrowserView(browserView)
    browserView.webContents.close()
    browserView = null
  }
}
