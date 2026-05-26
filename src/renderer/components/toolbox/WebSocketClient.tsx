import React, { useState, useEffect, useRef } from 'react'

const WebSocketClient: React.FC = () => {
  const [url, setUrl] = useState('wss://echo.websocket.org')
  const [message, setMessage] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  const connect = () => {
    try {
      const ws = new WebSocket(url)
      ws.onopen = () => {
        setConnected(true)
        setLogs(prev => [...prev, `[Connected] ${url}`])
      }
      ws.onmessage = (e) => {
        setLogs(prev => [...prev, `[Received] ${e.data}`])
      }
      ws.onclose = () => {
        setConnected(false)
        setLogs(prev => [...prev, '[Disconnected]'])
      }
      ws.onerror = () => {
        setLogs(prev => [...prev, '[Error] Connection failed'])
      }
      wsRef.current = ws
    } catch (err) {
      setLogs(prev => [...prev, `[Error] ${(err as Error).message}`])
    }
  }

  const disconnect = () => {
    wsRef.current?.close()
  }

  const send = () => {
    if (wsRef.current && connected) {
      wsRef.current.send(message)
      setLogs(prev => [...prev, `[Sent] ${message}`])
      setMessage('')
    }
  }

  return (
    <div className="toolbox-item">
      <h3>WebSocket Client</h3>
      <div className="tool-controls">
        <div className="tool-row">
          <label>URL</label>
          <input type="text" value={url} onChange={e => setUrl(e.target.value)} />
        </div>
        <div className="tool-actions">
          <button onClick={connected ? disconnect : connect}>
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
        <div className="tool-row">
          <label>Message</label>
          <input type="text" value={message} onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()} />
          <button onClick={send} disabled={!connected}>Send</button>
        </div>
        <div className="tool-output">
          <pre className="code-block">{logs.join('\n')}</pre>
        </div>
      </div>
    </div>
  )
}

export default WebSocketClient
