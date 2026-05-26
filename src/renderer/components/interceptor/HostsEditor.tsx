import React, { useState, useEffect } from 'react'
import { IPC_CHANNELS, HostsRule } from '@shared/types'

const HostsEditor: React.FC = () => {
  const [rules, setRules] = useState<HostsRule[]>([])
  const [hostname, setHostname] = useState('')
  const [ip, setIp] = useState('')

  useEffect(() => {
    window.electronAPI.invoke(IPC_CHANNELS.HOSTS_LIST)
      .then(setRules)
      .catch(() => {})
  }, [])

  const addRule = async () => {
    if (!hostname || !ip) return
    const rule = await window.electronAPI.invoke(IPC_CHANNELS.HOSTS_SAVE, { enabled: true, hostname, ip })
    setRules(prev => [...prev, rule])
    setHostname('')
    setIp('')
  }

  const deleteRule = async (id: number) => {
    await window.electronAPI.invoke(IPC_CHANNELS.HOSTS_DELETE, id)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="hosts-editor">
      <h4>DNS Override / Hosts</h4>
      <div className="add-rule-row">
        <input type="text" value={hostname} onChange={e => setHostname(e.target.value)} placeholder="Hostname" />
        <input type="text" value={ip} onChange={e => setIp(e.target.value)} placeholder="IP Address" />
        <button onClick={addRule}>Add</button>
      </div>
      <table>
        <thead><tr><th>Hostname</th><th>IP</th><th>Enabled</th><th></th></tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id}>
              <td>{r.hostname}</td>
              <td>{r.ip}</td>
              <td>{r.enabled ? 'Yes' : 'No'}</td>
              <td><button onClick={() => deleteRule(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default HostsEditor
