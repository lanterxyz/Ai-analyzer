import React, { useState, useEffect } from 'react'
import { ThemeMode, Locale, IPC_CHANNELS, LLMProvider, LlmConfig, ProxyConfig } from '@shared/types'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  locale: Locale
  onLocaleChange: (locale: Locale) => void
}

type SettingsTab = 'general' | 'llm' | 'proxy' | 'mcp' | 'fingerprint' | 'interceptor'

const SettingsModal: React.FC<SettingsModalProps> = ({
  open, onClose, theme, onThemeChange, locale, onLocaleChange
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({
    provider: LLMProvider.OPENAI,
    model: 'gpt-4o',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    maxTokens: 4096
  })
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>({
    enabled: false,
    port: 8888,
    systemProxyEnabled: false,
    caInstalled: false,
    upstreamProxy: null
  })

  useEffect(() => {
    if (open) {
      window.electronAPI.invoke(IPC_CHANNELS.LLM_CONFIG)
        .then(config => config && setLlmConfig(config))
        .catch(() => {})
      window.electronAPI.invoke(IPC_CHANNELS.PROXY_CONFIG)
        .then(config => config && setProxyConfig(config))
        .catch(() => {})
    }
  }, [open])

  const saveLlmConfig = async () => {
    await window.electronAPI.invoke(IPC_CHANNELS.LLM_CONFIG, llmConfig)
  }

  const testLlm = async () => {
    try {
      const result = await window.electronAPI.invoke(IPC_CHANNELS.LLM_TEST, llmConfig)
      alert(result.success ? 'Connection successful!' : `Failed: ${result.error}`)
    } catch (err) {
      alert(`Error: ${(err as Error).message}`)
    }
  }

  const saveProxyConfig = async () => {
    await window.electronAPI.invoke(IPC_CHANNELS.PROXY_CONFIG, proxyConfig)
  }

  if (!open) return null

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'llm', label: 'LLM / AI' },
    { key: 'proxy', label: 'Proxy / MITM' },
    { key: 'mcp', label: 'MCP' },
    { key: 'fingerprint', label: 'Fingerprint' },
    { key: 'interceptor', label: 'Interceptors' }
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <div className="settings-tabs">
            {tabs.map(t => (
              <button
                key={t.key}
                className={`settings-tab ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="settings-panel">
            {activeTab === 'general' && (
              <div className="settings-section">
                <label>Theme</label>
                <select value={theme} onChange={e => onThemeChange(e.target.value as ThemeMode)}>
                  <option value={ThemeMode.LIGHT}>Light</option>
                  <option value={ThemeMode.DARK}>Dark</option>
                </select>

                <label>Language</label>
                <select value={locale} onChange={e => onLocaleChange(e.target.value as Locale)}>
                  <option value={Locale.ZH}>中文</option>
                  <option value={Locale.EN}>English</option>
                </select>
              </div>
            )}

            {activeTab === 'llm' && (
              <div className="settings-section">
                <label>Provider</label>
                <select value={llmConfig.provider} onChange={e => setLlmConfig({ ...llmConfig, provider: e.target.value as LLMProvider })}>
                  <option value={LLMProvider.OPENAI}>OpenAI</option>
                  <option value={LLMProvider.ANTHROPIC}>Anthropic</option>
                  <option value={LLMProvider.CUSTOM}>Custom (OpenAI-compatible)</option>
                  <option value={LLMProvider.MINIMAX}>Minimax</option>
                </select>

                <label>Model</label>
                <input type="text" value={llmConfig.model} onChange={e => setLlmConfig({ ...llmConfig, model: e.target.value })} />

                <label>API Key</label>
                <input type="password" value={llmConfig.apiKey} onChange={e => setLlmConfig({ ...llmConfig, apiKey: e.target.value })} />

                <label>Base URL</label>
                <input type="text" value={llmConfig.baseUrl} onChange={e => setLlmConfig({ ...llmConfig, baseUrl: e.target.value })} />

                <label>Max Tokens</label>
                <input type="number" value={llmConfig.maxTokens} onChange={e => setLlmConfig({ ...llmConfig, maxTokens: parseInt(e.target.value) || 4096 })} />

                <div className="settings-actions">
                  <button onClick={saveLlmConfig}>Save</button>
                  <button onClick={testLlm}>Test Connection</button>
                </div>
              </div>
            )}

            {activeTab === 'proxy' && (
              <div className="settings-section">
                <label>Proxy Port</label>
                <input type="number" value={proxyConfig.port} onChange={e => setProxyConfig({ ...proxyConfig, port: parseInt(e.target.value) || 8888 })} />

                <label>
                  <input type="checkbox" checked={proxyConfig.systemProxyEnabled} onChange={e => setProxyConfig({ ...proxyConfig, systemProxyEnabled: e.target.checked })} />
                  Set as System Proxy
                </label>

                <label>
                  <input type="checkbox" checked={proxyConfig.caInstalled} onChange={e => setProxyConfig({ ...proxyConfig, caInstalled: e.target.checked })} />
                  CA Certificate Installed
                </label>

                <div className="settings-actions">
                  <button onClick={saveProxyConfig}>Save</button>
                  <button onClick={() => window.electronAPI.invoke(IPC_CHANNELS.CA_INSTALL)}>Install CA</button>
                  <button onClick={() => window.electronAPI.invoke(IPC_CHANNELS.CA_UNINSTALL)}>Uninstall CA</button>
                </div>
              </div>
            )}

            {activeTab === 'mcp' && (
              <div className="settings-section">
                <p>MCP server configuration will appear here</p>
              </div>
            )}

            {activeTab === 'fingerprint' && (
              <div className="settings-section">
                <p>Browser fingerprint profiles will appear here</p>
              </div>
            )}

            {activeTab === 'interceptor' && (
              <div className="settings-section">
                <p>Interceptor chain configuration will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
