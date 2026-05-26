import React, { useState, useEffect } from 'react'
import { IPC_CHANNELS, BlockRule } from '@shared/types'

const BlockRuleEditor: React.FC = () => {
  const [rules, setRules] = useState<BlockRule[]>([])
  const [urlPattern, setUrlPattern] = useState('')
  const [method, setMethod] = useState('*')

  useEffect(() => {
    window.electronAPI.invoke(IPC_CHANNELS.BLOCK_RULE_LIST)
      .then(setRules)
      .catch(() => {})
  }, [])

  const addRule = async () => {
    const rule = await window.electronAPI.invoke(IPC_CHANNELS.BLOCK_RULE_SAVE, {
      enabled: true, urlPattern, method, action: 'block'
    })
    setRules(prev => [...prev, rule])
    setUrlPattern('')
  }

  const deleteRule = async (id: number) => {
    await window.electronAPI.invoke(IPC_CHANNELS.BLOCK_RULE_DELETE, id)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="block-rule-editor">
      <h4>Request Block Rules</h4>
      <div className="add-rule-row">
        <input type="text" value={urlPattern} onChange={e => setUrlPattern(e.target.value)} placeholder="URL pattern (regex)" />
        <select value={method} onChange={e => setMethod(e.target.value)}>
          <option value="*">All</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
        <button onClick={addRule}>Add</button>
      </div>
      <table>
        <thead><tr><th>Pattern</th><th>Method</th><th>Action</th><th></th></tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id}>
              <td>{r.urlPattern}</td>
              <td>{r.method}</td>
              <td>{r.action}</td>
              <td><button onClick={() => deleteRule(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default BlockRuleEditor
