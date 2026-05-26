import React, { useState } from 'react'
import { IPC_CHANNELS } from '@shared/types'

const AesTool: React.FC = () => {
  const [mode, setMode] = useState<'encrypt' | 'decrypt'>('encrypt')
  const [algorithm, setAlgorithm] = useState('AES-CBC')
  const [key, setKey] = useState('')
  const [iv, setIv] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')

  const handleProcess = async () => {
    try {
      const result = await window.electronAPI.invoke(
        mode === 'encrypt' ? IPC_CHANNELS.TOOLBOX_AES_ENCRYPT : IPC_CHANNELS.TOOLBOX_AES_DECRYPT,
        { algorithm, key, iv, input }
      )
      setOutput(result)
    } catch (err) {
      setOutput(`Error: ${(err as Error).message}`)
    }
  }

  return (
    <div className="toolbox-item">
      <h3>AES Encrypt / Decrypt</h3>
      <div className="tool-controls">
        <div className="tool-row">
          <label>Mode</label>
          <select value={mode} onChange={e => setMode(e.target.value as 'encrypt' | 'decrypt')}>
            <option value="encrypt">Encrypt</option>
            <option value="decrypt">Decrypt</option>
          </select>
        </div>
        <div className="tool-row">
          <label>Algorithm</label>
          <select value={algorithm} onChange={e => setAlgorithm(e.target.value)}>
            <option value="AES-CBC">AES-CBC</option>
            <option value="AES-ECB">AES-ECB</option>
            <option value="AES-GCM">AES-GCM</option>
          </select>
        </div>
        <div className="tool-row">
          <label>Key (hex)</label>
          <input type="text" value={key} onChange={e => setKey(e.target.value)} placeholder="e.g. 0123456789abcdef..." />
        </div>
        <div className="tool-row">
          <label>IV (hex)</label>
          <input type="text" value={iv} onChange={e => setIv(e.target.value)} placeholder="Optional" />
        </div>
        <div className="tool-row">
          <label>Input</label>
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={4} placeholder="Text or Base64..." />
        </div>
        <button onClick={handleProcess}>Process</button>
        <div className="tool-row">
          <label>Output</label>
          <textarea value={output} readOnly rows={4} />
        </div>
      </div>
    </div>
  )
}

export default AesTool
