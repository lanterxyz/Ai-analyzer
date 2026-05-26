import React, { useState } from 'react'

const RegexTester: React.FC = () => {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('gi')
  const [testStr, setTestStr] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [error, setError] = useState('')

  const test = () => {
    try {
      const regex = new RegExp(pattern, flags)
      const results: string[] = []
      let match
      while ((match = regex.exec(testStr)) !== null) {
        results.push(match[0])
        if (!flags.includes('g')) break
      }
      setMatches(results)
      setError('')
    } catch (err) {
      setError((err as Error).message)
      setMatches([])
    }
  }

  return (
    <div className="toolbox-item">
      <h3>Regex Tester</h3>
      <div className="tool-controls">
        <div className="tool-row">
          <label>Pattern</label>
          <input type="text" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="/pattern/" />
        </div>
        <div className="tool-row">
          <label>Flags</label>
          <input type="text" value={flags} onChange={e => setFlags(e.target.value)} style={{width: '80px'}} />
        </div>
        <div className="tool-row">
          <label>Test String</label>
          <textarea value={testStr} onChange={e => setTestStr(e.target.value)} rows={4} />
        </div>
        <button onClick={test}>Test</button>
        {error && <div className="tool-error">{error}</div>}
        <div className="tool-output">
          <label>Matches ({matches.length})</label>
          {matches.map((m, i) => <div key={i} className="match-item">{m}</div>)}
        </div>
      </div>
    </div>
  )
}

export default RegexTester
