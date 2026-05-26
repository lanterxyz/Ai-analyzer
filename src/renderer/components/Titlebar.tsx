import React from 'react'
import { ThemeMode, Locale, IPC_CHANNELS } from '@shared/types'

interface TitlebarProps {
  activeView: 'browser' | 'inspector' | 'report' | 'toolbox'
  onViewChange: (view: 'browser' | 'inspector' | 'report' | 'toolbox') => void
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  locale: Locale
  onLocaleChange: (locale: Locale) => void
  onSettingsOpen: () => void
}

const Titlebar: React.FC<TitlebarProps> = ({
  activeView, onViewChange, theme, onThemeChange,
  locale, onLocaleChange, onSettingsOpen
}) => {
  const views = [
    { key: 'browser' as const, label: locale === Locale.ZH ? '浏览器' : 'Browser' },
    { key: 'inspector' as const, label: locale === Locale.ZH ? '检查器' : 'Inspector' },
    { key: 'report' as const, label: locale === Locale.ZH ? 'AI报告' : 'AI Report' },
    { key: 'toolbox' as const, label: locale === Locale.ZH ? '工具箱' : 'Toolbox' }
  ]

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-logo">Ai-analyzer</span>
        <div className="view-tabs">
          {views.map(v => (
            <button
              key={v.key}
              className={`view-tab ${activeView === v.key ? 'active' : ''}`}
              onClick={() => onViewChange(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="titlebar-right">
        <button
          className="titlebar-icon-btn"
          onClick={() => onThemeChange(theme === ThemeMode.DARK ? ThemeMode.LIGHT : ThemeMode.DARK)}
          title={theme === ThemeMode.DARK ? 'Light Mode' : 'Dark Mode'}
        >
          {theme === ThemeMode.DARK ? '☀' : '☾'}
        </button>
        <button
          className="titlebar-icon-btn"
          onClick={() => onLocaleChange(locale === Locale.ZH ? Locale.EN : Locale.ZH)}
          title={locale === Locale.ZH ? 'English' : '中文'}
        >
          {locale === Locale.ZH ? 'EN' : '中'}
        </button>
        <button className="titlebar-icon-btn" onClick={onSettingsOpen} title="Settings">⚙</button>
        <div className="window-controls">
          <button onClick={() => window.electronAPI.send(IPC_CHANNELS.WINDOW_MINIMIZE)}>─</button>
          <button onClick={() => window.electronAPI.send(IPC_CHANNELS.WINDOW_MAXIMIZE)}>□</button>
          <button className="close-btn" onClick={() => window.electronAPI.send(IPC_CHANNELS.WINDOW_CLOSE)}>✕</button>
        </div>
      </div>
    </div>
  )
}

export default Titlebar
