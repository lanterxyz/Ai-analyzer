import React, { useState, useEffect } from 'react'
import { IPC_CHANNELS, InterceptorScript } from '@shared/types'

const ScriptEditor: React.FC = () => {
  const [scripts, setScripts] = useState<InterceptorScript[]>([])
  const [name, setName] = useState('')
  const [scriptBody, setScriptBody] = useState('function onRequest(context, request) {\n  // Modify request here\n  return request;\n}')
  const [urlPattern, setUrlPattern] = useState('*')

  useEffect(() => {
    window.electronAPI.invoke(IPC_CHANNELS.SCRIPT_LIST)
      .then(setScripts)
      .catch(() => {})
  }, [])

  const addScript = async () => {
    const script = await window.electronAPI.invoke(IPC_CHANNELS.SCRIPT_SAVE, {
      enabled: true, name, scriptBody, urlPattern
    })
    setScripts(prev => [...prev, script])
    setName('')
  }

  const deleteScript = async (id: number) => {
    await window.electronAPI.invoke(IPC_CHANNELS.SCRIPT_DELETE, id)
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="script-editor">
      <h4>JavaScript Scripts</h4>
      <div className="add-script-form">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Script name" />
        <input type="text" value={urlPattern} onChange={e => setUrlPattern(e.target.value)} placeholder="URL pattern" />
        <textarea value={scriptBody} onChange={e => setScriptBody(e.target.value)} rows={8} className="code-editor" />
        <button onClick={addScript}>Add</button>
      </div>
      <div className="script-list">
        {scripts.map(s => (
          <div key={s.id} className="script-item">
            <span>{s.name}</span>
            <span className="script-pattern">{s.urlPattern}</span>
            <button onClick={() => deleteScript(s.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ScriptEditor
