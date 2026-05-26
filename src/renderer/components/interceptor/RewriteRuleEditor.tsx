import React, { useState, useEffect } from 'react'
import { IPC_CHANNELS, RewriteRule } from '@shared/types'

const RewriteRuleEditor: React.FC = () => {
  const [rules, setRules] = useState<RewriteRule[]>([])
  const [direction, setDirection] = useState<'request' | 'response'>('request')
  const [urlPattern, setUrlPattern] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [bodyReplace, setBodyReplace] = useState('')

  useEffect(() => {
    window.electronAPI.invoke(IPC_CHANNELS.REWRITE_RULE_LIST)
      .then(setRules)
      .catch(() => {})
  }, [])

  const addRule = async () => {
    const rule = await window.electronAPI.invoke(IPC_CHANNELS.REWRITE_RULE_SAVE, {
      enabled: true, direction, urlPattern,
      redirectUrl: redirectUrl || null,
      bodyReplace: bodyReplace ? JSON.stringify([{ pattern: bodyReplace, replacement: '', flags: 'g' }]) : null,
      headerAdd: null, headerRemove: null, headerReplace: null
    })
    setRules(prev => [...prev, rule])
    setUrlPattern('')
    setRedirectUrl('')
    setBodyReplace('')
  }

  const deleteRule = async (id: number) => {
    await window.electronAPI.invoke(IPC_CHANNELS.REWRITE_RULE_DELETE, id)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="rewrite-rule-editor">
      <h4>Request/Response Rewrite Rules</h4>
      <div className="add-rule-form">
        <select value={direction} onChange={e => setDirection(e.target.value as 'request' | 'response')}>
          <option value="request">Request</option>
          <option value="response">Response</option>
        </select>
        <input type="text" value={urlPattern} onChange={e => setUrlPattern(e.target.value)} placeholder="URL pattern (regex)" />
        <input type="text" value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)} placeholder="Redirect URL (optional)" />
        <textarea value={bodyReplace} onChange={e => setBodyReplace(e.target.value)} rows={2} placeholder="Body replace pattern (regex)" />
        <button onClick={addRule}>Add</button>
      </div>
      <table>
        <thead><tr><th>Direction</th><th>Pattern</th><th>Redirect</th><th></th></tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id}>
              <td>{r.direction}</td>
              <td>{r.urlPattern}</td>
              <td>{r.redirectUrl || '-'}</td>
              <td><button onClick={() => deleteRule(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default RewriteRuleEditor
