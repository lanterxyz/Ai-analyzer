import React, { useState } from 'react'

function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary)
}

function base64Decode(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

const EncodingTool: React.FC = () => {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [operation, setOperation] = useState('base64Encode')

  const operations = [
    { key: 'base64Encode', label: 'Base64 Encode' },
    { key: 'base64Decode', label: 'Base64 Decode' },
    { key: 'urlEncode', label: 'URL Encode' },
    { key: 'urlDecode', label: 'URL Decode' },
    { key: 'hexEncode', label: 'Hex Encode' },
    { key: 'hexDecode', label: 'Hex Decode' },
    { key: 'htmlEncode', label: 'HTML Encode' },
    { key: 'htmlDecode', label: 'HTML Decode' }
  ]

  const process = () => {
    try {
      let result = ''
      switch (operation) {
        case 'base64Encode': result = base64Encode(input); break
        case 'base64Decode': result = base64Decode(input); break
        case 'urlEncode': result = encodeURIComponent(input); break
        case 'urlDecode': result = decodeURIComponent(input); break
        case 'hexEncode': result = Array.from(input).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '); break
        case 'hexDecode': result = input.split(' ').map(h => String.fromCharCode(parseInt(h, 16))).join(''); break
        case 'htmlEncode': result = input.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)); break
        case 'htmlDecode': { const el = document.createElement('div'); el.innerHTML = input; result = el.textContent || ''; break }
        default: result = input
      }
      setOutput(result)
    } catch (err) {
      setOutput(`Error: ${(err as Error).message}`)
    }
  }

  return (
    <div className="toolbox-item">
      <h3>Encoding / Decoding</h3>
      <div className="tool-controls">
        <div className="tool-row">
          <label>Operation</label>
          <select value={operation} onChange={e => setOperation(e.target.value)}>
            {operations.map(op => <option key={op.key} value={op.key}>{op.label}</option>)}
          </select>
        </div>
        <div className="tool-row">
          <label>Input</label>
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={4} />
        </div>
        <button onClick={process}>Process</button>
        <div className="tool-row">
          <label>Output</label>
          <textarea value={output} readOnly rows={4} />
        </div>
      </div>
    </div>
  )
}

export default EncodingTool
