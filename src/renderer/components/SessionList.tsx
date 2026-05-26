import React from 'react'
import { Session, IPC_CHANNELS, CaptureState, Locale } from '@shared/types'

interface SessionListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

const SessionList: React.FC<SessionListProps> = ({
  sessions, activeSessionId, onSelect, onCreate, onDelete
}) => {
  const stateLabel = (state: CaptureState, locale?: string) => {
    const labels: Record<CaptureState, string> = {
      [CaptureState.IDLE]: '空闲',
      [CaptureState.CAPTURING]: '抓包中',
      [CaptureState.PAUSED]: '已暂停',
      [CaptureState.STOPPED]: '已停止'
    }
    return labels[state] || state
  }

  return (
    <div className="session-list">
      <div className="session-list-header">
        <span>Sessions</span>
        <button className="add-btn" onClick={onCreate}>+</button>
      </div>
      <div className="session-items">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelect(session.id)}
          >
            <div className="session-name">{session.name}</div>
            <div className="session-meta">
              <span className={`state-badge state-${session.state}`}>
                {stateLabel(session.state as CaptureState)}
              </span>
              <span className="session-requests">
                {/* Request count will be populated from capture state */}
              </span>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(session.id) }}
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default SessionList
