import React, { useState, useEffect, useCallback } from 'react'
import { IPC_CHANNELS, RENDERER_EVENTS, ThemeMode, Locale, CaptureState, Session, CapturedRequest, AnalysisMode } from '@shared/types'
import Titlebar from './components/Titlebar'
import SessionList from './components/SessionList'
import BrowserPanel from './components/BrowserPanel'
import RequestLog from './components/RequestLog'
import RequestDetail from './components/RequestDetail'
import ReportView from './components/ReportView'
import StatusBar from './components/StatusBar'
import SettingsModal from './components/SettingsModal'
import useSession from './hooks/useSession'

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
      send: (channel: string, ...args: any[]) => void
      on: (channel: string, callback: (...args: any[]) => void) => void
      off: (channel: string, callback: (...args: any[]) => void) => void
      getPlatform: () => string
    }
  }
}

type ViewTab = 'browser' | 'inspector' | 'report' | 'toolbox'

const App: React.FC = () => {
  const [theme, setTheme] = useState<ThemeMode>(ThemeMode.DARK)
  const [locale, setLocale] = useState<Locale>(Locale.ZH)
  const [activeView, setActiveView] = useState<ViewTab>('inspector')
  const [rightTab, setRightTab] = useState<'requests' | 'hooks' | 'storage' | 'interceptors'>('requests')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [capturedRequests, setCapturedRequests] = useState<any[]>([])

  const {
    sessions,
    activeSession,
    createSession,
    deleteSession,
    selectSession
  } = useSession()

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Listen for captured requests
  useEffect(() => {
    const handler = (_event: any, data: any) => {
      setCapturedRequests(prev => [...prev, data])
    }
    window.electronAPI.on(RENDERER_EVENTS.REQUEST_CAPTURED, handler)
    return () => window.electronAPI.off(RENDERER_EVENTS.REQUEST_CAPTURED, handler)
  }, [])

  return (
    <div className="app-root" data-theme={theme}>
      <Titlebar
        activeView={activeView}
        onViewChange={setActiveView}
        theme={theme}
        onThemeChange={setTheme}
        locale={locale}
        onLocaleChange={setLocale}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      <div className="main-content">
        <div className="sidebar">
          <SessionList
            sessions={sessions}
            activeSessionId={activeSession?.id || null}
            onSelect={selectSession}
            onCreate={() => createSession('New Session')}
            onDelete={deleteSession}
          />
        </div>

        <div className="view-area">
          {activeView === 'browser' && (
            <div className="browser-view">
              <BrowserPanel session={activeSession} />
              <div className="browser-placeholder" id="browser-container" />
            </div>
          )}

          {activeView === 'inspector' && (
            <div className="inspector-view">
              <div className="sub-tabs">
                <button className={rightTab === 'requests' ? 'active' : ''} onClick={() => setRightTab('requests')}>Requests</button>
                <button className={rightTab === 'hooks' ? 'active' : ''} onClick={() => setRightTab('hooks')}>Hooks</button>
                <button className={rightTab === 'storage' ? 'active' : ''} onClick={() => setRightTab('storage')}>Storage</button>
                <button className={rightTab === 'interceptors' ? 'active' : ''} onClick={() => setRightTab('interceptors')}>Interceptors</button>
              </div>

              <div className="inspector-content">
                <div className="request-list-panel">
                  <RequestLog
                    requests={capturedRequests}
                    selectedId={selectedRequestId}
                    onSelect={setSelectedRequestId}
                    sessionId={activeSession?.id || null}
                  />
                </div>
                <div className="request-detail-panel">
                  {selectedRequestId && (
                    <RequestDetail requestId={selectedRequestId} />
                  )}
                </div>
              </div>
            </div>
          )}

          {activeView === 'report' && (
            <ReportView session={activeSession} />
          )}
        </div>
      </div>

      <StatusBar
        captureState={activeSession?.state || CaptureState.IDLE}
        requestCount={capturedRequests.length}
        hookCount={0}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
        locale={locale}
        onLocaleChange={setLocale}
      />
    </div>
  )
}

export default App
