// React hook for tab management
import { useState, useEffect, useCallback } from 'react'
import { IPC_CHANNELS, RENDERER_EVENTS } from '@shared/types'

interface TabInfo {
  id: string
  url: string | null
  title: string
}

export default function useTabs() {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  useEffect(() => {
    const handler = (_: any, tabList: TabInfo[], activeId: string | null) => {
      setTabs(tabList)
      setActiveTabId(activeId)
    }
    window.electronAPI.on(RENDERER_EVENTS.TAB_UPDATED, handler)
    return () => window.electronAPI.off(RENDERER_EVENTS.TAB_UPDATED, handler)
  }, [])

  const createTab = useCallback(async (url?: string) => {
    const tabId = `tab-${Date.now()}`
    await window.electronAPI.invoke(IPC_CHANNELS.TAB_CREATE, tabId, url)
    return tabId
  }, [])

  const closeTab = useCallback(async (tabId: string) => {
    await window.electronAPI.invoke(IPC_CHANNELS.TAB_CLOSE, tabId)
  }, [])

  const switchTab = useCallback(async (tabId: string) => {
    await window.electronAPI.invoke(IPC_CHANNELS.TAB_SWITCH, tabId)
  }, [])

  const navigate = useCallback(async (url: string) => {
    await window.electronAPI.invoke(IPC_CHANNELS.BROWSER_NAVIGATE, url)
  }, [])

  const goBack = useCallback(async () => {
    await window.electronAPI.invoke(IPC_CHANNELS.BROWSER_BACK)
  }, [])

  const goForward = useCallback(async () => {
    await window.electronAPI.invoke(IPC_CHANNELS.BROWSER_FORWARD)
  }, [])

  const reload = useCallback(async () => {
    await window.electronAPI.invoke(IPC_CHANNELS.BROWSER_RELOAD)
  }, [])

  return {
    tabs,
    activeTabId,
    createTab,
    closeTab,
    switchTab,
    navigate,
    goBack,
    goForward,
    reload
  }
}
