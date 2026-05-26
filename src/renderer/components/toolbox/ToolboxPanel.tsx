import React, { useState } from 'react'
import AesTool from './AesTool'
import EncodingTool from './EncodingTool'
import JsRunnerTool from './JsRunnerTool'
import RegexTester from './RegexTester'
import TimestampTool from './TimestampTool'
import WebSocketClient from './WebSocketClient'
import QrCodeTool from './QrCodeTool'

const ToolboxPanel: React.FC = () => {
  const [activeTool, setActiveTool] = useState('aes')

  const tools: { key: string; label: string; component: React.FC }[] = [
    { key: 'aes', label: 'AES', component: AesTool },
    { key: 'encoding', label: 'Encode', component: EncodingTool },
    { key: 'js', label: 'JS', component: JsRunnerTool },
    { key: 'regex', label: 'Regex', component: RegexTester },
    { key: 'timestamp', label: 'Time', component: TimestampTool },
    { key: 'websocket', label: 'WS', component: WebSocketClient },
    { key: 'qr', label: 'QR', component: QrCodeTool }
  ]

  const ActiveComponent = tools.find(t => t.key === activeTool)?.component

  return (
    <div className="toolbox-panel">
      <div className="toolbox-tabs">
        {tools.map(t => (
          <button
            key={t.key}
            className={`toolbox-tab ${activeTool === t.key ? 'active' : ''}`}
            onClick={() => setActiveTool(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="toolbox-content">
        {ActiveComponent ? <ActiveComponent /> : (
          <p className="empty-hint">Tool not available</p>
        )}
      </div>
    </div>
  )
}

export default ToolboxPanel
