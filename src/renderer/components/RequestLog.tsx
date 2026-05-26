import React, { useState, useEffect, useMemo } from 'react'
import { IPC_CHANNELS, CaptureSource } from '@shared/types'

interface RequestLogProps {
  requests: any[]
  selectedId: string | null
  onSelect: (id: string) => void
  sessionId: string | null
}

const RequestLog: React.FC<RequestLogProps> = ({ requests, selectedId, onSelect, sessionId }) => {
  const [filter, setFilter] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (filter && !r.url.includes(filter) && !r.hostname?.includes(filter)) return false
      if (domainFilter && !r.hostname?.includes(domainFilter)) return false
      if (methodFilter && r.method !== methodFilter) return false
      return true
    })
  }, [requests, filter, domainFilter, methodFilter])

  const methodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: '#52c41a', POST: '#1677ff', PUT: '#faad14',
      PATCH: '#faad14', DELETE: '#ff4d4f', OPTIONS: '#8c8c8c',
      HEAD: '#8c8c8c'
    }
    return colors[method] || '#8c8c8c'
  }

  const statusColor = (code: number | null) => {
    if (!code) return '#8c8c8c'
    if (code < 300) return '#52c41a'
    if (code < 400) return '#faad14'
    return '#ff4d4f'
  }

  return (
    <div className="request-log">
      <div className="request-log-filters">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="filter-input"
        />
        <input
          type="text"
          placeholder="Domain..."
          value={domainFilter}
          onChange={e => setDomainFilter(e.target.value)}
          className="filter-input"
        />
        <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}>
          <option value="">All</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>
      <div className="request-list-table">
        <div className="request-list-header">
          <span className="col-seq">#</span>
          <span className="col-method">Method</span>
          <span className="col-url">URL</span>
          <span className="col-status">Status</span>
          <span className="col-type">Type</span>
          <span className="col-source">Source</span>
        </div>
        <div className="request-list-body">
          {filtered.map(req => (
            <div
              key={req.id}
              className={`request-row ${req.id === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(req.id)}
            >
              <span className="col-seq">{req.seq}</span>
              <span className="col-method" style={{ color: methodColor(req.method) }}>{req.method}</span>
              <span className="col-url" title={req.url}>{truncateUrl(req.url)}</span>
              <span className="col-status" style={{ color: statusColor(req.statusCode) }}>{req.statusCode || '...'}</span>
              <span className="col-type">{formatContentType(req.contentType)}</span>
              <span className="col-source">{req.source === 'proxy' ? 'P' : 'C'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname + u.search
    return path.length > 60 ? path.substring(0, 57) + '...' : path
  } catch {
    return url.length > 60 ? url.substring(0, 57) + '...' : url
  }
}

function formatContentType(ct: string | null | undefined): string {
  if (!ct) return ''
  const short: Record<string, string> = {
    'application/json': 'JSON',
    'text/html': 'HTML',
    'text/css': 'CSS',
    'application/javascript': 'JS',
    'text/event-stream': 'SSE',
    'application/xml': 'XML',
    'text/plain': 'TXT',
    'image/': 'IMG',
    'application/octet-stream': 'BIN'
  }
  for (const [key, val] of Object.entries(short)) {
    if (ct.includes(key)) return val
  }
  return ct.split(';')[0].substring(0, 10)
}

export default RequestLog
