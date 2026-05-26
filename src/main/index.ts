// ============================================================================
// Main Electron Entry Point
// Orchestrates app startup, module wiring, and lifecycle management
// ============================================================================

import { app, BrowserWindow, session as electronSession } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createLogger } from './logger'
import { CaManager } from './proxy/ca-manager'
import { InterceptorChain } from './interceptors/interceptor-chain'
import { MitmProxyServer } from './proxy/mitm-proxy-server'
import { CaptureEngine } from './capture/capture-engine'
import { CdpManager } from './capture/cdp-manager'
import { StorageCollector } from './capture/storage-collector'
import { InteractionRecorder } from './capture/interaction-recorder'
import { registerIpcHandlers, AiAnalyzerLike, McpManagerLike } from './ipc'
import { createMainWindow, getMainWindow, updateBrowserViewBounds } from './window'
import { getDatabase, closeDatabase } from './db/database'
import { AppConfigRepo } from './db/repositories'

const logger = createLogger('main')

// --- Single instance lock ---
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  logger.info('Another instance is already running, quitting')
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// --- Module instances ---

let caManager: CaManager
let interceptorChain: InterceptorChain
let mitmProxyServer: MitmProxyServer
let captureEngine: CaptureEngine
let cdpManager: CdpManager
let storageCollector: StorageCollector
let interactionRecorder: InteractionRecorder
let aiAnalyzer: AiAnalyzerLike
let mcpManager: McpManagerLike

// --- AiAnalyzer stub (full implementation in ai/ module) ---

class DefaultAiAnalyzer implements AiAnalyzerLike {
  private llmConfig: any = null
  private activeAnalysis: Map<string, AbortController> = new Map()

  async runAnalysis(sessionId: string, config: any): Promise<any> {
    const { v4: uuid } = require('uuid')
    const analysisId = uuid()
    const abortController = new AbortController()
    this.activeAnalysis.set(analysisId, abortController)

    try {
      const { ReportRepo } = require('./db/repositories')

      // Determine LLM provider and build request
      const llmCfg = this.llmConfig || this.loadLlmConfig()
      if (!llmCfg || !llmCfg.apiKey) {
        throw new Error('LLM not configured. Please set API key in Settings.')
      }

      // Assemble request data for analysis
      const requestData = this.assembleData(sessionId, config)
      const prompt = this.buildPrompt(config, requestData)

      // Call LLM API
      const result = await this.callLlmApi(llmCfg, prompt, abortController.signal)

      // Persist the report
      const report = {
        id: analysisId,
        sessionId,
        mode: config.mode || 'auto',
        content: result.content,
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
        filterPromptTokens: null,
        filterCompletionTokens: null,
        createdAt: Date.now()
      }

      const reportRepo = new ReportRepo()
      reportRepo.insert(report)

      this.activeAnalysis.delete(analysisId)
      return report
    } catch (err: any) {
      this.activeAnalysis.delete(analysisId)
      if (err.name === 'AbortError') {
        return { id: analysisId, status: 'cancelled' }
      }
      throw err
    }
  }

  cancelAnalysis(analysisId: string): void {
    const ctrl = this.activeAnalysis.get(analysisId)
    if (ctrl) {
      ctrl.abort()
      this.activeAnalysis.delete(analysisId)
    }
  }

  async listReports(sessionId: string): Promise<any[]> {
    const { ReportRepo } = require('./db/repositories')
    return new ReportRepo().listBySession(sessionId)
  }

  async getReport(reportId: string): Promise<any | undefined> {
    const { ReportRepo } = require('./db/repositories')
    return new ReportRepo().getById(reportId)
  }

  async sendChat(reportId: string, message: string): Promise<any> {
    const { v4: uuid } = require('uuid')
    const { ChatMessageRepo, ReportRepo } = require('./db/repositories')

    const report = new ReportRepo().getById(reportId)
    if (!report) throw new Error('Report not found')

    // Save user message
    const chatRepo = new ChatMessageRepo()
    const userMsg = {
      id: uuid(),
      reportId,
      role: 'user',
      content: message,
      toolCalls: null,
      toolResults: null,
      createdAt: Date.now()
    }
    chatRepo.insert(userMsg)

    // Build context including previous messages
    const history = chatRepo.listByReport(reportId)
    const messages = history.map((m: any) => ({
      role: m.role,
      content: m.content
    }))

    // Add the current analysis context
    messages.unshift({
      role: 'system',
      content: `You are an AI assistant analyzing captured network traffic. Here is the analysis report context:\n\n${report.content}`
    })

    const llmCfg = this.llmConfig || this.loadLlmConfig()
    const result = await this.callLlmApi(llmCfg, messages, undefined)

    // Save assistant response
    const assistantMsg = {
      id: uuid(),
      reportId,
      role: 'assistant',
      content: result.content,
      toolCalls: null,
      toolResults: null,
      createdAt: Date.now()
    }
    chatRepo.insert(assistantMsg)

    return assistantMsg
  }

  async getChatHistory(reportId: string): Promise<any[]> {
    const { ChatMessageRepo } = require('./db/repositories')
    return new ChatMessageRepo().listByReport(reportId)
  }

  async listRequestLogs(sessionId: string): Promise<any[]> {
    const { AiRequestLogRepo } = require('./db/repositories')
    return new AiRequestLogRepo().listBySession(sessionId)
  }

  async testLlmConnection(config: any): Promise<{ success: boolean; message: string }> {
    try {
      const https = require('https')
      const http = require('http')

      const url = new URL(config.baseUrl || this.getDefaultBaseUrl(config.provider))
      const requestModule = url.protocol === 'https:' ? https : http

      // Simple models list request as a connectivity test
      const testUrl = `${url.protocol}//${url.host}/v1/models`
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: '/v1/models',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }

      return new Promise((resolve) => {
        const req = requestModule.request(options, (res: any) => {
          let body = ''
          res.on('data', (chunk: Buffer) => body += chunk)
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ success: true, message: 'Connection successful' })
            } else {
              resolve({ success: false, message: `HTTP ${res.statusCode}: ${body.substring(0, 200)}` })
            }
          })
        })
        req.on('error', (err: Error) => {
          resolve({ success: false, message: err.message })
        })
        req.on('timeout', () => {
          req.destroy()
          resolve({ success: false, message: 'Connection timed out' })
        })
        req.end()
      })
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  }

  getLlmConfig(): any {
    return this.llmConfig || this.loadLlmConfig()
  }

  setLlmConfig(config: any): void {
    this.llmConfig = config
  }

  // --- Private helpers ---

  private loadLlmConfig(): any {
    try {
      const repo = new AppConfigRepo()
      const val = repo.get('llm')
      if (val) {
        this.llmConfig = typeof val === 'string' ? JSON.parse(val) : val
        return this.llmConfig
      }
    } catch {}
    return null
  }

  private assembleData(sessionId: string, config: any): any {
    const { RequestRepo, HookRepo } = require('./db/repositories')
    const requestRepo = new RequestRepo()
    const hookRepo = new HookRepo()

    let requests: any[] = []
    let hooks: any[] = []

    if (config.selectedSeqs && config.selectedSeqs.length > 0) {
      for (const seq of config.selectedSeqs) {
        const req = requestRepo.getBySeq(sessionId, seq)
        if (req) requests.push(req)
      }
    } else {
      requests = requestRepo.listBySession(sessionId, 0, 200)
    }

    try {
      hooks = hookRepo.listBySession(sessionId).slice(0, 100)
    } catch {}

    return { requests, hooks }
  }

  private buildPrompt(config: any, data: any): any[] {
    const modePrompt = this.getModeSystemPrompt(config.mode)
    const dataSummary = this.summarizeData(data)

    return [
      {
        role: 'system',
        content: `${modePrompt}\n\n${config.customPrompt || ''}\n\n${config.customRequirements || ''}`
      },
      {
        role: 'user',
        content: dataSummary
      }
    ]
  }

  private getModeSystemPrompt(mode: string): string {
    const prompts: Record<string, string> = {
      auto: 'You are an AI assistant analyzing captured network traffic. Provide a comprehensive analysis including API structure, authentication methods, data flows, and security observations.',
      api_reverse: 'You are an API reverse engineering specialist. Analyze the captured traffic to identify all API endpoints, their parameters, authentication mechanisms, and data structures. Provide a complete API documentation.',
      security: 'You are a security analyst. Examine the captured traffic for security vulnerabilities, sensitive data exposure, authentication weaknesses, CSRF tokens, cookie security flags, and encryption issues.',
      performance: 'You are a performance optimization specialist. Analyze request timing, payload sizes, caching headers, compression, and identify performance bottlenecks and optimization opportunities.',
      crypto: 'You are a cryptography specialist. Analyze all encryption, hashing, signing, and key exchange operations visible in the traffic and JS hook captures. Identify algorithms, key patterns, and potential weaknesses.',
      custom: 'You are an AI assistant analyzing captured network traffic based on the user\'s custom requirements.'
    }
    return prompts[mode] || prompts.auto
  }

  private summarizeData(data: any): string {
    const lines: string[] = ['## Captured Traffic Data\n']

    for (const req of data.requests) {
      lines.push(`### ${req.method} ${req.url}`)
      if (req.statusCode) lines.push(`Status: ${req.statusCode}`)
      if (req.requestBody) lines.push(`Request Body: ${this.truncate(req.requestBody, 2000)}`)
      if (req.responseBody) lines.push(`Response Body: ${this.truncate(req.responseBody, 2000)}`)
      lines.push('')
    }

    if (data.hooks.length > 0) {
      lines.push('## JS Hook Captures\n')
      for (const hook of data.hooks) {
        lines.push(`- **${hook.hookType}** ${hook.functionName}(${this.truncate(hook.args, 200)})` +
          (hook.returnValue ? ` => ${this.truncate(hook.returnValue, 200)}` : ''))
      }
    }

    return lines.join('\n')
  }

  private truncate(str: string, maxLen: number): string {
    if (!str) return ''
    return str.length > maxLen ? str.substring(0, maxLen) + '...[truncated]' : str
  }

  private getDefaultBaseUrl(provider: string): string {
    switch (provider) {
      case 'openai': return 'https://api.openai.com/v1'
      case 'anthropic': return 'https://api.anthropic.com/v1'
      case 'minimax': return 'https://api.minimax.chat/v1'
      default: return 'https://api.openai.com/v1'
    }
  }

  private async callLlmApi(config: any, messages: any[], signal?: AbortSignal): Promise<{ content: string; usage?: any }> {
    const https = require('https')
    const http = require('http')
    const { v4: uuid } = require('uuid')

    const baseUrl = config.baseUrl || this.getDefaultBaseUrl(config.provider)
    const url = new URL(baseUrl)
    const requestModule = url.protocol === 'https:' ? https : http

    // Build provider-specific request body
    let requestBody: any
    let path = url.pathname

    if (config.provider === 'anthropic') {
      // Anthropic API format
      const systemMsg = messages.find((m: any) => m.role === 'system')
      const chatMsgs = messages.filter((m: any) => m.role !== 'system')

      requestBody = {
        model: config.model || 'claude-sonnet-4-20250514',
        max_tokens: config.maxTokens || 4096,
        system: systemMsg?.content || '',
        messages: chatMsgs.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      }

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        }
      }

      return this.makeRequest(requestModule, options, requestBody, signal)
    } else {
      // OpenAI-compatible API format
      requestBody = {
        model: config.model || 'gpt-4o',
        max_tokens: config.maxTokens || 4096,
        messages: messages
      }

      // Determine if we need /chat/completions path
      const chatPath = path.endsWith('/v1') ? '/v1/chat/completions' :
        path.endsWith('/') ? `${path}chat/completions` :
          `${path}/chat/completions`

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: chatPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        }
      }

      return this.makeRequest(requestModule, options, requestBody, signal)
    }
  }

  private makeRequest(requestModule: any, options: any, body: any, signal?: AbortSignal): Promise<{ content: string; usage?: any }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body)
      options.headers['Content-Length'] = Buffer.byteLength(payload)

      const req = requestModule.request(options, (res: any) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf-8')

          try {
            const json = JSON.parse(responseBody)

            if (res.statusCode !== 200) {
              reject(new Error(`LLM API error ${res.statusCode}: ${json.error?.message || responseBody.substring(0, 500)}`))
              return
            }

            // OpenAI format
            if (json.choices && json.choices[0]) {
              resolve({
                content: json.choices[0].message?.content || json.choices[0].text || '',
                usage: json.usage
              })
              return
            }

            // Anthropic format
            if (json.content && json.content[0]) {
              resolve({
                content: json.content[0].text || '',
                usage: json.usage
              })
              return
            }

            resolve({ content: responseBody })
          } catch {
            reject(new Error(`Failed to parse LLM response: ${responseBody.substring(0, 500)}`))
          }
        })
      })

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy()
          reject(new DOMException('Analysis cancelled', 'AbortError'))
        })
      }

      req.on('error', reject)
      req.setTimeout(120000, () => {
        req.destroy()
        reject(new Error('LLM API request timed out'))
      })

      req.write(payload)
      req.end()
    })
  }
}

// --- MCP Manager stub (full implementation in mcp/ module) ---

class DefaultMcpManager implements McpManagerLike {
  private servers: Map<string, any> = new Map()
  private connections: Map<string, { connected: boolean; tools: string[] }> = new Map()

  listServers(): any[] {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    return db.prepare('SELECT * FROM mcp_server_config ORDER BY name').all()
  }

  addServer(config: any): any {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    const { v4: uuid } = require('uuid')
    const id = config.id || uuid()

    db.prepare(`
      INSERT INTO mcp_server_config (id, name, transport, command, args, url, env, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, config.name, config.transport,
      config.command || null, config.args ? JSON.stringify(config.args) : null,
      config.url || null, config.env ? JSON.stringify(config.env) : null,
      config.enabled !== false ? 1 : 0
    )

    this.connections.set(id, { connected: false, tools: [] })

    if (config.enabled !== false) {
      this.startServer(id).catch(() => {})
    }

    return { id, ...config }
  }

  removeServer(id: string): void {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()
    this.stopServer(id).catch(() => {})
    db.prepare('DELETE FROM mcp_server_config WHERE id = ?').run(id)
    this.connections.delete(id)
  }

  updateServer(id: string, config: any): any {
    const { getDatabase } = require('./db/database')
    const db = getDatabase()

    db.prepare(`
      UPDATE mcp_server_config SET name = ?, transport = ?, command = ?, args = ?, url = ?, env = ?, enabled = ?
      WHERE id = ?
    `).run(
      config.name, config.transport,
      config.command || null, config.args ? JSON.stringify(config.args) : null,
      config.url || null, config.env ? JSON.stringify(config.env) : null,
      config.enabled !== false ? 1 : 0,
      id
    )

    this.connections.set(id, { connected: false, tools: [] })

    return { id, ...config }
  }

  getStatus(id: string): { connected: boolean; tools: string[] } {
    return this.connections.get(id) || { connected: false, tools: [] }
  }

  async startServer(id: string): Promise<void> {
    try {
      const { getDatabase } = require('./db/database')
      const db = getDatabase()
      const config = db.prepare('SELECT * FROM mcp_server_config WHERE id = ?').get(id) as any
      if (!config) return

      // The full MCP implementation would use @modelcontextprotocol/sdk
      // to spawn stdio processes or connect to streamable-http endpoints
      // and discover tools. This stub marks the server as reachable.
      logger.info('MCP server started', { id, name: config.name })
      this.connections.set(id, { connected: true, tools: [] })
    } catch (err) {
      logger.error('MCP server start failed', { id, error: (err as Error).message })
      this.connections.set(id, { connected: false, tools: [] })
    }
  }

  async stopServer(id: string): Promise<void> {
    const conn = this.connections.get(id)
    if (conn) {
      this.connections.set(id, { connected: false, tools: conn.tools })
    }
  }

  getToolDefinitions(): any[] {
    const tools: any[] = []
    for (const [, conn] of this.connections) {
      // Would aggregate tool definitions from connected servers
    }
    return tools
  }
}

// ============================================================================
// App Startup
// ============================================================================

app.whenReady().then(async () => {
  logger.info('Ai-analyzer starting...')

  // Initialize database (triggers migrations)
  getDatabase()

  // Create CA Manager and initialize certificates
  caManager = new CaManager()
  await caManager.initialize()
  logger.info('CA Manager initialized')

  // Create Interceptor Chain
  interceptorChain = new InterceptorChain()
  logger.info('Interceptor Chain created')

  // Create MITM Proxy Server
  mitmProxyServer = new MitmProxyServer(caManager, interceptorChain)
  logger.info('MITM Proxy Server created')

  // Create Capture Engine
  captureEngine = new CaptureEngine()
  logger.info('Capture Engine created')

  // Create CDP Manager
  cdpManager = new CdpManager()
  logger.info('CDP Manager created')

  // Create Storage Collector
  storageCollector = new StorageCollector()
  logger.info('Storage Collector created')

  // Create Interaction Recorder
  interactionRecorder = new InteractionRecorder()
  logger.info('Interaction Recorder created')

  // Create AI Analyzer
  aiAnalyzer = new DefaultAiAnalyzer()
  logger.info('AI Analyzer created')

  // Create MCP Manager
  mcpManager = new DefaultMcpManager()
  logger.info('MCP Manager created')

  // Wire proxy events -> capture engine
  mitmProxyServer.on('response-captured', (data: any) => {
    captureEngine.handleResponseCaptured(data)
  })

  // Wire CDP events -> capture engine
  cdpManager.on('response-captured', (data: any) => {
    captureEngine.handleResponseCaptured(data)
  })

  // Wire capture engine events to renderer notifications
  captureEngine.on('request-captured', () => {
    // Already handled inside CaptureEngine (broadcasts to renderer)
  })

  captureEngine.on('hook-captured', () => {
    // Already handled inside CaptureEngine (broadcasts to renderer)
  })

  captureEngine.on('storage-captured', () => {
    // Broadcast to renderer
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('storage:captured', { timestamp: Date.now() })
    }
  })

  // Create main window
  const mainWindow = createMainWindow()
  logger.info('Main window created')

  // Handle window resize for BrowserView bounds
  mainWindow.on('resize', () => {
    updateBrowserViewBounds()
  })

  // Set up IPC handlers (this wires everything together)
  registerIpcHandlers({
    captureEngine,
    cdpManager,
    caManager,
    mitmProxyServer,
    interceptorChain,
    storageCollector,
    interactionRecorder,
    aiAnalyzer,
    mcpManager,
    getMainWindow: () => getMainWindow()
  })

  // macOS: re-create window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })

  // Set up auto-updater
  setupAutoUpdater()

  logger.info('Ai-analyzer ready')
})

// ============================================================================
// App Shutdown
// ============================================================================

app.on('window-all-closed', () => {
  logger.info('All windows closed')

  // Clean up system proxy before quitting
  try {
    const configRepo = new AppConfigRepo()
    const proxyEnabled = configRepo.get('systemProxyEnabled')
    if (proxyEnabled === 'true' || proxyEnabled === true) {
      const { unsetSystemProxy } = require('./proxy/system-proxy')
      unsetSystemProxy().catch(() => {})
    }
  } catch {}

  // Stop proxy server
  if (mitmProxyServer?.isRunning()) {
    mitmProxyServer.stop().catch(() => {})
  }

  // Detach CDP
  if (cdpManager?.isAttached()) {
    cdpManager.detach().catch(() => {})
  }

  // Stop storage collector
  storageCollector?.stop()

  // Close database
  closeDatabase()

  // On macOS, apps typically stay active until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  logger.info('App quitting, cleaning up...')

  // Ensure system proxy is unset
  try {
    const { unsetSystemProxy } = require('./proxy/system-proxy')
    unsetSystemProxy().catch(() => {})
  } catch {}

  // Stop proxy if running
  if (mitmProxyServer?.isRunning()) {
    mitmProxyServer.stop().catch(() => {})
  }
})

// ============================================================================
// Security: Prevent new window creation and navigation restrictions
// ============================================================================

app.on('web-contents-created', (_event, contents) => {
  // Prevent new window creation from web content
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  // Prevent navigation to file:// protocol from renderer
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') && !url.includes('out/renderer')) {
      event.preventDefault()
    }
  })
})

// ============================================================================
// Auto Updater
// ============================================================================

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version })
    // Notify renderer about available update
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:available', {
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    logger.debug('Update download progress', { percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', () => {
    logger.info('Update downloaded, will install on quit')
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:downloaded')
    }
  })

  autoUpdater.on('error', (err) => {
    logger.error('Auto updater error', err)
  })

  // Check for updates (not in dev mode)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {
      logger.info('Update check failed (likely no internet)')
    })
  }
}
