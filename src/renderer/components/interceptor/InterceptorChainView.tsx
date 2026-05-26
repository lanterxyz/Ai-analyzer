import React, { useState, useEffect } from 'react'
import { IPC_CHANNELS, InterceptorType } from '@shared/types'

const InterceptorChainView: React.FC = () => {
  const [interceptors, setInterceptors] = useState<{ name: InterceptorType; enabled: boolean; order: number }[]>([])

  useEffect(() => {
    window.electronAPI.invoke(IPC_CHANNELS.INTERCEPTOR_LIST)
      .then(setInterceptors)
      .catch(() => {})
  }, [])

  const toggleEnabled = async (name: InterceptorType, enabled: boolean) => {
    await window.electronAPI.invoke(IPC_CHANNELS.INTERCEPTOR_SAVE, { name, enabled: !enabled })
    setInterceptors(prev => prev.map(i => i.name === name ? { ...i, enabled: !enabled } : i))
  }

  const typeLabels: Record<InterceptorType, string> = {
    [InterceptorType.HOSTS]: 'DNS Override',
    [InterceptorType.REQUEST_MAP]: 'Request Map / Mock',
    [InterceptorType.REQUEST_REWRITE]: 'Request Rewrite',
    [InterceptorType.SCRIPT]: 'JS Script',
    [InterceptorType.REQUEST_BLOCK]: 'Request Block',
    [InterceptorType.BREAKPOINT]: 'Breakpoint',
    [InterceptorType.REPORT_SERVER]: 'Report Server',
    [InterceptorType.AES_DECRYPT]: 'AES Decrypt'
  }

  return (
    <div className="interceptor-chain">
      <h3>Interceptor Chain</h3>
      <div className="interceptor-list">
        {interceptors.map(i => (
          <div key={i.name} className="interceptor-item">
            <span className="interceptor-order">{i.order + 1}</span>
            <label className="interceptor-toggle">
              <input
                type="checkbox"
                checked={i.enabled}
                onChange={() => toggleEnabled(i.name, i.enabled)}
              />
              {typeLabels[i.name] || i.name}
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

export default InterceptorChainView
