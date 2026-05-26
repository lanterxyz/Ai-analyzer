import React, { useState } from 'react'
import QRCode from 'qrcode'

const QrCodeTool: React.FC = () => {
  const [text, setText] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')

  const generate = async () => {
    try {
      const url = await QRCode.toDataURL(text, { width: 256, margin: 2 })
      setQrDataUrl(url)
    } catch (err) {
      setQrDataUrl('')
    }
  }

  return (
    <div className="toolbox-item">
      <h3>QR Code Generator</h3>
      <div className="tool-controls">
        <div className="tool-row">
          <label>Content</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Enter text or URL..." />
        </div>
        <button onClick={generate}>Generate</button>
        {qrDataUrl && (
          <div className="qr-output">
            <img src={qrDataUrl} alt="QR Code" />
          </div>
        )}
      </div>
    </div>
  )
}

export default QrCodeTool
