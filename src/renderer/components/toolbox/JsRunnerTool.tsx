import React, { useState } from 'react'
import { IPC_CHANNELS } from '@shared/types'

const JsRunnerTool: React.FC = () => {
  const [script, setScript] = useState('console.log("Hello from Ai-analyzer!")')
  const [output, setOutput] = useState('')

  const run = async () => {
    try {
      const result = await window.electronAPI.invoke(IPC_CHANNELS.TOOLBOX_JS_RUN, script)
      setOutput(result)
    } catch (err) {
      setOutput(`Error: ${(err as Error).message}`)
    }
  }

  return (
    <div className="toolbox-item">
      <h3>JavaScript Runner</h3>
      <div className="tool-controls">
        <textarea value={script} onChange={e => setScript(e.target.value)} rows={10} className="code-editor" />
        <button onClick={run}>Run</button>
        <div className="tool-output">
          <label>Output</label>
          <pre className="code-block">{output}</pre>
        </div>
      </div>
    </div>
  )
}

export default JsRunnerTool
