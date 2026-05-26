// MCP Server - Built-in MCP server exposing analyzer capabilities as MCP tools
// Uses StreamableHTTP transport with CORS support
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import http from 'http'
import { createLogger } from '../logger'
import { SessionRepo, RequestRepo, HookRepo, StorageSnapshotRepo, ReportRepo, ChatMessageRepo } from '../db/repositories'
import { CaptureEngine } from '../capture/capture-engine'
import { getActiveTabWebContents, navigateTab, goBack, goForward, reload, getTabList, getActiveTabId } from '../tab-manager'

const logger = createLogger('mcp-server')

// ---------------------------------------------------------------------------
// Utility: capture engine accessor (lazy, set by app initialization)
// ---------------------------------------------------------------------------

let captureEngineRef: CaptureEngine | null = null

export function setCaptureEngine(engine: CaptureEngine): void {
  captureEngineRef = engine
}

function getCaptureEngine(): CaptureEngine {
  if (!captureEngineRef) {
    throw new Error('Capture engine not initialized. Start a capture session first.')
  }
  return captureEngineRef
}

// ---------------------------------------------------------------------------
// MCP Server Definition
// ---------------------------------------------------------------------------

function createAnalyzerMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ai-analyzer',
    version: '1.0.0'
  })

  // =========================================================================
  // Session Management Tools
  // =========================================================================

  server.tool(
    'list_sessions',
    'List all capture sessions. 返回所有抓包会话列表。',
    {},
    async () => {
      try {
        const repo = new SessionRepo()
        const sessions = repo.list()
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(sessions, null, 2)
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'create_session',
    'Create a new capture session. 创建新的抓包会话。',
    {
      name: z.string().describe('Session name / 会话名称'),
      targetUrl: z.string().optional().describe('Target URL to navigate / 目标网址'),
      proxyPort: z.number().optional().describe('Proxy port / 代理端口，默认8888')
    },
    async ({ name, targetUrl, proxyPort }) => {
      try {
        const repo = new SessionRepo()
        const session = repo.create({ name, targetUrl, proxyPort })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(session, null, 2)
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'start_capture',
    'Start capturing network traffic for a session. 开始对指定会话进行网络抓包。',
    {
      sessionId: z.string().describe('Session ID / 会话ID')
    },
    async ({ sessionId }) => {
      try {
        const repo = new SessionRepo()
        const session = repo.getById(sessionId)
        if (!session) {
          return { content: [{ type: 'text' as const, text: `Session not found: ${sessionId}` }], isError: true }
        }
        const engine = getCaptureEngine()
        engine.start(sessionId)
        repo.updateState(sessionId, 'capturing' as any)
        return {
          content: [{
            type: 'text' as const,
            text: `Capture started for session ${sessionId}`
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'stop_capture',
    'Stop capturing network traffic. 停止网络抓包。',
    {},
    async () => {
      try {
        const engine = getCaptureEngine()
        engine.stop()
        return {
          content: [{
            type: 'text' as const,
            text: 'Capture stopped'
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  // =========================================================================
  // Data Query Tools
  // =========================================================================

  server.tool(
    'get_requests',
    'Get captured requests for a session. 获取会话的抓包请求数据。',
    {
      sessionId: z.string().describe('Session ID / 会话ID'),
      offset: z.number().optional().describe('Pagination offset / 分页偏移，默认0'),
      limit: z.number().optional().describe('Max results / 最大返回数，默认500'),
      hostname: z.string().optional().describe('Filter by hostname / 按域名过滤')
    },
    async ({ sessionId, offset, limit, hostname }) => {
      try {
        const repo = new RequestRepo()
        let requests
        if (hostname) {
          requests = repo.filterByHostname(sessionId, hostname)
        } else {
          requests = repo.listBySession(sessionId, offset ?? 0, limit ?? 500)
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(requests, null, 2)
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'get_request_detail',
    'Get full details of a single captured request including headers and body. 获取单个请求的完整详情。',
    {
      requestId: z.string().describe('Request ID / 请求ID')
    },
    async ({ requestId }) => {
      try {
        const repo = new RequestRepo()
        const request = repo.getById(requestId)
        if (!request) {
          return { content: [{ type: 'text' as const, text: `Request not found: ${requestId}` }], isError: true }
        }
        // Also fetch associated JS hooks
        const hookRepo = new HookRepo()
        const hooks = request.sessionId ? hookRepo.listBySession(request.sessionId).filter(h => h.requestId === requestId) : []
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ request, hooks }, null, 2)
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'get_hooks',
    'Get JS hook records for a session (Fetch/XHR, crypto, cookie interceptions). 获取JS Hook记录。',
    {
      sessionId: z.string().describe('Session ID / 会话ID'),
      hookType: z.string().optional().describe('Filter by hook type (fetch/xhr/crypto_subtle/cryptojs/sm2/sm3/sm4/cookie) / 按Hook类型过滤')
    },
    async ({ sessionId, hookType }) => {
      try {
        const repo = new HookRepo()
        let hooks = repo.listBySession(sessionId)
        if (hookType) {
          hooks = hooks.filter(h => h.hookType === hookType)
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(hooks, null, 2)
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'get_storage',
    'Get latest storage snapshot (cookies, localStorage, sessionStorage) for a session. 获取最新的存储快照。',
    {
      sessionId: z.string().describe('Session ID / 会话ID')
    },
    async ({ sessionId }) => {
      try {
        const repo = new StorageSnapshotRepo()
        const snapshot = repo.getLatest(sessionId)
        if (!snapshot) {
          return { content: [{ type: 'text' as const, text: 'No storage snapshot available' }] }
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(snapshot, null, 2)
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  // =========================================================================
  // AI Analysis Tools
  // =========================================================================

  server.tool(
    'run_analysis',
    'Run AI analysis on captured traffic data. This triggers the analysis pipeline but does not stream results. Use get_reports to retrieve completed analysis. 对抓包数据运行AI分析。',
    {
      sessionId: z.string().describe('Session ID / 会话ID'),
      mode: z.enum(['auto', 'api_reverse', 'security', 'performance', 'crypto', 'custom']).describe('Analysis mode / 分析模式'),
      selectedSeqs: z.array(z.number()).optional().describe('Optional sequence numbers to analyze / 指定分析的请求序号')
    },
    async ({ sessionId, mode, selectedSeqs }) => {
      try {
        // This tool delegates to the analysis pipeline via IPC
        // The actual analysis execution is handled by the analysis engine
        // Here we return a message indicating the analysis request has been queued
        const { BrowserWindow } = require('electron')
        const mainWindow = BrowserWindow.getAllWindows()[0]
        if (mainWindow) {
          mainWindow.webContents.send('analysis:run', { sessionId, mode, selectedSeqs })
        }
        return {
          content: [{
            type: 'text' as const,
            text: `Analysis request queued for session ${sessionId} with mode ${mode}. Use get_reports to retrieve results.`
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'get_reports',
    'Get AI analysis reports for a session. 获取会话的AI分析报告。',
    {
      sessionId: z.string().describe('Session ID / 会话ID')
    },
    async ({ sessionId }) => {
      try {
        const repo = new ReportRepo()
        const reports = repo.listBySession(sessionId)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(reports, null, 2)
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'chat_followup',
    'Send a follow-up question for an existing analysis report. 对已有报告发送追问。',
    {
      reportId: z.string().describe('Report ID / 报告ID'),
      message: z.string().describe('Follow-up question / 追问内容')
    },
    async ({ reportId, message }) => {
      try {
        const reportRepo = new ReportRepo()
        const report = reportRepo.getById(reportId)
        if (!report) {
          return { content: [{ type: 'text' as const, text: `Report not found: ${reportId}` }], isError: true }
        }

        const chatRepo = new ChatMessageRepo()
        const history = chatRepo.listByReport(reportId)

        // Send chat request via IPC to renderer
        const { BrowserWindow } = require('electron')
        const mainWindow = BrowserWindow.getAllWindows()[0]
        if (mainWindow) {
          mainWindow.webContents.send('chat:send', { reportId, message })
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Chat follow-up sent for report ${reportId}. The analysis engine will process it. Use the chat history in the UI to see responses.`
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  // =========================================================================
  // Browser Control Tools
  // =========================================================================

  server.tool(
    'navigate',
    'Navigate the embedded browser to a URL. 在内嵌浏览器中导航到指定URL。',
    {
      url: z.string().describe('URL to navigate to / 目标URL')
    },
    async ({ url }) => {
      try {
        navigateTab(url)
        return {
          content: [{
            type: 'text' as const,
            text: `Navigated to ${url}`
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'browser_back',
    'Navigate browser back. 浏览器后退。',
    {},
    async () => {
      try {
        goBack()
        return {
          content: [{
            type: 'text' as const,
            text: 'Navigated back'
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'browser_forward',
    'Navigate browser forward. 浏览器前进。',
    {},
    async () => {
      try {
        goForward()
        return {
          content: [{
            type: 'text' as const,
            text: 'Navigated forward'
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'browser_reload',
    'Reload the current page in the browser. 刷新当前页面。',
    {},
    async () => {
      try {
        reload()
        return {
          content: [{
            type: 'text' as const,
            text: 'Page reloaded'
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'browser_screenshot',
    'Take a screenshot of the current browser page. 对当前页面截图，返回Base64图片。',
    {},
    async () => {
      try {
        const webContents = getActiveTabWebContents()
        if (!webContents) {
          return { content: [{ type: 'text' as const, text: 'No active browser tab' }], isError: true }
        }
        const image = await webContents.capturePage()
        const base64 = image.toPNG().toString('base64')
        return {
          content: [{
            type: 'image' as const,
            data: base64,
            mimeType: 'image/png'
          }]
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true }
      }
    }
  )

  return server
}

// ---------------------------------------------------------------------------
// HTTP Server Setup with CORS
// ---------------------------------------------------------------------------

let httpServer: http.Server | null = null

/**
 * CORS headers applied to all responses.
 */
function applyCORS(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')
}

/**
 * Start the built-in MCP server on the given port.
 * Returns the port the server is actually listening on.
 */
export async function startMcpServer(port = 3100): Promise<number> {
  if (httpServer) {
    logger.warn('MCP server already running')
    return port
  }

  const mcpServer = createAnalyzerMcpServer()

  // Create StreamableHTTP transport for the MCP server
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined // stateless mode
  })

  // Connect the MCP server to the transport
  await mcpServer.connect(transport)

  // Create HTTP server that delegates to the MCP transport handler
  httpServer = http.createServer(async (req, res) => {
    // Apply CORS headers to all responses
    applyCORS(res)

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Only accept POST on the MCP endpoint
    if (req.method === 'POST') {
      try {
        await transport.handleRequest(req, res)
      } catch (err) {
        logger.error('MCP request handling error', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      }
      return
    }

    // GET requests - return server info
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        name: 'ai-analyzer-mcp',
        version: '1.0.0',
        description: 'Ai-analyzer built-in MCP server',
        tools: [
          'list_sessions', 'create_session', 'start_capture', 'stop_capture',
          'get_requests', 'get_request_detail', 'get_hooks', 'get_storage',
          'run_analysis', 'get_reports', 'chat_followup',
          'navigate', 'browser_back', 'browser_forward', 'browser_reload', 'browser_screenshot'
        ]
      }))
      return
    }

    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  })

  return new Promise((resolve, reject) => {
    httpServer!.listen(port, '127.0.0.1', () => {
      const addr = httpServer!.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      logger.info('MCP server started', { port: actualPort })
      resolve(actualPort)
    })

    httpServer!.on('error', (err: any) => {
      logger.error('MCP server failed to start', err)
      httpServer = null
      reject(err)
    })
  })
}

/**
 * Stop the built-in MCP server.
 */
export async function stopMcpServer(): Promise<void> {
  if (!httpServer) {
    logger.warn('MCP server not running')
    return
  }

  return new Promise((resolve) => {
    httpServer!.close(() => {
      httpServer = null
      logger.info('MCP server stopped')
      resolve()
    })
  })
}

/**
 * Check if the built-in MCP server is running.
 */
export function isMcpServerRunning(): boolean {
  return httpServer !== null
}
