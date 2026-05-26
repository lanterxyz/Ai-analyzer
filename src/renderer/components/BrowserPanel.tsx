import React, { useState, useEffect } from 'react'
import { Session, IPC_CHANNELS, CaptureState } from '@shared/types'
import useCapture from '../hooks/useCapture'
import useTabs from '../hooks/useTabs'

interface BrowserPanelProps {
  session: Session | null
}

const BrowserPanel: React.FC<BrowserPanelProps> = ({ session }) => {
  const [url, setUrl] = useState(session?.targetUrl || '')
  const { state, start, stop, pause, resume } = useCapture(session?.id || null)
  const { tabs, activeTabId, createTab, closeTab, switchTab, navigate, goBack, goForward, reload } = useTabs()

  useEffect(() => {
    if (session?.targetUrl) setUrl(session.targetUrl)
  }, [session?.targetUrl])

  const handleNavigate = () => {
    if (!url) return
    let navUrl = url
    if (!navUrl.startsWith('http')) navUrl = 'https://' + navUrl
    navigate(navUrl)
  }

  const handleStartCapture = async () => {
    if (!session) return
    let navUrl = url
    if (navUrl && !navUrl.startsWith('http')) navUrl = 'https://' + navUrl
    await start(navUrl || undefined)
    if (navUrl) navigate(navUrl)
  }

  return (
    <div className="browser-panel">
      <div className="browser-toolbar">
        <div className="nav-buttons">
          <button onClick={goBack} title="Back">←</button>
          <button onClick={goForward} title="Forward">→</button>
          <button onClick={reload} title="Reload">↻</button>
        </div>

        <div className="url-bar">
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNavigate()}
            placeholder="Enter URL..."
          />
        </div>

        <div className="capture-controls">
          {state === CaptureState.IDLE && (
            <button className="capture-btn start" onClick={handleStartCapture}>Start</button>
          )}
          {state === CaptureState.CAPTURING && (
            <>
              <button className="capture-btn pause" onClick={pause}>Pause</button>
              <button className="capture-btn stop" onClick={stop}>Stop</button>
            </>
          )}
          {state === CaptureState.PAUSED && (
            <>
              <button className="capture-btn resume" onClick={resume}>Resume</button>
              <button className="capture-btn stop" onClick={stop}>Stop</button>
            </>
          )}
        </div>

        <button className="new-tab-btn" onClick={() => createTab()}>+</button>
      </div>

      <div className="tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`browser-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => switchTab(tab.id)}
          >
            <span className="tab-title">{tab.title || 'New Tab'}</span>
            <button className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default BrowserPanel
