import React, { useState } from 'react'

const ToolboxPanel: React.FC = () => {
  const [activeTool, setActiveTool] = useState('aes')

  const tools = [
    { key: 'aes', label: 'AES', component: null },
    { key: 'encoding', label: 'Encode', component: null },
    { key: 'js', label: 'JS', component: null },
    { key: 'regex', label: 'Regex', component: null },
    { key: 'timestamp', label: 'Time', component: null },
    { key: 'websocket', label: 'WS', component: null },
    { key: 'qr', label: 'QR', component: null },
    { key: 'curl', label: 'cURL', component: null },
    { key: 'har', label: 'HAR', component: null }
  ]

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
        <p className="empty-hint">Tool: {activeTool} - select to use</p>
      </div>
    </div>
  )
}

export default ToolboxPanel
