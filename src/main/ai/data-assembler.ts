// ============================================================================
// Data Assembler - Reads from SQLite repositories, associates hooks with
// requests, calculates storage diffs, extracts auth chains, masks credentials,
// runs scene detection and crypto extraction, and enforces token budgets.
// ============================================================================

import {
  CapturedRequest,
  JsHookRecord,
  StorageSnapshot,
  StorageDiff,
  DiffResult,
  StorageEntry,
  SceneHint,
  AnalysisMode
} from '@shared/types'
import { RequestRepo, HookRepo, StorageSnapshotRepo } from '../db/repositories'
import { detect } from './scene-detector'
import { extract as extractCrypto, CryptoExtractionResult, CryptoSnippet } from './crypto-script-extractor'
import { createLogger } from '../logger'

const logger = createLogger('data-assembler')

// --- Types ---

export interface AuthChainStep {
  /** Request seq where token was issued */
  issuedAt: number
  /** Request seq where token was consumed */
  consumedAt: number
  /** Token type (Bearer, JWT, session, etc.) */
  tokenType: string
  /** Masked token value */
  tokenPreview: string
  /** Header or parameter name carrying the token */
  carrier: string
}

export interface StreamingRequestInfo {
  seq: number
  method: string
  url: string
  contentType: string | null
  isSSE: boolean
  isChunked: boolean
}

export interface RequestLogEntry {
  seq: number
  method: string
  url: string
  hostname: string
  path: string
  statusCode: number | null
  contentType: string | null
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseHeaders: Record<string, string> | null
  responseBody: string | null
  isStreaming: boolean
  isWebsocket: boolean
  timing: {
    dns: number
    connect: number
    tls: number
    wait: number
    receive: number
    total: number
  } | null
  createdAt: number
  /** Associated JS hooks (nearest within 2s window) */
  associatedHooks: JsHookRecord[]
}

export interface StorageChangeSet {
  diff: StorageDiff
  firstTimestamp: number
  lastTimestamp: number
}

export interface AssembledData {
  /** Filtered requests (static GETs removed) */
  requests: RequestLogEntry[]
  /** Scene hints from detection */
  sceneHints: SceneHint[]
  /** Auth chain steps (token issuance -> consumption) */
  authChains: AuthChainStep[]
  /** Streaming request info */
  streamingRequests: StreamingRequestInfo[]
  /** Crypto hook operations */
  cryptoHooks: JsHookRecord[]
  /** Extracted code snippets */
  cryptoSnippets: CryptoSnippet[]
  /** Storage changes between first and last snapshot */
  storageChanges: StorageChangeSet | null
  /** Total byte size of assembled data (for budget tracking) */
  totalBytes: number
}

// --- Constants ---

const TOKEN_BUDGET = 30000 // ~30K tokens
const BYTES_PER_TOKEN = 4 // Approximate: 1 token ~ 4 bytes
const BYTE_BUDGET = TOKEN_BUDGET * BYTES_PER_TOKEN // ~120KB
const HOOK_ASSOCIATION_WINDOW_MS = 2000 // 2 seconds
const STATIC_EXTENSIONS = /\.(css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|webp|mp4|webm|ogg|mp3|wav|flac|avi|mov|zip|tar|gz|rar|7z|pdf|doc|docx|xls|xlsx|ppt|pptx)$/i

// --- Main Assembly Function ---

/**
 * Assemble all captured data for a session by reading from SQLite repositories,
 * applying filters and transformations, running scene detection and crypto extraction.
 *
 * @param sessionId - The session ID to assemble data for
 * @param mode - The analysis mode (affects filtering strictness)
 * @returns Assembled data object ready for prompt building
 */
export function assembleData(
  sessionId: string,
  mode: AnalysisMode
): AssembledData {
  logger.info('Assembling data for session', { sessionId, mode })

  const requestRepo = new RequestRepo()
  const hookRepo = new HookRepo()
  const snapshotRepo = new StorageSnapshotRepo()

  // 1. Load raw data from repositories
  const rawRequests = requestRepo.listBySession(sessionId, 0, 2000)
  const rawHooks = hookRepo.listBySession(sessionId)
  const snapshots = snapshotRepo.listBySession(sessionId)

  logger.info('Loaded raw data', {
    requests: rawRequests.length,
    hooks: rawHooks.length,
    snapshots: snapshots.length
  })

  // 2. Filter static GET requests
  const filteredRequests = filterStaticRequests(rawRequests, mode)

  logger.info('After static filtering', {
    remaining: filteredRequests.length,
    removed: rawRequests.length - filteredRequests.length
  })

  // 3. Associate JS hooks with requests by timestamp proximity
  const hooksByRequest = associateHooksWithRequests(filteredRequests, rawHooks)

  // 4. Build request log entries with full details
  const requestLog = buildRequestLog(filteredRequests, hooksByRequest)

  // 5. Calculate storage diffs between first and last snapshots
  const storageChanges = computeStorageDiff(snapshots)

  // 6. Extract auth chains (token issuance -> consumption)
  const authChains = extractAuthChains(filteredRequests, rawHooks)

  // 7. Detect streaming requests
  const streamingRequests = detectStreamingRequests(filteredRequests)

  // 8. Separate crypto hooks
  const cryptoHooks = rawHooks.filter(h =>
    h.hookType === 'crypto_subtle' as string ||
    h.hookType === 'cryptojs' as string ||
    h.hookType === 'sm2' as string ||
    h.hookType === 'sm3' as string ||
    h.hookType === 'sm4' as string
  )

  // 9. Run scene detection
  const sceneHints = detect(filteredRequests, rawHooks)

  // 10. Run crypto script extraction
  const hookStacks = rawHooks.map(h => h.callStack).filter(Boolean)
  const cryptoResult: CryptoExtractionResult = extractCrypto(filteredRequests, hookStacks)

  // 11. Mask credentials in request/response bodies and headers
  maskCredentials(requestLog)

  // 12. Calculate total bytes and enforce budget
  let totalBytes = calculateTotalBytes(requestLog, sceneHints, authChains, streamingRequests, cryptoHooks, cryptoResult.snippets, storageChanges)

  if (totalBytes > BYTE_BUDGET) {
    logger.info('Over budget, applying trimming', {
      totalBytes,
      budget: BYTE_BUDGET,
      ratio: totalBytes / BYTE_BUDGET
    })
    trimToBudget(requestLog, cryptoResult.snippets, totalBytes, BYTE_BUDGET)
    totalBytes = calculateTotalBytes(requestLog, sceneHints, authChains, streamingRequests, cryptoHooks, cryptoResult.snippets, storageChanges)
  }

  logger.info('Data assembly complete', {
    requestCount: requestLog.length,
    sceneHints: sceneHints.length,
    authChains: authChains.length,
    streamingRequests: streamingRequests.length,
    cryptoHooks: cryptoHooks.length,
    cryptoSnippets: cryptoResult.snippets.length,
    totalBytes
  })

  return {
    requests: requestLog,
    sceneHints,
    authChains,
    streamingRequests,
    cryptoHooks,
    cryptoSnippets: cryptoResult.snippets,
    storageChanges,
    totalBytes
  }
}

// --- Filter Static Requests ---

function filterStaticRequests(requests: CapturedRequest[], mode: AnalysisMode): CapturedRequest[] {
  return requests.filter(req => {
    // Always keep non-GET requests
    if (req.method !== 'GET') return true

    // Skip requests with static file extensions
    if (STATIC_EXTENSIONS.test(req.path)) return false

    // Skip requests with image/audio/video content types
    const ct = (req.contentType || '').toLowerCase()
    if (/^image\/|^audio\/|^video\/|^font\//i.test(ct)) return false

    // In crypto mode, keep JS files (they may contain crypto code)
    if (mode === AnalysisMode.CRYPTO) {
      if (/javascript/i.test(ct) || /\.js(\?|$)/i.test(req.path)) return true
    }

    // Skip stylesheet content types
    if (/^text\/css/i.test(ct)) return false

    // Keep everything else (including JSON API calls, HTML, etc.)
    return true
  })
}

// --- Associate Hooks with Requests ---

function associateHooksWithRequests(
  requests: CapturedRequest[],
  hooks: JsHookRecord[]
): Map<number, JsHookRecord[]> {
  const result = new Map<number, JsHookRecord[]>()

  // Pre-index requests by timestamp for faster lookup
  const requestTimestamps = requests.map(r => ({ seq: r.seq, createdAt: r.createdAt }))

  for (const hook of hooks) {
    // Find the nearest request within the association window
    let bestSeq = -1
    let bestDelta = Infinity

    for (const { seq, createdAt } of requestTimestamps) {
      const delta = Math.abs(hook.timestamp - createdAt)
      if (delta <= HOOK_ASSOCIATION_WINDOW_MS && delta < bestDelta) {
        bestDelta = delta
        bestSeq = seq
      }
    }

    if (bestSeq >= 0) {
      const existing = result.get(bestSeq) || []
      existing.push(hook)
      result.set(bestSeq, existing)
    }
  }

  logger.debug('Hook association complete', {
    associatedHooks: [...result.values()].reduce((s, h) => s + h.length, 0),
    unassociatedHooks: hooks.length - [...result.values()].reduce((s, h) => s + h.length, 0)
  })

  return result
}

// --- Build Request Log ---

function buildRequestLog(
  requests: CapturedRequest[],
  hooksByRequest: Map<number, JsHookRecord[]>
): RequestLogEntry[] {
  return requests.map(req => {
    const timing = req.timing ? {
      dns: req.timing.dnsEnd - req.timing.dnsStart,
      connect: req.timing.connectEnd - req.timing.connectStart,
      tls: req.timing.tlsEnd - req.timing.tlsStart,
      wait: req.timing.receiveStart - req.timing.sendEnd,
      receive: req.timing.receiveEnd - req.timing.receiveStart,
      total: req.timing.receiveEnd - req.timing.dnsStart
    } : null

    return {
      seq: req.seq,
      method: req.method,
      url: req.url,
      hostname: req.hostname,
      path: req.path,
      statusCode: req.statusCode,
      contentType: req.contentType,
      requestHeaders: { ...req.requestHeaders },
      requestBody: req.requestBody,
      responseHeaders: req.responseHeaders ? { ...req.responseHeaders } : null,
      responseBody: req.responseBody,
      isStreaming: req.isStreaming,
      isWebsocket: req.isWebsocket,
      timing,
      createdAt: req.createdAt,
      associatedHooks: hooksByRequest.get(req.seq) || []
    }
  })
}

// --- Compute Storage Diff ---

function computeStorageDiff(snapshots: StorageSnapshot[]): StorageChangeSet | null {
  if (snapshots.length < 2) {
    logger.debug('Not enough snapshots for diff', { count: snapshots.length })
    return null
  }

  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]

  const diff: StorageDiff = {
    cookies: computeEntryDiff(first.cookies, last.cookies),
    localStorage: computeEntryDiff(first.localStorage, last.localStorage),
    sessionStorage: computeEntryDiff(first.sessionStorage, last.sessionStorage)
  }

  return {
    diff,
    firstTimestamp: first.timestamp,
    lastTimestamp: last.timestamp
  }
}

function computeEntryDiff(oldEntries: StorageEntry[], newEntries: StorageEntry[]): DiffResult {
  const oldMap = new Map(oldEntries.map(e => [e.key, e]))
  const newMap = new Map(newEntries.map(e => [e.key, e]))

  const added: StorageEntry[] = []
  const changed: StorageEntry[] = []
  const removed: string[] = []

  // Find added and changed
  for (const [key, entry] of newMap) {
    const oldEntry = oldMap.get(key)
    if (!oldEntry) {
      added.push(entry)
    } else if (oldEntry.value !== entry.value) {
      changed.push(entry)
    }
  }

  // Find removed
  for (const [key] of oldMap) {
    if (!newMap.has(key)) {
      removed.push(key)
    }
  }

  return { added, changed, removed }
}

// --- Extract Auth Chains ---

function extractAuthChains(requests: CapturedRequest[], _hooks: JsHookRecord[]): AuthChainStep[] {
  const chains: AuthChainStep[] = []

  // Track tokens found in responses (issuance) and then in subsequent requests (consumption)
  interface TokenSighting {
    seq: number
    tokenType: string
    tokenPreview: string
    carrier: string
    rawToken: string
  }

  const issuedTokens: TokenSighting[] = []

  // Phase 1: Find token issuances in responses
  for (const req of requests) {
    if (!req.responseBody) continue

    try {
      const body = JSON.parse(req.responseBody)
      const tokenFields = ['access_token', 'token', 'id_token', 'refresh_token', 'session_id', 'sessionId', 'auth_token', 'jwt']

      for (const field of tokenFields) {
        if (body[field] && typeof body[field] === 'string') {
          issuedTokens.push({
            seq: req.seq,
            tokenType: field.includes('jwt') ? 'JWT' : field.includes('refresh') ? 'RefreshToken' : field.includes('session') ? 'SessionToken' : 'BearerToken',
            tokenPreview: maskTokenValue(body[field]),
            carrier: `response.${field}`,
            rawToken: body[field]
          })
        }
      }
    } catch {
      // Not JSON, check Set-Cookie for tokens
      const setCookie = req.responseHeaders?.['set-cookie'] || req.responseHeaders?.['Set-Cookie']
      if (setCookie) {
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
        for (const cookie of cookies) {
          const match = cookie.match(/^([^=]+)=([^;]+)/)
          if (match) {
            const [, name, value] = match
            if (/token|session|auth/i.test(name) && value.length > 10) {
              issuedTokens.push({
                seq: req.seq,
                tokenType: 'CookieToken',
                tokenPreview: maskTokenValue(value),
                carrier: `Set-Cookie.${name}`,
                rawToken: value
              })
            }
          }
        }
      }
    }
  }

  // Phase 2: Find token consumptions in subsequent requests
  for (const issued of issuedTokens) {
    for (const req of requests) {
      if (req.seq <= issued.seq) continue // Only look at subsequent requests

      // Check Authorization header
      const authHeader = req.requestHeaders['authorization'] || req.requestHeaders['Authorization']
      if (authHeader && authHeader.includes(issued.rawToken.substring(0, Math.min(20, issued.rawToken.length)))) {
        chains.push({
          issuedAt: issued.seq,
          consumedAt: req.seq,
          tokenType: issued.tokenType,
          tokenPreview: issued.tokenPreview,
          carrier: 'Authorization header'
        })
        break // Only record first consumption
      }

      // Check Cookie header
      const cookieHeader = req.requestHeaders['cookie'] || req.requestHeaders['Cookie']
      if (cookieHeader && cookieHeader.includes(issued.rawToken.substring(0, Math.min(20, issued.rawToken.length)))) {
        chains.push({
          issuedAt: issued.seq,
          consumedAt: req.seq,
          tokenType: issued.tokenType,
          tokenPreview: issued.tokenPreview,
          carrier: 'Cookie header'
        })
        break
      }

      // Check custom auth headers
      for (const [headerName, headerValue] of Object.entries(req.requestHeaders)) {
        if (/^x-.*token|^x-.*auth|^x-.*key/i.test(headerName) &&
            typeof headerValue === 'string' &&
            headerValue.includes(issued.rawToken.substring(0, Math.min(20, issued.rawToken.length)))) {
          chains.push({
            issuedAt: issued.seq,
            consumedAt: req.seq,
            tokenType: issued.tokenType,
            tokenPreview: issued.tokenPreview,
            carrier: headerName
          })
          break
        }
      }
    }
  }

  return chains
}

// --- Detect Streaming Requests ---

function detectStreamingRequests(requests: CapturedRequest[]): StreamingRequestInfo[] {
  const result: StreamingRequestInfo[] = []

  for (const req of requests) {
    if (!req.isStreaming && !isStreamingByHeaders(req)) continue

    const isSSE = /text\/event-stream/i.test(req.contentType || '') ||
                  /text\/event-stream/i.test(req.responseHeaders?.['content-type'] || '')
    const isChunked = /chunked/i.test(req.responseHeaders?.['transfer-encoding'] || '')

    result.push({
      seq: req.seq,
      method: req.method,
      url: req.url,
      contentType: req.contentType,
      isSSE,
      isChunked
    })
  }

  return result
}

function isStreamingByHeaders(req: CapturedRequest): boolean {
  const te = req.responseHeaders?.['transfer-encoding'] || ''
  if (/chunked/i.test(te)) return true

  const ct = req.contentType || req.responseHeaders?.['content-type'] || ''
  if (/text\/event-stream|multipart\/x-mixed-replace/i.test(ct)) return true

  // SSE endpoints typically use GET with Accept: text/event-stream
  const accept = req.requestHeaders['accept'] || req.requestHeaders['Accept'] || ''
  if (/text\/event-stream/i.test(accept)) return true

  return false
}

// --- Mask Credentials ---

function maskCredentials(requestLog: RequestLogEntry[]): void {
  for (const entry of requestLog) {
    // Mask Authorization header
    if (entry.requestHeaders['authorization'] || entry.requestHeaders['Authorization']) {
      const key = entry.requestHeaders['Authorization'] ? 'Authorization' : 'authorization'
      entry.requestHeaders[key] = maskAuthHeader(entry.requestHeaders[key])
    }

    // Mask sensitive headers
    const sensitiveHeaders = ['x-api-key', 'api-key', 'apikey', 'x-auth-token', 'x-access-token', 'x-secret']
    for (const header of sensitiveHeaders) {
      if (entry.requestHeaders[header]) {
        entry.requestHeaders[header] = '***masked***'
      }
      // Also check Title-Case variants
      const titleCase = header.replace(/(^|-)\w/g, m => m.toUpperCase())
      if (entry.requestHeaders[titleCase]) {
        entry.requestHeaders[titleCase] = '***masked***'
      }
    }

    // Mask passwords in request body
    if (entry.requestBody) {
      entry.requestBody = maskPasswordFields(entry.requestBody)
    }

    // Mask tokens/sensitive values in response body
    if (entry.responseBody) {
      entry.responseBody = maskSensitiveResponseFields(entry.responseBody)
    }

    // Mask cookies
    const cookieHeader = entry.requestHeaders['cookie'] || entry.requestHeaders['Cookie']
    if (cookieHeader) {
      const key = entry.requestHeaders['Cookie'] ? 'Cookie' : 'cookie'
      entry.requestHeaders[key] = maskCookieValues(cookieHeader)
    }
  }
}

function maskAuthHeader(value: string): string {
  if (/^Bearer\s+/i.test(value)) {
    const token = value.replace(/^Bearer\s+/i, '')
    return `Bearer ${maskTokenValue(token)}`
  }
  if (/^Basic\s+/i.test(value)) {
    return 'Basic ***masked***'
  }
  return maskTokenValue(value)
}

function maskTokenValue(token: string): string {
  if (token.length <= 12) return '***'
  const start = token.substring(0, 6)
  const end = token.substring(token.length - 4)
  return `${start}***${end}`
}

function maskPasswordFields(body: string): string {
  // JSON body
  try {
    const obj = JSON.parse(body)
    let modified = false
    for (const key of Object.keys(obj)) {
      if (/password|passwd|pwd|secret|private_key/i.test(key) && typeof obj[key] === 'string') {
        obj[key] = '***masked***'
        modified = true
      }
    }
    if (modified) return JSON.stringify(obj)
  } catch {
    // Not JSON - try form-encoded
  }

  // Form-encoded body
  return body.replace(/(^|&)(password|passwd|pwd|secret|private_key)=([^&]*)/gi,
    '$1$2=***masked***')
}

function maskSensitiveResponseFields(body: string): string {
  try {
    const obj = JSON.parse(body)
    let modified = false
    const sensitiveKeys = ['access_token', 'refresh_token', 'id_token', 'secret', 'private_key', 'api_key', 'apiKey']
    for (const key of sensitiveKeys) {
      if (obj[key] && typeof obj[key] === 'string') {
        obj[key] = maskTokenValue(obj[key])
        modified = true
      }
    }
    if (modified) return JSON.stringify(obj)
  } catch {
    // Not JSON
  }
  return body
}

function maskCookieValues(cookieHeader: string): string {
  return cookieHeader.replace(/((?:session|token|auth|sid)[^=]*)=([^;]+)/gi,
    '$1=***masked***')
}

// --- Budget Calculation and Trimming ---

function calculateTotalBytes(
  requests: RequestLogEntry[],
  sceneHints: SceneHint[],
  authChains: AuthChainStep[],
  streamingRequests: StreamingRequestInfo[],
  cryptoHooks: JsHookRecord[],
  cryptoSnippets: CryptoSnippet[],
  storageChanges: StorageChangeSet | null
): number {
  let total = 0

  // Requests (this is the bulk)
  for (const req of requests) {
    total += req.requestBody?.length || 0
    total += req.responseBody?.length || 0
    total += JSON.stringify(req.requestHeaders).length
    total += req.responseHeaders ? JSON.stringify(req.responseHeaders).length : 0
    total += 200 // overhead per entry
  }

  // Scene hints are small
  total += JSON.stringify(sceneHints).length

  // Auth chains
  total += JSON.stringify(authChains).length

  // Streaming requests
  total += JSON.stringify(streamingRequests).length

  // Crypto hooks
  total += JSON.stringify(cryptoHooks).length

  // Crypto snippets
  for (const snippet of cryptoSnippets) {
    total += snippet.code.length
  }

  // Storage changes
  total += storageChanges ? JSON.stringify(storageChanges).length : 0

  return total
}

function trimToBudget(
  requests: RequestLogEntry[],
  cryptoSnippets: CryptoSnippet[],
  currentBytes: number,
  budgetBytes: number
): void {
  const excess = currentBytes - budgetBytes
  if (excess <= 0) return

  // Strategy 1: Truncate large response bodies (most impactful)
  // Sort requests by response body size descending
  const sortedByResponseBody = [...requests]
    .map((r, i) => ({ idx: i, bodyLen: r.responseBody?.length || 0 }))
    .filter(r => r.bodyLen > 500)
    .sort((a, b) => b.bodyLen - a.bodyLen)

  let freed = 0
  for (const { idx, bodyLen } of sortedByResponseBody) {
    if (freed >= excess) break
    const req = requests[idx]
    if (!req.responseBody) continue

    const maxLen = 500
    const save = bodyLen - maxLen
    req.responseBody = req.responseBody.substring(0, maxLen) + '\n// ... [truncated]'
    freed += save
  }

  // Strategy 2: Truncate large request bodies
  if (freed < excess) {
    const sortedByRequestBody = [...requests]
      .map((r, i) => ({ idx: i, bodyLen: r.requestBody?.length || 0 }))
      .filter(r => r.bodyLen > 500)
      .sort((a, b) => b.bodyLen - a.bodyLen)

    for (const { idx, bodyLen } of sortedByRequestBody) {
      if (freed >= excess) break
      const req = requests[idx]
      if (!req.requestBody) continue

      const maxLen = 500
      const save = bodyLen - maxLen
      req.requestBody = req.requestBody.substring(0, maxLen) + '\n// ... [truncated]'
      freed += save
    }
  }

  // Strategy 3: Truncate crypto snippets (remove Tier 3 first)
  if (freed < excess) {
    for (let i = cryptoSnippets.length - 1; i >= 0; i--) {
      if (freed >= excess) break
      // Remove lowest-tier snippets first
      if (cryptoSnippets[i].tier === 3) {
        freed += cryptoSnippets[i].code.length
        cryptoSnippets.splice(i, 1)
      }
    }
  }

  // Strategy 4: Drop secondary request info but keep seq/method/url/status
  if (freed < excess) {
    for (const req of requests) {
      if (freed >= excess) break
      const headersSize = JSON.stringify(req.requestHeaders).length +
                          (req.responseHeaders ? JSON.stringify(req.responseHeaders).length : 0)
      if (headersSize > 200) {
        // Collapse to essential headers only
        req.requestHeaders = extractEssentialHeaders(req.requestHeaders)
        req.responseHeaders = req.responseHeaders ? extractEssentialHeaders(req.responseHeaders) : null
        freed += headersSize - 200
      }
    }
  }

  logger.info('Budget trimming applied', { freed, target: excess })
}

function extractEssentialHeaders(headers: Record<string, string>): Record<string, string> {
  const essential = ['content-type', 'authorization', 'cookie', 'set-cookie', 'accept',
    'x-api-key', 'x-auth-token', 'x-requested-with', 'origin', 'referer']
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const keyLower = key.toLowerCase()
    if (essential.some(e => keyLower.includes(e.toLowerCase()))) {
      result[key] = value
    }
  }
  return result
}
