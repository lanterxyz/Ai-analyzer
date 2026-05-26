import React, { useState, useEffect } from 'react'
import { IPC_CHANNELS, RequestMapRule } from '@shared/types'

const RequestMapEditor: React.FC = () => {
  const [rules, setRules] = useState<RequestMapRule[]>([])
  const [urlPattern, setUrlPattern] = useState('')
  const [mode, setMode] = useState<'file' | 'script'>('file')
  const [statusCode, setStatusCode] = useState(200)
  const [filePath, setFilePath] = useState('')
  const [scriptBody, setScriptBody] = useState('')

  useEffect(() => {
    window.electronAPI.invoke(IPC_CHANNELS.REQUEST_MAP_LIST)
      .then(setRules)
      .catch(() => {})
  }, [])

  const addRule = async () => {
    const rule = await window.electronAPI.invoke(IPC_CHANNELS.REQUEST_MAP_SAVE, {
      enabled: true, urlPattern, method: '*', mode,
      filePath: mode === 'file' ? filePath : null,
      scriptBody: mode === 'script' ? scriptBody : null,
      statusCode, contentType: 'application/json'
    })
    setRules(prev => [...prev, rule])
    setUrlPattern('')
    setFilePath('')
    setScriptBody('')
  }

  const deleteRule = async (id: number) => {
    await window.electronAPI.invoke(IPC_CHANNELS.REQUEST_MAP_DELETE, id)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="request-map-editor">
      <h4>Request Map / Mock Server</h4>
      <div className="add-rule-form">
        <input type="text" value={urlPattern} onChange={e => setUrlPattern(e.target.value)} placeholder="URL pattern (regex)" />
        <select value={mode} onChange={e => setMode(e.target.value as 'file' | 'script')}>
          <option value="file">Local File</option>
          <option value="script">Script</option>
        </select>
        {mode === 'file' ? (
          <input type="text" value={filePath} onChange={e => setFilePath(e.target.value)} placeholder="File path" />
        ) : (
          <textarea value={scriptBody} onChange={e => setScriptBody(e.target.value)} rows={4} placeholder="JavaScript function" />
        )}
        <input type="number" value={statusCode} onChange={e => setStatusCode(parseInt(e.target.value))} />
        <button onClick={addRule}>Add</button>
      </div>
      <table>
        <thead><tr><th>Pattern</th><th>Mode</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id}>
              <td>{r.urlPattern}</td>
              <td>{r.mode}</td>
              <td>{r.statusCode}</td>
              <td><button onClick={() => deleteRule(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default RequestMapEditor
