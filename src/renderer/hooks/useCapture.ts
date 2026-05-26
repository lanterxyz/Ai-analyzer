// React hook for capture state management
import { useState, useEffect, useCallback } from 'react'
import { IPC_CHANNELS, RENDERER_EVENTS, CaptureState } from '@shared/types'

export default function useCapture(sessionId: string | null) {
  const [state, setState] = useState<CaptureState>(CaptureState.IDLE)
  const [requestCount, setRequestCount] = useState(0)

  useEffect(() => {
    if (!sessionId) return

    const onStateChange = (_: any, newState: CaptureState) => setState(newState)
    window.electronAPI.on(RENDERER_EVENTS.CAPTURE_STATE_CHANGED, onStateChange)

    return () => {
      window.electronAPI.off(RENDERER_EVENTS.CAPTURE_STATE_CHANGED, onStateChange)
    }
  }, [sessionId])

  const start = useCallback(async (targetUrl?: string) => {
    if (!sessionId) return
    await window.electronAPI.invoke(IPC_CHANNELS.CAPTURE_START, sessionId, targetUrl)
    setState(CaptureState.CAPTURING)
  }, [sessionId])

  const stop = useCallback(async () => {
    if (!sessionId) return
    await window.electronAPI.invoke(IPC_CHANNELS.CAPTURE_STOP, sessionId)
    setState(CaptureState.STOPPED)
  }, [sessionId])

  const pause = useCallback(async () => {
    if (!sessionId) return
    await window.electronAPI.invoke(IPC_CHANNELS.CAPTURE_PAUSE, sessionId)
    setState(CaptureState.PAUSED)
  }, [sessionId])

  const resume = useCallback(async () => {
    if (!sessionId) return
    await window.electronAPI.invoke(IPC_CHANNELS.CAPTURE_RESUME, sessionId)
    setState(CaptureState.CAPTURING)
  }, [sessionId])

  return { state, requestCount, start, stop, pause, resume }
}
