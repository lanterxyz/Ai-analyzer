import React, { useState, useEffect } from 'react'
import { IPC_CHANNELS, CapturedRequest } from '@shared/types'

interface RequestDetailProps {
  requestId: string
}

const RequestDetail: React.FC<RequestDetailProps> = ({ requestId }) => {
  const [detail, setDetail] = useState<CapturedRequest | null>(null)
  const [activeTab, setActiveTab] = useState<'headers' | 'body' | 'response' | 'hooks'>('headers')

  useEffect(() => {
    window.electronAPI.invoke(IPC_CHANNELS.REQUEST_DETAIL, requestId)
      .then((data: CapturedRequest) => setDetail(data))
      .catch(() => setDetail(null))
  }, [requestId])

  if (!detail) return <div className="request-detail empty">Select a request to view details</div>

  const formatJson = (str: string | null): string => {
    if (!str) return ''
    try {
      return JSON.stringify(JSON.parse(str), null, 2)
    } catch {
      return str
    }
  }

  return (
    <div className="request-detail">
      <div className="detail-header">
        <span className="detail-method" style={{ color: methodColor(detail.method) }}>{detail.method}</span>
        <span className="detail-url">{detail.url}</span>
        {detail.statusCode && (
          <span className="detail-status">{detail.statusCode}</span>
        )}
      </div>

      <div className="detail-tabs">
        <button className={activeTab === 'headers' ? 'active' : ''} onClick={() => setActiveTab('headers')}>Headers</button>
        <button className={activeTab === 'body' ? 'active' : ''} onClick={() => setActiveTab('body')}>Request Body</button>
        <button className={activeTab === 'response' ? 'active' : ''} onClick={() => setActiveTab('response')}>Response</button>
        <button className={activeTab === 'hooks' ? 'active' : ''} onClick={() => setActiveTab('hooks')}>Hooks</button>
        <div className="detail-actions">
          <button onClick={() => copyCurl()} title="Copy as cURL">cURL</button>
          <button onClick={() => copyFetch()} title="Copy as Fetch">Fetch</button>
        </div>
      </div>

      <div className="detail-content">
        {activeTab === 'headers' && (
          <div className="headers-view">
            <div className="headers-section">
              <h4>Request Headers</h4>
              <table>
                <tbody>
                  {Object.entries(detail.requestHeaders || {}).map(([key, value]) => (
                    <tr key={key}>
                      <td className="header-key">{key}</td>
                      <td className="header-value">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.responseHeaders && (
              <div className="headers-section">
                <h4>Response Headers</h4>
                <table>
                  <tbody>
                    {Object.entries(detail.responseHeaders).map(([key, value]) => (
                      <tr key={key}>
                        <td className="header-key">{key}</td>
                        <td className="header-value">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'body' && (
          <div className="body-view">
            <pre className="code-block">{formatJson(detail.requestBody)}</pre>
          </div>
        )}

        {activeTab === 'response' && (
          <div className="body-view">
            <pre className="code-block">{formatJson(detail.responseBody)}</pre>
          </div>
        )}

        {activeTab === 'hooks' && (
          <div className="hooks-view">
            <p className="empty-hint">Hook records will appear here</p>
          </div>
        )}
      </div>
    </div>
  )
}

function methodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '#52c41a', POST: '#1677ff', PUT: '#faad14',
    PATCH: '#faad14', DELETE: '#ff4d4f'
  }
  return colors[method] || '#8c8c8c'
}

function copyCurl() {
  // Will be implemented with IPC call
}

function copyFetch() {
  // Will be implemented with IPC call
}

export default RequestDetail
