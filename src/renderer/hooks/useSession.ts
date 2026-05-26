// React hooks for session management
import { useState, useEffect, useCallback } from 'react'
import { IPC_CHANNELS, Session, CaptureState } from '@shared/types'

export default function useSession() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const activeSession = sessions.find(s => s.id === activeSessionId) || null

  const refreshSessions = useCallback(async () => {
    try {
      const list = await window.electronAPI.invoke(IPC_CHANNELS.SESSION_LIST)
      setSessions(list)
    } catch {}
  }, [])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  const createSession = useCallback(async (name: string, targetUrl?: string) => {
    const session = await window.electronAPI.invoke(IPC_CHANNELS.SESSION_CREATE, { name, targetUrl })
    setSessions(prev => [session, ...prev])
    setActiveSessionId(session.id)
    return session
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    await window.electronAPI.invoke(IPC_CHANNELS.SESSION_DELETE, id)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId === id) setActiveSessionId(null)
  }, [activeSessionId])

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const startCapture = useCallback(async (targetUrl?: string) => {
    if (!activeSessionId) return
    await window.electronAPI.invoke(IPC_CHANNELS.CAPTURE_START, activeSessionId, targetUrl)
    refreshSessions()
  }, [activeSessionId, refreshSessions])

  const stopCapture = useCallback(async () => {
    if (!activeSessionId) return
    await window.electronAPI.invoke(IPC_CHANNELS.CAPTURE_STOP, activeSessionId)
    refreshSessions()
  }, [activeSessionId, refreshSessions])

  return {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    deleteSession,
    selectSession,
    startCapture,
    stopCapture,
    refreshSessions
  }
}
