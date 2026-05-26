// CDP Manager - Chrome DevTools Protocol interception
import { WebContents } from 'electron'
import { EventEmitter } from 'events'
import { CaptureSource, CapturedRequest, RequestTiming } from '@shared/types'
import { v4 as uuid } from 'uuid'
import { createLogger } from '../logger'

const logger = createLogger('cdp-manager')

export class CdpManager extends EventEmitter {
  private webContents: WebContents | null = null
  private attached = false
  private requestIdMap = new Map<string, string>()
  private requestStartTime = new Map<string, number>()

  async attach(webContents: WebContents): Promise<void> {
    if (this.attached) {
      await this.detach()
    }

    this.webContents = webContents

    try {
      await webContents.debugger.attach('1.3')
      this.attached = true
      logger.info('CDP attached')
    } catch (err) {
      logger.error('CDP attach failed', err)
      return
    }

    // Enable Fetch domain for request interception
    await webContents.debugger.sendCommand('Fetch.enable', {
      patterns: [
        { requestStage: 'Request' },
        { requestStage: 'Response' }
      ]
    })

    // Enable Network domain for timing
    await webContents.debugger.sendCommand('Network.enable')

    webContents.debugger.on('message', (_event: string, method: string, params: any) => {
      this.handleCdpEvent(method, params)
    })
  }

  async detach(): Promise<void> {
    if (this.webContents && this.attached) {
      try {
        await this.webContents.debugger.detach()
      } catch {}
      this.attached = false
      this.webContents = null
      logger.info('CDP detached')
    }
  }

  private async handleCdpEvent(method: string, params: any): Promise<void> {
    if (method === 'Fetch.requestPaused') {
      await this.handleRequestPaused(params)
    } else if (method === 'Network.requestWillBeSent') {
      this.handleRequestWillBeSent(params)
    } else if (method === 'Network.responseReceived') {
      this.handleResponseReceived(params)
    } else if (method === 'Network.loadingFinished') {
      await this.handleLoadingFinished(params)
    } else if (method === 'Network.webSocketCreated') {
      this.handleWebSocketCreated(params)
    }
  }

  private async handleRequestPaused(params: any): Promise<void> {
    const { requestId, request, resourceType, responseStatusCode, responseHeaders } = params

    // Store mapping from CDP requestId to our internal ID
    const internalId = uuid()
    this.requestIdMap.set(requestId, internalId)
    this.requestStartTime.set(internalId, Date.now())

    // If the request has a response (response stage), capture it
    if (responseStatusCode !== undefined) {
      let responseBody: string | null = null
      try {
        const bodyResult = await this.webContents!.debugger.sendCommand('Fetch.getResponseBody', { requestId })
        responseBody = bodyResult.base64Encoded
          ? Buffer.from(bodyResult.body, 'base64').toString('utf-8')
          : bodyResult.body
      } catch {}

      const requestHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.headers)) {
        requestHeaders[key.toLowerCase()] = String(value)
      }

      const respHeaders: Record<string, string> = {}
      if (responseHeaders) {
        for (const h of responseHeaders) {
          respHeaders[h.name.toLowerCase()] = h.value
        }
      }

      const urlObj = new URL(request.url)
      const captured: Partial<CapturedRequest> = {
        id: internalId,
        source: CaptureSource.CDP,
        method: request.method,
        url: request.url,
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        statusCode: responseStatusCode,
        contentType: respHeaders['content-type'] || null,
        requestHeaders,
        requestBody: request.postData || null,
        responseHeaders: respHeaders,
        responseBody: responseBody,
        isStreaming: (respHeaders['content-type'] || '').includes('text/event-stream'),
        isWebsocket: resourceType === 'WebSocket',
        tabId: this.webContents?.id?.toString() || null,
        createdAt: Date.now()
      }

      this.emit('response-captured', captured)
    }

    // Continue the request
    try {
      await this.webContents!.debugger.sendCommand('Fetch.continueRequest', { requestId })
    } catch {}
  }

  private handleRequestWillBeSent(params: any): void {
    const { requestId, request, timestamp } = params
    if (!this.requestIdMap.has(requestId)) {
      const internalId = uuid()
      this.requestIdMap.set(requestId, internalId)
      this.requestStartTime.set(internalId, timestamp * 1000)
    }
  }

  private handleResponseReceived(params: any): void {
    // Tracking for timing - response headers received
  }

  private async handleLoadingFinished(params: any): Promise<void> {
    const { requestId, timestamp } = params
    const internalId = this.requestIdMap.get(requestId)
    if (!internalId) return

    const startTime = this.requestStartTime.get(internalId) || Date.now()
    const timing: RequestTiming = {
      dnsStart: startTime,
      dnsEnd: startTime,
      connectStart: startTime,
      connectEnd: startTime,
      tlsStart: startTime,
      tlsEnd: startTime,
      sendStart: startTime,
      sendEnd: startTime,
      receiveStart: startTime,
      receiveEnd: timestamp ? timestamp * 1000 : Date.now()
    }

    this.requestIdMap.delete(requestId)
    this.requestStartTime.delete(internalId)
  }

  private handleWebSocketCreated(params: any): void {
    logger.debug('WebSocket created', { url: params.request.url })
  }

  isAttached(): boolean {
    return this.attached
  }
}
