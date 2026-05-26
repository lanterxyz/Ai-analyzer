import React from 'react'
import { CaptureState } from '@shared/types'

interface StatusBarProps {
  captureState: CaptureState
  requestCount: number
  hookCount: number
}

const StatusBar: React.FC<StatusBarProps> = ({ captureState, requestCount, hookCount }) => {
  const stateLabels: Record<CaptureState, string> = {
    [CaptureState.IDLE]: 'Ready',
    [CaptureState.CAPTURING]: 'Capturing',
    [CaptureState.PAUSED]: 'Paused',
    [CaptureState.STOPPED]: 'Stopped'
  }

  return (
    <div className="status-bar">
      <span className={`status-state state-${captureState}`}>
        {stateLabels[captureState]}
      </span>
      <span className="status-count">Requests: {requestCount}</span>
      <span className="status-count">Hooks: {hookCount}</span>
    </div>
  )
}

export default StatusBar
