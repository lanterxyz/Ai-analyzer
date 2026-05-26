// ============================================================================
// IPC Handler Registration
// Registers all ipcMain.handle() and ipcMain.on() handlers
// ============================================================================

import { ipcMain, BrowserWindow, app, shell, dialog } from 'electron'
import { IPC_CHANNELS, RENDERER_EVENTS } from '@shared/types'
import { CaptureEngine } from './capture/capture-engine'
import { CdpManager } from './capture/cdp-manager'
import { CaManager } from './proxy/ca-manager'
import { MitmProxyServer } from './proxy/mitm-proxy-server'
import { InterceptorChain } from './interceptors/interceptor-chain'
import { StorageCollector } from './capture/storage-collector'
import { InteractionRecorder } from './capture/interaction-recorder'
import { ReplayEngine } from './capture/replay-engine'
import { BreakpointInterceptor } from './interceptors/breakpoint-interceptor'
import { injectHooks, setupAutoReinject } from './capture/js-injector'
import {
  SessionRepo, RequestRepo, HookRepo, StorageSnapshotRepo,
  ReportRepo, ChatMessageRepo, AiRequestLogRepo,
  InterceptorConfigRepo, HostsRuleRepo, RequestMapRuleRepo,
  RewriteRuleRepo, BlockRuleRepo, BreakpointRuleRepo,
  InterceptorScriptRepo, FavoriteRepo, DomainFilterRepo,
  PromptTemplateRepo, AppConfigRepo
} from './db/repositories'
import { installCaCertificate, uninstallCaCertificate } from './proxy/cert-installer'
import { setSystemProxy, unsetSystemProxy } from './proxy/system-proxy'
import {
  createTab, closeTab, activateTab, getTabList,
  navigateTab, goBack, goForward, reload, clearBrowserEnv,
  getActiveTabWebContents, getActiveTabId
} from './tab-manager'
import { getMainWindow, getBrowserView, updateBrowserViewBounds } from './window'
import { createLogger } from './logger'

const logger = createLogger('ipc')

interface IpcDeps {
  captureEngine: CaptureEngine
  cdpManager: CdpManager
  caManager: CaManager
  mitmProxyServer: MitmProxyServer
  interceptorChain: InterceptorChain
  storageCollector: StorageCollector
  interactionRecorder: InteractionRecorder
  aiAnalyzer: AiAnalyzerLike
  mcpManager: McpManagerLike
  getMainWindow: () => BrowserWindow | null
}

/**
 * Minimal interface for AiAnalyzer - implemented by the AI module
 */
export interface AiAnalyzerLike {
  runAnalysis(sessionId: string, config: any): Promise<any>
  cancelAnalysis(analysisId: string): void
  listReports(sessionId: string): Promise<any[]>
  getReport(reportId: string): Promise<any | undefined>
  sendChat(reportId: string, message: string): Promise<any>
  getChatHistory(reportId: string): Promise<any[]>
  listRequestLogs(sessionId: string): Promise<any[]>
  testLlmConnection(config: any): Promise<{ success: boolean; message: string }>
  getLlmConfig(): any
  setLlmConfig(config: any): void
}

/**
 * Minimal interface for MCP Manager - implemented by the MCP module
 */
export interface McpManagerLike {
  listServers(): any[]
  addServer(config: any): any
  removeServer(id: string): void
  updateServer(id: string, config: any): any
  getStatus(id: string): { connected: boolean; tools: string[] }
  startServer(id: string): Promise<void>
  stopServer(id: string): Promise<void>
  getToolDefinitions(): any[]
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const {
    captureEngine,
    cdpManager,
    caManager,
    mitmProxyServer,
    interceptorChain,
    storageCollector,
    interactionRecorder,
    aiAnalyzer,
    mcpManager,
    getMainWindow
  } = deps

  // ==========================================================================
  // Session Management
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
    const repo = new SessionRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, data: { name: string; targetUrl?: string; proxyPort?: number }) => {
    const repo = new SessionRepo()
    return repo.create(data)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, id: string) => {
    const repo = new SessionRepo()
    repo.delete(id)
    // Also clean up related data
    const requestRepo = new RequestRepo()
    requestRepo.deleteBySession(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET, async (_event, id: string) => {
    const repo = new SessionRepo()
    return repo.getById(id)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_RENAME, async (_event, id: string, name: string) => {
    const repo = new SessionRepo()
    repo.rename(id, name)
    return { success: true }
  })

  // ==========================================================================
  // Capture Control
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.CAPTURE_START, async (_event, sessionId: string) => {
    const sessionRepo = new SessionRepo()
    const session = sessionRepo.getById(sessionId)
    if (!session) throw new Error('Session not found')

    captureEngine.start(sessionId)
    sessionRepo.updateState(sessionId, 'capturing' as any)

    // Attach CDP to active tab if available
    const webContents = getActiveTabWebContents()
    if (webContents) {
      try {
        await cdpManager.attach(webContents)
        // Inject hooks and set up auto-reinject
        injectHooks(webContents)
        setupAutoReinject(webContents)
      } catch (err) {
        logger.error('CDP attach failed on capture start', err)
      }
    }

    // Start storage collector
    const activeTabId = getActiveTabId()
    if (activeTabId) {
      storageCollector.start(sessionId, `persist:tab-${activeTabId}`, (snapshot) => {
        captureEngine.handleStorageCollected(snapshot)
      })
    }

    // Notify renderer
    broadcastToRenderer(RENDERER_EVENTS.CAPTURE_STATE_CHANGED, { state: 'capturing' })

    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURE_STOP, async (_event) => {
    const sessionId = (captureEngine as any).sessionId
    captureEngine.stop()

    // Detach CDP
    try {
      await cdpManager.detach()
    } catch {}

    // Stop storage collector
    storageCollector.stop()

    // Update session state
    if (sessionId) {
      const repo = new SessionRepo()
      repo.updateState(sessionId, 'stopped' as any)
    }

    broadcastToRenderer(RENDERER_EVENTS.CAPTURE_STATE_CHANGED, { state: 'stopped' })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURE_PAUSE, async (_event) => {
    captureEngine.pause()
    broadcastToRenderer(RENDERER_EVENTS.CAPTURE_STATE_CHANGED, { state: 'paused' })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURE_RESUME, async (_event) => {
    captureEngine.resume()
    broadcastToRenderer(RENDERER_EVENTS.CAPTURE_STATE_CHANGED, { state: 'capturing' })
    return { success: true }
  })

  // ==========================================================================
  // Request Queries
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.REQUEST_LIST, async (_event, sessionId: string, offset?: number, limit?: number) => {
    const repo = new RequestRepo()
    return repo.listBySession(sessionId, offset || 0, limit || 500)
  })

  ipcMain.handle(IPC_CHANNELS.REQUEST_DETAIL, async (_event, id: string) => {
    const repo = new RequestRepo()
    return repo.getById(id)
  })

  ipcMain.handle(IPC_CHANNELS.REQUEST_DELETE, async (_event, id: string) => {
    const repo = new RequestRepo()
    // Delete single request by id - using the db directly since there's no single delete method
    const { getDatabase } = require('./db/database')
    getDatabase().prepare('DELETE FROM requests WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.REQUEST_EXPORT, async (_event, ids: string[], format: string) => {
    const repo = new RequestRepo()
    const requests = ids.map(id => repo.getById(id)).filter(Boolean)

    if (format === 'json') {
      return JSON.stringify(requests, null, 2)
    }

    // For HAR format, delegate to HAR export
    return JSON.stringify(requests, null, 2)
  })

  ipcMain.handle(IPC_CHANNELS.REQUEST_FILTER, async (_event, sessionId: string, filters: { hostname?: string; method?: string; statusCode?: number; keyword?: string }) => {
    const repo = new RequestRepo()
    if (filters.hostname) {
      return repo.filterByHostname(sessionId, filters.hostname)
    }
    // For other filters, fall back to listing all and filter in-memory
    const all = repo.listBySession(sessionId, 0, 10000)
    return all.filter(r => {
      if (filters.method && r.method !== filters.method) return false
      if (filters.statusCode && r.statusCode !== filters.statusCode) return false
      if (filters.keyword && !r.url.includes(filters.keyword) && !(r.requestBody || '').includes(filters.keyword)) return false
      return true
    })
  })

  // ==========================================================================
  // Hooks
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.HOOK_LIST, async (_event, sessionId: string) => {
    const repo = new HookRepo()
    return repo.listBySession(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.HOOK_DETAIL, async (_event, requestId: string) => {
    const repo = new HookRepo()
    return repo.getByRequestId(requestId)
  })

  // ==========================================================================
  // Storage
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.STORAGE_LATEST, async (_event, sessionId: string) => {
    const repo = new StorageSnapshotRepo()
    return repo.getLatest(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_DIFF, async (_event, sessionId: string, snapshotId1: string, snapshotId2: string) => {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    const s1 = db.prepare('SELECT * FROM storage_snapshots WHERE id = ?').get(snapshotId1) as any
    const s2 = db.prepare('SELECT * FROM storage_snapshots WHERE id = ?').get(snapshotId2) as any

    if (!s1 || !s2) return null

    const parseEntries = (raw: string) => {
      try { return JSON.parse(raw) } catch { return [] }
    }

    const diffEntries = (oldEntries: any[], newEntries: any[], keyField = 'key') => {
      const oldMap = new Map(oldEntries.map((e: any) => [e[keyField], e]))
      const newMap = new Map(newEntries.map((e: any) => [e[keyField], e]))
      const added: any[] = []
      const changed: any[] = []
      const removed: string[] = []

      for (const [key, val] of newMap) {
        if (!oldMap.has(key)) {
          added.push(val)
        } else if (JSON.stringify(oldMap.get(key)) !== JSON.stringify(val)) {
          changed.push(val)
        }
      }
      for (const [key] of oldMap) {
        if (!newMap.has(key)) removed.push(key)
      }

      return { added, changed, removed }
    }

    return {
      cookies: diffEntries(parseEntries(s1.cookies), parseEntries(s2.cookies)),
      localStorage: diffEntries(parseEntries(s1.local_storage), parseEntries(s2.local_storage)),
      sessionStorage: diffEntries(parseEntries(s1.session_storage), parseEntries(s2.session_storage))
    }
  })

  // ==========================================================================
  // AI Analysis
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.ANALYSIS_RUN, async (_event, sessionId: string, config: any) => {
    try {
      const result = await aiAnalyzer.runAnalysis(sessionId, config)
      broadcastToRenderer(RENDERER_EVENTS.ANALYSIS_COMPLETE, result)
      return result
    } catch (err) {
      logger.error('Analysis run failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.ANALYSIS_CANCEL, async (_event, analysisId: string) => {
    aiAnalyzer.cancelAnalysis(analysisId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.ANALYSIS_LIST, async (_event, sessionId: string) => {
    return aiAnalyzer.listReports(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.ANALYSIS_GET, async (_event, reportId: string) => {
    return aiAnalyzer.getReport(reportId)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_SEND, async (_event, reportId: string, message: string) => {
    try {
      const result = await aiAnalyzer.sendChat(reportId, message)
      broadcastToRenderer(RENDERER_EVENTS.CHAT_COMPLETE, result)
      return result
    } catch (err) {
      logger.error('Chat send failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_HISTORY, async (_event, reportId: string) => {
    return aiAnalyzer.getChatHistory(reportId)
  })

  ipcMain.handle(IPC_CHANNELS.AI_LOG_LIST, async (_event, sessionId: string) => {
    return aiAnalyzer.listRequestLogs(sessionId)
  })

  // ==========================================================================
  // Browser Control
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.BROWSER_NAVIGATE, async (_event, url: string) => {
    navigateTab(url)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_BACK, async () => {
    goBack()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_FORWARD, async () => {
    goForward()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_RELOAD, async () => {
    reload()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_ENV, async () => {
    clearBrowserEnv()
    return { success: true }
  })

  // ==========================================================================
  // Tabs
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, async (_event, tabId: string, url?: string) => {
    const tab = createTab(tabId, url)

    // If capture is active, attach CDP to the new tab
    if (captureEngine.isCapturing()) {
      const webContents = tab.view.webContents
      try {
        await cdpManager.attach(webContents)
        injectHooks(webContents)
        setupAutoReinject(webContents)
      } catch (err) {
        logger.error('CDP attach failed for new tab', err)
      }
    }

    return { id: tab.id, url: tab.url, title: tab.title }
  })

  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, async (_event, tabId: string) => {
    closeTab(tabId)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.TAB_LIST, async () => {
    return getTabList()
  })

  ipcMain.handle(IPC_CHANNELS.TAB_SWITCH, async (_event, tabId: string) => {
    activateTab(tabId)
    updateBrowserViewBounds()
    return { success: true }
  })

  // ==========================================================================
  // Proxy
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.PROXY_START, async (_event, port: number) => {
    try {
      await mitmProxyServer.start(port)
      broadcastToRenderer(RENDERER_EVENTS.PROXY_STATUS_CHANGED, { running: true, port })
      return { success: true, port }
    } catch (err) {
      logger.error('Proxy start failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_STOP, async () => {
    try {
      await mitmProxyServer.stop()
      broadcastToRenderer(RENDERER_EVENTS.PROXY_STATUS_CHANGED, { running: false, port: null })
      return { success: true }
    } catch (err) {
      logger.error('Proxy stop failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_STATUS, async () => {
    return {
      running: mitmProxyServer.isRunning(),
      port: mitmProxyServer.getPort()
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_CONFIG, async (_event, config: any) => {
    if (config.upstreamProxy) {
      mitmProxyServer.setUpstreamProxy(
        config.upstreamProxy.type,
        config.upstreamProxy.host,
        config.upstreamProxy.port
      )
    } else {
      mitmProxyServer.clearUpstreamProxy()
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_PROXY_SET, async (_event, host: string, port: number) => {
    await setSystemProxy(host, port)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_PROXY_UNSET, async () => {
    await unsetSystemProxy()
    return { success: true }
  })

  // ==========================================================================
  // CA Certificate
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.CA_INSTALL, async () => {
    try {
      await installCaCertificate(caManager)
      return { success: true }
    } catch (err) {
      logger.error('CA install failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.CA_UNINSTALL, async () => {
    try {
      await uninstallCaCertificate()
      return { success: true }
    } catch (err) {
      logger.error('CA uninstall failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.CA_REGENERATE, async () => {
    try {
      await caManager.regenerateCA()
      return { success: true }
    } catch (err) {
      logger.error('CA regeneration failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.CA_EXPORT, async () => {
    try {
      const certPem = caManager.getCaCertPem()
      const { filePath } = await dialog.showSaveDialog(getMainWindow()!, {
        title: 'Export CA Certificate',
        defaultPath: 'ai-analyzer-ca.crt',
        filters: [{ name: 'Certificate', extensions: ['crt', 'pem', 'cer'] }]
      })
      if (filePath) {
        const fs = require('fs')
        fs.writeFileSync(filePath, certPem)
        return { success: true, path: filePath }
      }
      return { success: false }
    } catch (err) {
      logger.error('CA export failed', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.CA_STATUS, async () => {
    return {
      initialized: caManager.isInitialized(),
      certPem: caManager.isInitialized() ? caManager.getCaCertPem() : null
    }
  })

  // ==========================================================================
  // Settings
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async (_event, key?: string) => {
    const repo = new AppConfigRepo()
    if (key) {
      const value = repo.get(key)
      return value ? JSON.parse(value) : null
    }
    // Return all config
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    const rows = db.prepare('SELECT key, value FROM app_config').all() as { key: string; value: string }[]
    const config: Record<string, any> = {}
    for (const row of rows) {
      try {
        config[row.key] = JSON.parse(row.value)
      } catch {
        config[row.key] = row.value
      }
    }
    return config
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_event, key: string, value: any) => {
    const repo = new AppConfigRepo()
    repo.set(key, JSON.stringify(value))
    return { success: true }
  })

  // ==========================================================================
  // LLM
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.LLM_CONFIG, async (_event, config?: any) => {
    if (config) {
      aiAnalyzer.setLlmConfig(config)
      // Also persist in app_config
      const repo = new AppConfigRepo()
      repo.set('llm', JSON.stringify(config))
      return { success: true }
    }
    return aiAnalyzer.getLlmConfig()
  })

  ipcMain.handle(IPC_CHANNELS.LLM_TEST, async (_event, config: any) => {
    return aiAnalyzer.testLlmConnection(config)
  })

  // ==========================================================================
  // MCP
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.MCP_LIST, async () => {
    return mcpManager.listServers()
  })

  ipcMain.handle(IPC_CHANNELS.MCP_ADD, async (_event, config: any) => {
    return mcpManager.addServer(config)
  })

  ipcMain.handle(IPC_CHANNELS.MCP_REMOVE, async (_event, id: string) => {
    mcpManager.removeServer(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_UPDATE, async (_event, id: string, config: any) => {
    return mcpManager.updateServer(id, config)
  })

  ipcMain.handle(IPC_CHANNELS.MCP_STATUS, async (_event, id: string) => {
    return mcpManager.getStatus(id)
  })

  // ==========================================================================
  // Interceptors
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.INTERCEPTOR_LIST, async () => {
    return interceptorChain.listInterceptors()
  })

  ipcMain.handle(IPC_CHANNELS.INTERCEPTOR_SAVE, async (_event, name: string, enabled: boolean, configJson?: string) => {
    interceptorChain.enable(name as any, enabled)
    // Persist
    const repo = new InterceptorConfigRepo()
    repo.save({ name: name as any, enabled, order: interceptorChain.listInterceptors().find(i => i.name === name)?.order ?? 0, configJson: configJson || null })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.INTERCEPTOR_DELETE, async (_event, name: string) => {
    interceptorChain.enable(name as any, false)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.INTERCEPTOR_REORDER, async (_event, order: string[]) => {
    interceptorChain.setOrder(order as any[])
    // Persist the order
    const repo = new InterceptorConfigRepo()
    for (let i = 0; i < order.length; i++) {
      const interceptor = interceptorChain.listInterceptors().find(ic => ic.name === order[i])
      repo.save({ name: order[i] as any, enabled: interceptor?.enabled ?? true, order: i, configJson: null })
    }
    return { success: true }
  })

  // --- Hosts Interceptor ---

  ipcMain.handle(IPC_CHANNELS.HOSTS_LIST, async () => {
    const repo = new HostsRuleRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.HOSTS_SAVE, async (_event, rule: { enabled: boolean; hostname: string; ip: string }) => {
    const repo = new HostsRuleRepo()
    return repo.save(rule)
  })

  ipcMain.handle(IPC_CHANNELS.HOSTS_DELETE, async (_event, id: number) => {
    const repo = new HostsRuleRepo()
    repo.delete(id)
    return { success: true }
  })

  // --- Request Map Interceptor ---

  ipcMain.handle(IPC_CHANNELS.REQUEST_MAP_LIST, async () => {
    const repo = new RequestMapRuleRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.REQUEST_MAP_SAVE, async (_event, rule: any) => {
    const repo = new RequestMapRuleRepo()
    return repo.save(rule)
  })

  ipcMain.handle(IPC_CHANNELS.REQUEST_MAP_DELETE, async (_event, id: number) => {
    const repo = new RequestMapRuleRepo()
    repo.delete(id)
    return { success: true }
  })

  // --- Rewrite Interceptor ---

  ipcMain.handle(IPC_CHANNELS.REWRITE_RULE_LIST, async () => {
    const repo = new RewriteRuleRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.REWRITE_RULE_SAVE, async (_event, rule: any) => {
    const repo = new RewriteRuleRepo()
    return repo.save(rule)
  })

  ipcMain.handle(IPC_CHANNELS.REWRITE_RULE_DELETE, async (_event, id: number) => {
    const repo = new RewriteRuleRepo()
    repo.delete(id)
    return { success: true }
  })

  // --- Script Interceptor ---

  ipcMain.handle(IPC_CHANNELS.SCRIPT_LIST, async () => {
    const repo = new InterceptorScriptRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.SCRIPT_SAVE, async (_event, script: any) => {
    const repo = new InterceptorScriptRepo()
    return repo.save(script)
  })

  ipcMain.handle(IPC_CHANNELS.SCRIPT_DELETE, async (_event, id: number) => {
    const repo = new InterceptorScriptRepo()
    repo.delete(id)
    return { success: true }
  })

  // --- Block Interceptor ---

  ipcMain.handle(IPC_CHANNELS.BLOCK_RULE_LIST, async () => {
    const repo = new BlockRuleRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.BLOCK_RULE_SAVE, async (_event, rule: any) => {
    const repo = new BlockRuleRepo()
    return repo.save(rule)
  })

  ipcMain.handle(IPC_CHANNELS.BLOCK_RULE_DELETE, async (_event, id: number) => {
    const repo = new BlockRuleRepo()
    repo.delete(id)
    return { success: true }
  })

  // --- Breakpoint Interceptor ---

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_RULE_LIST, async () => {
    const repo = new BreakpointRuleRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_RULE_SAVE, async (_event, rule: any) => {
    const repo = new BreakpointRuleRepo()
    return repo.save(rule)
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_RULE_DELETE, async (_event, id: number) => {
    const repo = new BreakpointRuleRepo()
    repo.delete(id)
    return { success: true }
  })

  ipcMain.on(IPC_CHANNELS.BREAKPOINT_CONTINUE, (_event, requestId: string, modified: any) => {
    BreakpointInterceptor.continueBreakpoint(requestId, modified)
  })

  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_EDIT, async (_event, requestId: string, modified: any) => {
    BreakpointInterceptor.continueBreakpoint(requestId, modified)
    return { success: true }
  })

  // --- Report Server Config ---

  ipcMain.handle(IPC_CHANNELS.REPORT_SERVER_CONFIG, async (_event, config?: any) => {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()

    if (config) {
      db.prepare(`
        INSERT INTO report_server_config (id, enabled, endpoint_url, auth_header, filter_pattern)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET enabled = ?, endpoint_url = ?, auth_header = ?, filter_pattern = ?
      `).run(
        config.enabled ? 1 : 0, config.endpointUrl, config.authHeader || null, config.filterPattern || null,
        config.enabled ? 1 : 0, config.endpointUrl, config.authHeader || null, config.filterPattern || null
      )
      return { success: true }
    }

    const row = db.prepare('SELECT * FROM report_server_config WHERE id = 1').get() as any
    if (!row) return null
    return {
      enabled: row.enabled === 1,
      endpointUrl: row.endpoint_url,
      authHeader: row.auth_header,
      filterPattern: row.filter_pattern
    }
  })

  // --- AES Decrypt Config ---

  ipcMain.handle(IPC_CHANNELS.AES_DECRYPT_CONFIG, async (_event, config?: any) => {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()

    if (config) {
      db.prepare(`
        INSERT INTO aes_decrypt_config (id, enabled, algorithm, key_hex, iv_hex, direction)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET enabled = ?, algorithm = ?, key_hex = ?, iv_hex = ?, direction = ?
      `).run(
        config.enabled ? 1 : 0, config.algorithm, config.keyHex, config.ivHex || null, config.direction,
        config.enabled ? 1 : 0, config.algorithm, config.keyHex, config.ivHex || null, config.direction
      )
      return { success: true }
    }

    const row = db.prepare('SELECT * FROM aes_decrypt_config WHERE id = 1').get() as any
    if (!row) return null
    return {
      enabled: row.enabled === 1,
      algorithm: row.algorithm,
      keyHex: row.key_hex,
      ivHex: row.iv_hex,
      direction: row.direction
    }
  })

  // ==========================================================================
  // Favorites
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.FAVORITE_ADD, async (_event, sessionId: string, requestId: string, label?: string) => {
    const repo = new FavoriteRepo()
    repo.add(sessionId, requestId, label)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FAVORITE_REMOVE, async (_event, id: number) => {
    const repo = new FavoriteRepo()
    repo.remove(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FAVORITE_LIST, async (_event, sessionId: string) => {
    const repo = new FavoriteRepo()
    return repo.list(sessionId)
  })

  // ==========================================================================
  // Domain Filter
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.DOMAIN_FILTER_LIST, async () => {
    const repo = new DomainFilterRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.DOMAIN_FILTER_SAVE, async (_event, domain: string, enabled?: boolean) => {
    const repo = new DomainFilterRepo()
    repo.save(domain, enabled)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.DOMAIN_FILTER_DELETE, async (_event, id: number) => {
    const repo = new DomainFilterRepo()
    repo.delete(id)
    return { success: true }
  })

  // ==========================================================================
  // Prompt Templates
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.PROMPT_TEMPLATE_LIST, async () => {
    const repo = new PromptTemplateRepo()
    return repo.list()
  })

  ipcMain.handle(IPC_CHANNELS.PROMPT_TEMPLATE_SAVE, async (_event, template: any) => {
    const repo = new PromptTemplateRepo()
    repo.save(template)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.PROMPT_TEMPLATE_DELETE, async (_event, id: string) => {
    const repo = new PromptTemplateRepo()
    repo.delete(id)
    return { success: true }
  })

  // ==========================================================================
  // Toolbox
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.TOOLBOX_AES_ENCRYPT, async (_event, data: string, keyHex: string, ivHex?: string, algorithm?: string) => {
    try {
      const crypto = require('crypto')
      const key = Buffer.from(keyHex, 'hex')
      const iv = ivHex ? Buffer.from(ivHex, 'hex') : Buffer.alloc(16, 0)
      const cipher = crypto.createCipheriv(algorithm || 'AES-CBC', key, iv)
      let encrypted = cipher.update(data, 'utf-8', 'base64')
      encrypted += cipher.final('base64')
      return { success: true, result: encrypted }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.TOOLBOX_AES_DECRYPT, async (_event, data: string, keyHex: string, ivHex?: string, algorithm?: string) => {
    try {
      const crypto = require('crypto')
      const key = Buffer.from(keyHex, 'hex')
      const iv = ivHex ? Buffer.from(ivHex, 'hex') : Buffer.alloc(16, 0)
      const decipher = crypto.createDecipheriv(algorithm || 'AES-CBC', key, iv)
      let decrypted = decipher.update(data, 'base64', 'utf-8')
      decrypted += decipher.final('utf-8')
      return { success: true, result: decrypted }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.TOOLBOX_CERT_HASH, async (_event, certPem: string) => {
    try {
      const crypto = require('crypto')
      const hash = crypto.createHash('sha256').update(certPem).digest('hex')
      return { success: true, result: hash }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.TOOLBOX_JS_RUN, async (_event, code: string, context?: Record<string, any>) => {
    try {
      const vm = require('vm')
      const sandbox = context || {}
      const script = new vm.Script(code, { filename: 'toolbox-script.js' })
      const ctx = vm.createContext(sandbox)
      const result = script.runInContext(ctx, { timeout: 5000 })
      return { success: true, result: typeof result === 'object' ? JSON.stringify(result) : String(result) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ==========================================================================
  // HAR Export / Import
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.HAR_EXPORT, async (_event, sessionId: string) => {
    const repo = new RequestRepo()
    const requests = repo.listBySession(sessionId, 0, 10000)
    const hookRepo = new HookRepo()
    const hooks = hookRepo.listBySession(sessionId)

    const har = {
      log: {
        version: '1.2',
        creator: { name: 'Ai-analyzer', version: '1.0.0' },
        entries: requests.map(req => ({
          startedDateTime: new Date(req.createdAt).toISOString(),
          time: 0,
          request: {
            method: req.method,
            url: req.url,
            httpVersion: 'HTTP/1.1',
            headers: Object.entries(req.requestHeaders).map(([name, value]) => ({ name, value })),
            queryString: [],
            postData: req.requestBody ? { mimeType: req.contentType || 'application/octet-stream', text: req.requestBody } : undefined,
            bodySize: req.requestBody ? Buffer.byteLength(req.requestBody) : 0
          },
          response: req.statusCode ? {
            status: req.statusCode,
            statusText: '',
            httpVersion: 'HTTP/1.1',
            headers: req.responseHeaders ? Object.entries(req.responseHeaders).map(([name, value]) => ({ name, value })) : [],
            content: {
              size: req.responseBody ? Buffer.byteLength(req.responseBody) : 0,
              mimeType: req.contentType || 'application/octet-stream',
              text: req.responseBody || ''
            }
          } : undefined,
          timings: { send: 0, wait: 0, receive: 0 }
        }))
      }
    }

    return JSON.stringify(har, null, 2)
  })

  ipcMain.handle(IPC_CHANNELS.HAR_IMPORT, async (_event, harJson: string, sessionId: string) => {
    try {
      const har = JSON.parse(harJson)
      const entries = har.log?.entries || []
      const repo = new RequestRepo()
      const { v4: uuid } = require('uuid')

      let seq = 0
      for (const entry of entries) {
        seq++
        const req = entry.request || {}
        const res = entry.response || {}

        const requestHeaders: Record<string, string> = {}
        for (const h of (req.headers || [])) {
          requestHeaders[h.name] = h.value
        }

        const responseHeaders: Record<string, string> = {}
        for (const h of (res.headers || [])) {
          responseHeaders[h.name] = h.value
        }

        let hostname = ''
        let path = ''
        try {
          const urlObj = new URL(req.url || '')
          hostname = urlObj.hostname
          path = urlObj.pathname + urlObj.search
        } catch {}

        repo.insert({
          id: uuid(),
          sessionId,
          seq,
          source: 'proxy' as any,
          method: req.method || 'GET',
          url: req.url || '',
          hostname,
          path,
          statusCode: res.status || null,
          contentType: res.content?.mimeType || null,
          requestHeaders,
          requestBody: req.postData?.text || null,
          responseHeaders: Object.keys(responseHeaders).length > 0 ? responseHeaders : null,
          responseBody: res.content?.text || null,
          responseEncoding: null,
          isStreaming: false,
          isWebsocket: false,
          timing: null,
          tabId: null,
          createdAt: entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : Date.now()
        })
      }

      return { success: true, count: seq }
    } catch (err) {
      logger.error('HAR import failed', err)
      throw err
    }
  })

  // ==========================================================================
  // cURL / Fetch Generation
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.CURL_GENERATE, async (_event, requestId: string) => {
    const repo = new RequestRepo()
    const req = repo.getById(requestId)
    if (!req) throw new Error('Request not found')

    let curl = `curl -X ${req.method} '${req.url}'`
    for (const [name, value] of Object.entries(req.requestHeaders)) {
      curl += ` \\\n  -H '${name}: ${value.replace(/'/g, "\\'")}'`
    }
    if (req.requestBody) {
      curl += ` \\\n  -d '${req.requestBody.replace(/'/g, "\\'")}'`
    }
    return curl
  })

  ipcMain.handle(IPC_CHANNELS.FETCH_GENERATE, async (_event, requestId: string) => {
    const repo = new RequestRepo()
    const req = repo.getById(requestId)
    if (!req) throw new Error('Request not found')

    const headersObj: Record<string, string> = {}
    for (const [name, value] of Object.entries(req.requestHeaders)) {
      headersObj[name] = value
    }

    const fetchCode = `fetch('${req.url}', {
  method: '${req.method}',
  headers: ${JSON.stringify(headersObj, null, 4)}${req.requestBody ? `,\n  body: ${JSON.stringify(req.requestBody)}` : ''}
})`

    return fetchCode
  })

  // ==========================================================================
  // Fingerprint
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_LIST, async () => {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    return db.prepare('SELECT * FROM fingerprint_profiles ORDER BY created_at DESC').all()
  })

  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_SAVE, async (_event, profile: any) => {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    const { v4: uuid } = require('uuid')

    const id = profile.id || uuid()
    db.prepare(`
      INSERT INTO fingerprint_profiles (id, name, user_agent, platform, language, languages,
        color_depth, device_memory, hardware_concurrency, screen_resolution,
        available_screen_resolution, timezone_offset, webgl_vendor, webgl_renderer,
        is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = ?, user_agent = ?, platform = ?, language = ?,
        languages = ?, color_depth = ?, device_memory = ?, hardware_concurrency = ?,
        screen_resolution = ?, available_screen_resolution = ?, timezone_offset = ?,
        webgl_vendor = ?, webgl_renderer = ?
    `).run(
      id, profile.name, profile.userAgent, profile.platform,
      profile.language, JSON.stringify(profile.languages || []),
      profile.colorDepth || 24, profile.deviceMemory || 8,
      profile.hardwareConcurrency || 8, (profile.screenResolution || [1920, 1080]).join(','),
      (profile.availableScreenResolution || [1920, 1040]).join(','),
      profile.timezoneOffset ?? -480, profile.webglVendor || 'Google Inc.',
      profile.webglRenderer || 'ANGLE', profile.isDefault ? 1 : 0,
      profile.createdAt || Date.now(),
      profile.name, profile.userAgent, profile.platform,
      profile.language, JSON.stringify(profile.languages || []),
      profile.colorDepth || 24, profile.deviceMemory || 8,
      profile.hardwareConcurrency || 8, (profile.screenResolution || [1920, 1080]).join(','),
      (profile.availableScreenResolution || [1920, 1040]).join(','),
      profile.timezoneOffset ?? -480, profile.webglVendor || 'Google Inc.',
      profile.webglRenderer || 'ANGLE'
    )
    return { success: true, id }
  })

  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_DELETE, async (_event, id: string) => {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    db.prepare('DELETE FROM fingerprint_profiles WHERE id = ? AND is_default = 0').run(id)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_APPLY, async (_event, profileId: string) => {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    const profile = db.prepare('SELECT * FROM fingerprint_profiles WHERE id = ?').get(profileId) as any
    if (!profile) throw new Error('Fingerprint profile not found')

    // Apply via preload script injection into the active browser view
    const webContents = getActiveTabWebContents()
    if (webContents) {
      const injectionScript = `
        (function() {
          const overrides = ${JSON.stringify({
            userAgent: profile.user_agent,
            platform: profile.platform,
            language: profile.language,
            languages: JSON.parse(profile.languages || '[]'),
            colorDepth: profile.color_depth,
            deviceMemory: profile.device_memory,
            hardwareConcurrency: profile.hardware_concurrency,
            screenResolution: profile.screen_resolution,
            availableScreenResolution: profile.available_screen_resolution,
            timezoneOffset: profile.timezone_offset,
            webglVendor: profile.webgl_vendor,
            webglRenderer: profile.webgl_renderer
          })};

          // Override navigator properties
          Object.defineProperty(navigator, 'userAgent', { get: () => overrides.userAgent });
          Object.defineProperty(navigator, 'platform', { get: () => overrides.platform });
          Object.defineProperty(navigator, 'language', { get: () => overrides.language });
          Object.defineProperty(navigator, 'languages', { get: () => overrides.languages });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => overrides.deviceMemory });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => overrides.hardwareConcurrency });

          // Override screen properties
          if (window.screen) {
            const res = overrides.screenResolution.split(',').map(Number);
            const availRes = overrides.availableScreenResolution.split(',').map(Number);
            Object.defineProperty(screen, 'width', { get: () => res[0] });
            Object.defineProperty(screen, 'height', { get: () => res[1] });
            Object.defineProperty(screen, 'availWidth', { get: () => availRes[0] });
            Object.defineProperty(screen, 'availHeight', { get: () => availRes[1] });
            Object.defineProperty(screen, 'colorDepth', { get: () => overrides.colorDepth });
            Object.defineProperty(screen, 'pixelDepth', { get: () => overrides.colorDepth });
          }
        })();
      `
      webContents.executeJavaScript(injectionScript).catch((err: Error) => {
        logger.error('Fingerprint apply injection failed', err)
      })
    }

    // Persist active profile
    const configRepo = new AppConfigRepo()
    configRepo.set('activeFingerprintProfile', profileId)

    return { success: true }
  })

  // ==========================================================================
  // Interaction Recording
  // ==========================================================================

  ipcMain.handle(IPC_CHANNELS.INTERACTION_RECORD_START, async (_event, sessionId: string) => {
    const webContents = getActiveTabWebContents()
    if (!webContents) throw new Error('No active browser tab')

    interactionRecorder.start(sessionId, webContents)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.INTERACTION_RECORD_STOP, async () => {
    const events = interactionRecorder.stop()
    return events
  })

  ipcMain.handle(IPC_CHANNELS.INTERACTION_GET, async () => {
    return await interactionRecorder.collectEvents()
  })

  ipcMain.handle(IPC_CHANNELS.INTERACTION_REPLAY, async (_event, events: any[], speed?: number) => {
    const webContents = getActiveTabWebContents()
    if (!webContents) throw new Error('No active browser tab')

    const replayEngine = new ReplayEngine()
    await replayEngine.replay(webContents, events, speed || 1)
    return { success: true }
  })

  // ==========================================================================
  // Window Controls
  // ==========================================================================

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const win = getMainWindow()
    if (win) win.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const win = getMainWindow()
    if (win) win.close()
  })

  // ==========================================================================
  // Hook data relay from target-preload
  // ==========================================================================

  ipcMain.on('hook:captured-relay', (_event, data: any) => {
    captureEngine.handleHookCaptured(data)
  })

  ipcMain.on('interaction:captured-relay', (_event, data: any) => {
    if (interactionRecorder.isRecording()) {
      broadcastToRenderer(RENDERER_EVENTS.INTERACTION_CAPTURED, data)
    }
  })

  // ==========================================================================
  // Forward proxy/CDP captured events to captureEngine
  // ==========================================================================

  mitmProxyServer.on('response-captured', (data: Partial<any>) => {
    captureEngine.handleResponseCaptured(data)
  })

  cdpManager.on('response-captured', (data: Partial<any>) => {
    captureEngine.handleResponseCaptured(data)
  })

  logger.info('All IPC handlers registered')
}

// --- Utility ---

function broadcastToRenderer(channel: string, data: any): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
