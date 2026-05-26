import React, { useState, useEffect, useRef } from 'react'
import { Session, IPC_CHANNELS, AnalysisMode, RENDERER_EVENTS } from '@shared/types'

interface ReportViewProps {
  session: Session | null
}

const ReportView: React.FC<ReportViewProps> = ({ session }) => {
  const [mode, setMode] = useState<AnalysisMode>(AnalysisMode.AUTO)
  const [report, setReport] = useState<string>('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([])
  const reportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (_: any, data: any) => {
      if (data.type === 'progress') {
        setReport(prev => prev + data.chunk)
        // Auto-scroll
        setTimeout(() => {
          reportRef.current?.scrollTo(0, reportRef.current.scrollHeight)
        }, 10)
      } else if (data.type === 'complete') {
        setIsAnalyzing(false)
      }
    }
    window.electronAPI.on(RENDERER_EVENTS.ANALYSIS_PROGRESS, handler)
    return () => window.electronAPI.off(RENDERER_EVENTS.ANALYSIS_PROGRESS, handler)
  }, [])

  const runAnalysis = async () => {
    if (!session) return
    setIsAnalyzing(true)
    setReport('')
    try {
      await window.electronAPI.invoke(IPC_CHANNELS.ANALYSIS_RUN, {
        sessionId: session.id,
        mode
      })
    } catch (err) {
      setIsAnalyzing(false)
      setReport('Analysis failed: ' + (err as Error).message)
    }
  }

  const sendChat = async () => {
    if (!chatInput.trim() || !session) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: msg }])
    try {
      const response = await window.electronAPI.invoke(IPC_CHANNELS.CHAT_SEND, {
        sessionId: session.id,
        message: msg
      })
      setChatMessages(prev => [...prev, { role: 'assistant', content: response }])
    } catch {}
  }

  const analysisModes = [
    { value: AnalysisMode.AUTO, label: 'Auto Detect' },
    { value: AnalysisMode.API_REVERSE, label: 'API Reverse' },
    { value: AnalysisMode.SECURITY, label: 'Security Audit' },
    { value: AnalysisMode.PERFORMANCE, label: 'Performance' },
    { value: AnalysisMode.CRYPTO, label: 'Crypto Analysis' },
    { value: AnalysisMode.CUSTOM, label: 'Custom' }
  ]

  return (
    <div className="report-view">
      <div className="analysis-controls">
        <div className="mode-selector">
          {analysisModes.map(m => (
            <button
              key={m.value}
              className={`mode-btn ${mode === m.value ? 'active' : ''}`}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          className={`analyze-btn ${isAnalyzing ? 'analyzing' : ''}`}
          onClick={runAnalysis}
          disabled={isAnalyzing || !session}
        >
          {isAnalyzing ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      <div className="report-content" ref={reportRef}>
        {report ? (
          <div className="report-text">
            <pre className="code-block">{report}</pre>
          </div>
        ) : (
          <div className="report-empty">
            <p>Capture traffic and click Analyze to generate an AI report</p>
          </div>
        )}
      </div>

      <div className="chat-area">
        <div className="chat-messages">
          {chatMessages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              {msg.content}
            </div>
          ))}
        </div>
        <div className="chat-input-area">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="Ask follow-up questions..."
          />
          <button onClick={sendChat}>Send</button>
        </div>
        <div className="quick-actions">
          <button onClick={() => setChatInput('Generate Python reproduction code')}>Python Code</button>
          <button onClick={() => setChatInput('Explain encryption flow')}>Encryption</button>
          <button onClick={() => setChatInput('Analyze security risks')}>Security</button>
          <button onClick={() => setChatInput('List all API parameters')}>API Params</button>
        </div>
      </div>
    </div>
  )
}

export default ReportView
