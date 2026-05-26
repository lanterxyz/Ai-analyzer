// Tab Manager - Multi-tab BrowserView management
import { BrowserView, session, WebContents } from 'electron'
import { createBrowserView, getMainWindow, updateBrowserViewBounds } from './window'
import { createLogger } from './logger'

const logger = createLogger('tab-manager')

interface Tab {
  id: string
  view: BrowserView
  url: string | null
  title: string
  partition: string
}

let tabs: Tab[] = []
let activeTabId: string | null = null

export function createTab(tabId: string, url?: string): Tab {
  const partition = `persist:tab-${tabId}`
  const view = createBrowserView(partition)

  const tab: Tab = {
    id: tabId,
    view,
    url: url || null,
    title: url || 'New Tab',
    partition
  }

  tabs.push(tab)

  if (url) {
    view.webContents.loadURL(url)
  }

  // Track navigation
  view.webContents.on('did-navigate', (_event, navUrl) => {
    tab.url = navUrl
    tab.title = view.webContents.getTitle()
    notifyTabUpdate()
  })

  view.webContents.on('did-navigate-in-page', (_event, navUrl) => {
    tab.url = navUrl
    notifyTabUpdate()
  })

  view.webContents.on('page-title-updated', (_event, title) => {
    tab.title = title
    notifyTabUpdate()
  })

  activateTab(tabId)
  return tab
}

export function closeTab(tabId: string): void {
  const idx = tabs.findIndex(t => t.id === tabId)
  if (idx === -1) return

  const tab = tabs[idx]
  const win = getMainWindow()
  if (win) {
    win.removeBrowserView(tab.view)
  }
  tab.view.webContents.close()
  tabs.splice(idx, 1)

  if (activeTabId === tabId) {
    activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null
    if (activeTabId) {
      activateTab(activeTabId)
    }
  }

  notifyTabUpdate()
}

export function activateTab(tabId: string): void {
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return

  const win = getMainWindow()
  if (!win) return

  // Hide all views
  for (const t of tabs) {
    if (t.id !== tabId) {
      win.removeBrowserView(t.view)
    }
  }

  // Show active view
  win.addBrowserView(tab.view)
  updateBrowserViewBounds()
  activeTabId = tabId

  notifyTabUpdate()
}

export function getActiveTab(): Tab | null {
  return tabs.find(t => t.id === activeTabId) || null
}

export function getActiveTabWebContents(): WebContents | null {
  const tab = getActiveTab()
  return tab?.view?.webContents || null
}

export function getTabList(): { id: string; url: string | null; title: string }[] {
  return tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))
}

export function getActiveTabId(): string | null {
  return activeTabId
}

export function navigateTab(url: string): void {
  const tab = getActiveTab()
  if (!tab) return
  tab.view.webContents.loadURL(url)
}

export function goBack(): void {
  const wc = getActiveTabWebContents()
  if (wc?.canGoBack()) wc.goBack()
}

export function goForward(): void {
  const wc = getActiveTabWebContents()
  if (wc?.canGoForward()) wc.goForward()
}

export function reload(): void {
  getActiveTabWebContents()?.reload()
}

export function clearBrowserEnv(): void {
  const tab = getActiveTab()
  if (!tab) return
  const ses = session.fromPartition(tab.partition)
  ses.clearStorageData()
  ses.clearCache()
  tab.view.webContents.reload()
}

// Protect last tab from being closed
export function protectLastTab(): void {
  // Intercept window.close in the page
  for (const tab of tabs) {
    tab.view.webContents.setWindowOpenHandler(() => {
      // Capture popups as new tabs
      const newTabId = `tab-${Date.now()}`
      createTab(newTabId)
      return { action: 'allow' }
    })
  }
}

function notifyTabUpdate(): void {
  const { BrowserWindow } = require('electron')
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('tab:updated', getTabList(), activeTabId)
  }
}
