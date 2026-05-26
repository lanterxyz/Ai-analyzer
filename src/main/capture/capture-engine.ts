// Capture Engine - Unified CDP + Proxy event sink
import { EventEmitter } from 'events'
import { WebContents } from 'electron'
import { CaptureSource, CapturedRequest, JsHookRecord, StorageSnapshot, CaptureState } from '@shared/types'
import { SessionRepo, RequestRepo, HookRepo, StorageSnapshotRepo } from '../db/repositories'
import { v4 as uuid } from 'uuid'
import { createLogger } from '../logger'

const logger = createLogger('capture-engine')

export class CaptureEngine extends EventEmitter {
  private sessionId: string | null = null
  private seq = 0
  private state: CaptureState = CaptureState.IDLE
  private requestRepo: RequestRepo
  private hookRepo: HookRepo
  private snapshotRepo: StorageSnapshotRepo

  constructor() {
    super()
    this.requestRepo = new RequestRepo()
    this.hookRepo = new HookRepo()
    this.snapshotRepo = new StorageSnapshotRepo()
  }

  start(sessionId: string): void {
    this.sessionId = sessionId
    this.seq = 0
    this.state = CaptureState.CAPTURING
    logger.info('Capture engine started', { sessionId })
  }

  stop(): void {
    this.state = CaptureState.STOPPED
    this.sessionId = null
    logger.info('Capture engine stopped')
  }

  pause(): void {
    this.state = CaptureState.PAUSED
  }

  resume(): void {
    this.state = CaptureState.CAPTURING
  }

  getState(): CaptureState {
    return this.state
  }

  isCapturing(): boolean {
    return this.state === CaptureState.CAPTURING
  }

  handleResponseCaptured(data: Partial<CapturedRequest> & { source: CaptureSource }): void {
    if (!this.isCapturing() || !this.sessionId) return

    this.seq++
    const now = Date.now()

    const request: CapturedRequest = {
      id: data.id || uuid(),
      sessionId: this.sessionId,
      seq: this.seq,
      source: data.source,
      method: data.method || 'GET',
      url: data.url || '',
      hostname: data.hostname || '',
      path: data.path || '',
      statusCode: data.statusCode ?? null,
      contentType: data.contentType || null,
      requestHeaders: data.requestHeaders || {},
      requestBody: data.requestBody || null,
      responseHeaders: data.responseHeaders || null,
      responseBody: data.responseBody || null,
      responseEncoding: data.responseEncoding || null,
      isStreaming: data.isStreaming || false,
      isWebsocket: data.isWebsocket || false,
      timing: data.timing || null,
      tabId: data.tabId || null,
      createdAt: data.createdAt || now
    }

    try {
      this.requestRepo.insert(request)
    } catch (err) {
      logger.error('Failed to persist captured request', err)
      return
    }

    this.emit('request-captured', request)

    // Notify renderer
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('request:captured', {
        id: request.id,
        seq: request.seq,
        method: request.method,
        url: request.url,
        hostname: request.hostname,
        statusCode: request.statusCode,
        contentType: request.contentType,
        source: request.source,
        isStreaming: request.isStreaming,
        isWebsocket: request.isWebsocket,
        createdAt: request.createdAt
      })
    }
  }

  handleHookCaptured(data: Omit<JsHookRecord, 'id'>): void {
    if (!this.isCapturing() || !this.sessionId) return

    const hook: JsHookRecord = {
      id: uuid(),
      ...data
    }

    try {
      this.hookRepo.insert(hook)
    } catch (err) {
      logger.error('Failed to persist hook record', err)
      return
    }

    this.emit('hook-captured', hook)

    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('hook:captured', {
        id: hook.id,
        hookType: hook.hookType,
        functionName: hook.functionName,
        timestamp: hook.timestamp
      })
    }
  }

  handleStorageCollected(data: Omit<StorageSnapshot, 'id'>): void {
    if (!this.sessionId) return

    const snapshot: StorageSnapshot = {
      id: uuid(),
      ...data
    }

    try {
      this.snapshotRepo.insert(snapshot)
    } catch (err) {
      logger.error('Failed to persist storage snapshot', err)
      return
    }

    this.emit('storage-captured', snapshot)
  }
}
