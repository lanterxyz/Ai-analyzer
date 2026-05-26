// MITM Proxy Server - HTTP/HTTPS interception with interceptor chain
import http from 'http'
import https from 'https'
import net from 'net'
import tls from 'tls'
import { URL } from 'url'
import { EventEmitter } from 'events'
import { CaManager } from './ca-manager'
import { InterceptorChain } from '../interceptors/interceptor-chain'
import { ProxyContext, CaptureSource, CapturedRequest, HttpMethod } from '@shared/types'
import { v4 as uuid } from 'uuid'
import { createLogger } from '../logger'
import { createCertDownloadHandler } from './cert-download-page'

const logger = createLogger('mitm-proxy')

export class MitmProxyServer extends EventEmitter {
  private httpServer: http.Server | null = null
  private caManager: CaManager
  private interceptorChain: InterceptorChain
  private running = false
  private port: number | null = null

  // Upstream proxy
  private upstreamHost: string | null = null
  private upstreamPort: number | null = null
  private upstreamType: 'http' | 'socks5' | null = null

  constructor(caManager: CaManager, interceptorChain: InterceptorChain) {
    super()
    this.caManager = caManager
    this.interceptorChain = interceptorChain
  }

  setUpstreamProxy(type: 'http' | 'socks5', host: string, port: number): void {
    this.upstreamType = type
    this.upstreamHost = host
    this.upstreamPort = port
    logger.info('Upstream proxy configured', { type, host, port })
  }

  clearUpstreamProxy(): void {
    this.upstreamType = null
    this.upstreamHost = null
    this.upstreamPort = null
  }

  async start(port: number): Promise<void> {
    if (this.running) return

    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res)
    })

    // Handle CONNECT for HTTPS MITM
    this.httpServer.on('connect', (req, clientSocket, head) => {
      this.handleConnect(req, clientSocket, head)
    })

    // Serve cert download page
    const certHandler = createCertDownloadHandler(this.caManager)
    this.httpServer.on('request', certHandler)

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, '0.0.0.0', () => {
        this.running = true
        this.port = port
        logger.info('MITM proxy started', { port })
        resolve()
      })
      this.httpServer!.on('error', (err) => {
        logger.error('MITM proxy error', err)
        reject(err)
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return
    return new Promise((resolve) => {
      this.httpServer!.close(() => {
        this.running = false
        this.port = null
        this.httpServer = null
        logger.info('MITM proxy stopped')
        resolve()
      })
    })
  }

  isRunning(): boolean {
    return this.running
  }

  getPort(): number | null {
    return this.port
  }

  // --- HTTP Request Handler ---
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const startTime = Date.now()

    // Skip cert download page requests
    const host = req.headers.host || ''
    if (host.includes('cert.ai-analyzer') || req.url?.startsWith('/ssl')) {
      return // handled by cert download handler
    }

    const fullUrl = req.url?.startsWith('http') ? req.url : `http://${host}${req.url}`

    const ctx: ProxyContext = {
      requestId: uuid(),
      method: req.method || 'GET',
      url: fullUrl,
      requestHeaders: { ...req.headers as Record<string, string> },
      requestBody: null,
      hostname: '',
      port: 80,
      isTls: false,
      statusCode: null,
      responseHeaders: null,
      responseBody: null,
      shortCircuit: false,
      blocked: false,
      breakpoint: false
    }

    try {
      const urlObj = new URL(fullUrl)
      ctx.hostname = urlObj.hostname
      ctx.port = parseInt(urlObj.port) || 80
    } catch {
      // continue with default
    }

    // Collect request body
    const bodyChunks: Buffer[] = []
    req.on('data', (chunk) => bodyChunks.push(chunk))
    req.on('end', async () => {
      if (bodyChunks.length > 0) {
        ctx.requestBody = Buffer.concat(bodyChunks).toString('utf-8')
      }

      // Run interceptor chain onRequest
      try {
        await this.interceptorChain.runRequest(ctx)
      } catch (err) {
        logger.error('Interceptor chain onRequest error', err)
      }

      if (ctx.blocked) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Blocked by Ai-analyzer')
        return
      }

      if (ctx.shortCircuit && ctx.statusCode && ctx.responseHeaders) {
        res.writeHead(ctx.statusCode, ctx.responseHeaders)
        res.end(ctx.responseBody || '')
        this.emitCaptured(ctx, startTime, CaptureSource.PROXY)
        return
      }

      // Forward to upstream
      this.forwardRequest(ctx, res, startTime)
    })
  }

  private forwardRequest(ctx: ProxyContext, clientRes: http.ServerResponse, startTime: number): void {
    const urlObj = new URL(ctx.url)
    const options: https.RequestOptions = {
      hostname: ctx.hostname || urlObj.hostname,
      port: ctx.port || urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: ctx.method,
      headers: { ...ctx.requestHeaders }
    }

    // Remove proxy-specific headers
    delete options.headers!['proxy-connection']

    const requestModule = urlObj.protocol === 'https:' ? https : http
    const proxyReq = requestModule.request(options, (proxyRes) => {
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk) => chunks.push(chunk))
      proxyRes.on('end', async () => {
        const body = Buffer.concat(chunks)
        ctx.statusCode = proxyRes.statusCode || 200
        ctx.responseHeaders = proxyRes.headers as Record<string, string>
        ctx.responseBody = body.length <= 1024 * 1024 ? body.toString('utf-8') : null

        // Run interceptor chain onResponse
        try {
          await this.interceptorChain.runResponse(ctx)
        } catch (err) {
          logger.error('Interceptor chain onResponse error', err)
        }

        if (ctx.responseHeaders) {
          clientRes.writeHead(ctx.statusCode, ctx.responseHeaders)
        }
        clientRes.end(ctx.responseBody || body)

        this.emitCaptured(ctx, startTime, CaptureSource.PROXY)
      })
    })

    proxyReq.on('error', (err) => {
      logger.error('Forward request error', { url: ctx.url, error: err.message })
      clientRes.writeHead(502, { 'Content-Type': 'text/plain' })
      clientRes.end('Bad Gateway - Ai-analyzer')
    })

    if (ctx.requestBody) {
      proxyReq.write(ctx.requestBody)
    }
    proxyReq.end()
  }

  // --- HTTPS CONNECT Handler (MITM) ---
  private handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    const [hostname, portStr] = (req.url || '').split(':')
    const port = parseInt(portStr) || 443

    logger.debug('CONNECT request', { hostname, port })

    // Connect to real server
    const serverSocket = net.connect(port, hostname, () => {
      // Build TLS context with leaf cert
      let leafTls: tls.TlsOptions
      try {
        const leafContext = this.caManager.getLeafCertContext(hostname)
        leafTls = {
          key: leafContext.key,
          cert: Buffer.concat([leafContext.cert, leafContext.caCert]),
          isServer: true
        }
      } catch (err) {
        logger.error('Failed to generate leaf cert', { hostname, error: (err as Error).message })
        clientSocket.end()
        serverSocket.end()
        return
      }

      // Respond to client CONNECT
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

      // TLS handshake with client
      const tlsSocket = new tls.TLSSocket(clientSocket, {
        isServer: true,
        ...leafTls
      })

      // Create fake HTTP server to parse the decrypted traffic
      const fakeServer = http.createServer((req, res) => {
        this.handleTlsRequest(hostname, port, req, res, tlsSocket)
      })

      // Also handle CONNECT within TLS (rare but possible)
      fakeServer.on('connect', (_req, socket, _head) => {
        // Tunnel through
        tlsSocket.pipe(socket).pipe(tlsSocket)
      })

      fakeServer.listen(0, '127.0.0.1', () => {
        const fakePort = (fakeServer.address() as net.AddressInfo).port
        const fakeConn = net.connect(fakePort, '127.0.0.1', () => {
          tlsSocket.pipe(fakeConn).pipe(tlsSocket)
        })

        fakeConn.on('error', (err) => {
          logger.debug('Fake connection error', { error: err.message })
          tlsSocket.destroy()
          serverSocket.destroy()
          fakeServer.close()
        })

        tlsSocket.on('error', (err) => {
          logger.debug('TLS socket error', { hostname, error: err.message })
          fakeConn.destroy()
          serverSocket.destroy()
          fakeServer.close()
        })
      })

      // Cleanup
      tlsSocket.on('close', () => {
        fakeServer.close()
        serverSocket.end()
      })
    })

    serverSocket.on('error', (err) => {
      logger.error('Server connect error', { hostname, error: err.message })
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      clientSocket.end()
    })
  }

  private handleTlsRequest(hostname: string, port: number, req: http.IncomingMessage, res: http.ServerResponse, _tlsSocket: tls.TLSSocket): void {
    const startTime = Date.now()
    const fullUrl = `https://${hostname}${req.url}`

    const ctx: ProxyContext = {
      requestId: uuid(),
      method: req.method || 'GET',
      url: fullUrl,
      requestHeaders: { ...req.headers as Record<string, string> },
      requestBody: null,
      hostname,
      port,
      isTls: true,
      statusCode: null,
      responseHeaders: null,
      responseBody: null,
      shortCircuit: false,
      blocked: false,
      breakpoint: false
    }

    // Collect request body
    const bodyChunks: Buffer[] = []
    req.on('data', (chunk) => bodyChunks.push(chunk))
    req.on('end', async () => {
      if (bodyChunks.length > 0) {
        ctx.requestBody = Buffer.concat(bodyChunks).toString('utf-8')
      }

      // Run interceptor chain onRequest
      try {
        await this.interceptorChain.runRequest(ctx)
      } catch (err) {
        logger.error('Interceptor chain onRequest error (TLS)', err)
      }

      if (ctx.blocked) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Blocked by Ai-analyzer')
        return
      }

      if (ctx.shortCircuit && ctx.statusCode && ctx.responseHeaders) {
        res.writeHead(ctx.statusCode, ctx.responseHeaders)
        res.end(ctx.responseBody || '')
        this.emitCaptured(ctx, startTime, CaptureSource.PROXY)
        return
      }

      // Forward to real server via HTTPS
      this.forwardTlsRequest(ctx, res, startTime)
    })
  }

  private forwardTlsRequest(ctx: ProxyContext, clientRes: http.ServerResponse, startTime: number): void {
    const urlObj = new URL(ctx.url)
    const options: https.RequestOptions = {
      hostname: ctx.hostname || urlObj.hostname,
      port: ctx.port,
      path: urlObj.pathname + urlObj.search,
      method: ctx.method,
      headers: { ...ctx.requestHeaders },
      rejectUnauthorized: false // We trust our connections
    }

    delete options.headers!['proxy-connection']

    const proxyReq = https.request(options, (proxyRes) => {
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk) => chunks.push(chunk))
      proxyRes.on('end', async () => {
        const body = Buffer.concat(chunks)
        ctx.statusCode = proxyRes.statusCode || 200
        ctx.responseHeaders = proxyRes.headers as Record<string, string>
        ctx.responseBody = body.length <= 1024 * 1024 ? body.toString('utf-8') : null

        try {
          await this.interceptorChain.runResponse(ctx)
        } catch (err) {
          logger.error('Interceptor chain onResponse error (TLS)', err)
        }

        if (ctx.responseHeaders) {
          clientRes.writeHead(ctx.statusCode, ctx.responseHeaders)
        }
        clientRes.end(ctx.responseBody || body)

        this.emitCaptured(ctx, startTime, CaptureSource.PROXY)
      })
    })

    proxyReq.on('error', (err) => {
      logger.error('Forward TLS request error', { url: ctx.url, error: err.message })
      clientRes.writeHead(502, { 'Content-Type': 'text/plain' })
      clientRes.end('Bad Gateway - Ai-analyzer')
    })

    if (ctx.requestBody) {
      proxyReq.write(ctx.requestBody)
    }
    proxyReq.end()
  }

  private emitCaptured(ctx: ProxyContext, startTime: number, source: CaptureSource): void {
    const urlObj = new URL(ctx.url)
    const captured: Partial<CapturedRequest> = {
      id: ctx.requestId,
      source,
      method: ctx.method,
      url: ctx.url,
      hostname: ctx.hostname,
      path: urlObj.pathname + urlObj.search,
      statusCode: ctx.statusCode,
      contentType: ctx.responseHeaders?.['content-type'] || null,
      requestHeaders: ctx.requestHeaders,
      requestBody: ctx.requestBody,
      responseHeaders: ctx.responseHeaders,
      responseBody: ctx.responseBody,
      isStreaming: ctx.responseHeaders?.['content-type']?.includes('text/event-stream') || false,
      isWebsocket: ctx.requestHeaders?.upgrade?.toLowerCase() === 'websocket',
      timing: {
        dnsStart: startTime,
        dnsEnd: startTime,
        connectStart: startTime,
        connectEnd: startTime,
        tlsStart: startTime,
        tlsEnd: startTime,
        sendStart: startTime,
        sendEnd: startTime,
        receiveStart: Date.now(),
        receiveEnd: Date.now()
      },
      createdAt: startTime
    }

    this.emit('response-captured', captured)
  }
}
