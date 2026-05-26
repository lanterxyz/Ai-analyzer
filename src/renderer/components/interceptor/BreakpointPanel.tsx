import React, { useState } from 'react'
import { IPC_CHANNELS } from '@shared/types'

const BreakpointPanel: React.FC = () => {
  const [hitData, setHitData] = useState<any>(null)

  // Listen for breakpoint hits
  React.useEffect(() => {
    const handler = (_: any, data: any) => {
      setHitData(data)
    }
    window.electronAPI.on('breakpoint:hit', handler)
    return () => window.electronAPI.off('breakpoint:hit', handler)
  }, [])

  const continueRequest = () => {
    if (hitData) {
      window.electronAPI.send(IPC_CHANNELS.BREAKPOINT_CONTINUE, hitData.requestId, null)
      setHitData(null)
    }
  }

  const editAndContinue = () => {
    if (hitData) {
      window.electronAPI.send(IPC_CHANNELS.BREAKPOINT_CONTINUE, hitData.requestId, hitData)
      setHitData(null)
    }
  }

  if (!hitData) {
    return <div className="breakpoint-panel"><p className="empty-hint">No active breakpoints</p></div>
  }

  return (
    <div className="breakpoint-panel active">
      <h4>Breakpoint Hit</h4>
      <div className="breakpoint-info">
        <p><strong>Phase:</strong> {hitData.phase}</p>
        <p><strong>Method:</strong> {hitData.method}</p>
        <p><strong>URL:</strong> {hitData.url}</p>
        {hitData.statusCode && <p><strong>Status:</strong> {hitData.statusCode}</p>}
      </div>
      <pre className="code-block">{JSON.stringify(hitData, null, 2)}</pre>
      <div className="breakpoint-actions">
        <button onClick={continueRequest}>Continue</button>
        <button onClick={editAndContinue}>Edit & Continue</button>
      </div>
    </div>
  )
}

export default BreakpointPanel
