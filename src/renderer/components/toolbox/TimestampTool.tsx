import React, { useState } from 'react'

const TimestampTool: React.FC = () => {
  const [timestamp, setTimestamp] = useState(Date.now().toString())
  const [format, setFormat] = useState('unix')
  const [result, setResult] = useState('')

  const convert = () => {
    try {
      const ts = parseInt(timestamp)
      const date = new Date(format === 'unix' ? ts * 1000 : ts)

      setResult([
        `UTC: ${date.toUTCString()}`,
        `Local: ${date.toLocaleString()}`,
        `ISO: ${date.toISOString()}`,
        `Unix: ${Math.floor(date.getTime() / 1000)}`,
        `Unix (ms): ${date.getTime()}`,
        `Relative: ${timeAgo(date)}`
      ].join('\n'))
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`)
    }
  }

  const now = () => {
    const ts = Math.floor(Date.now() / 1000).toString()
    setTimestamp(ts)
    const date = new Date(parseInt(ts) * 1000)
    setResult([
      `UTC: ${date.toUTCString()}`,
      `Local: ${date.toLocaleString()}`,
      `ISO: ${date.toISOString()}`,
      `Unix: ${parseInt(ts)}`,
      `Unix (ms): ${parseInt(ts) * 1000}`,
      `Relative: ${timeAgo(date)}`
    ].join('\n'))
  }

  return (
    <div className="toolbox-item">
      <h3>Timestamp Converter</h3>
      <div className="tool-controls">
        <div className="tool-row">
          <label>Timestamp</label>
          <input type="text" value={timestamp} onChange={e => { setTimestamp(e.target.value); }} />
          <select value={format} onChange={e => setFormat(e.target.value)}>
            <option value="unix">Unix (seconds)</option>
            <option value="ms">Unix (milliseconds)</option>
          </select>
        </div>
        <div className="tool-actions">
          <button onClick={convert}>Convert</button>
          <button onClick={now}>Now</button>
        </div>
        <pre className="code-block">{result}</pre>
      </div>
    </div>
  )
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return `${days} days ago`
}

export default TimestampTool
