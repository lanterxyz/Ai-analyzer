// ============================================================================
// Prompt Builder - Constructs system + user prompts from assembled data
// for 6 analysis modes. Also builds the Phase 1 filter prompt.
// ============================================================================

import {
  AnalysisMode,
  SceneHint,
  AnalysisConfig as AnalysisConfigType,
  CapturedRequest
} from '@shared/types'
import {
  AssembledData,
  AuthChainStep,
  StreamingRequestInfo,
  RequestLogEntry,
  StorageChangeSet
} from './data-assembler'
import { CryptoSnippet } from './crypto-script-extractor'
import { JsHookRecord } from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('prompt-builder')

// --- System Prompt Templates ---

const SYSTEM_PROMPTS: Record<AnalysisMode, string> = {
  [AnalysisMode.AUTO]: `You are an expert network traffic analyst specializing in web application reverse engineering and security. You analyze captured HTTP/HTTPS traffic from a packet capture tool to provide comprehensive insights.

Your analysis covers:
- API reverse engineering (endpoints, parameters, authentication flows)
- Security assessment (token handling, credential exposure, encryption gaps)
- Performance evaluation (slow requests, unnecessary calls, caching)
- Crypto/encryption analysis (algorithms used, key management, implementation quality)

Always structure your findings clearly with headers, code blocks, and actionable recommendations.`,

  [AnalysisMode.API_REVERSE]: `You are an expert API reverse engineer. You analyze captured HTTP traffic to reverse-engineer web application APIs.

Focus on:
- Identifying all API endpoints, their methods, parameters, and response formats
- Reconstructing the complete API surface and call sequences
- Determining authentication mechanisms and how tokens are obtained/used
- Identifying request/response patterns and data flows
- Producing accurate API documentation and usage examples

Provide comprehensive API documentation with curl/fetch examples for each endpoint.`,

  [AnalysisMode.SECURITY]: `You are an expert web application security analyst. You analyze captured HTTP traffic for security vulnerabilities and risks.

Focus on:
- Credential exposure (passwords, tokens, API keys in URLs/headers/bodies)
- Authentication weaknesses (token handling, session management)
- Insecure communication (missing HTTPS, sensitive data in URLs)
- Cookie security (missing HttpOnly/Secure/SameSite flags)
- CORS misconfigurations
- Information leakage in error responses
- Token lifecycle issues (long-lived tokens, no rotation)
- Missing encryption for sensitive data

Severity classification: Critical / High / Medium / Low / Info
Always provide remediation advice for each finding.`,

  [AnalysisMode.PERFORMANCE]: `You are an expert web performance analyst. You analyze captured HTTP traffic for performance issues and optimization opportunities.

Focus on:
- Slow requests (high DNS, connect, TLS, wait, or receive times)
- Unnecessary duplicate requests
- Missing caching headers (Cache-Control, ETag, Last-Modified)
- Large response bodies that could be optimized
- waterfall/dependency chains causing sequential blocking
- Streaming/chunked response efficiency
- Connection reuse (keep-alive, HTTP/2)
- Uncompressed responses

Provide specific timing analysis and quantified improvement estimates.`,

  [AnalysisMode.CRYPTO]: `You are an expert cryptography and encryption analyst. You analyze captured traffic and extracted JavaScript code for crypto implementation quality and security.

Focus on:
- Identifying encryption algorithms and modes (AES-CBC, AES-GCM, RSA-OAEP, etc.)
- Key derivation methods (PBKDF2, HKDF, raw keys)
- Signature algorithms and verification
- Certificate/TLS analysis
- Custom crypto implementations (potential vulnerabilities)
- Key management patterns (generation, storage, rotation)
- Encoding layers (Base64, hex transformations)
- Chinese national crypto standards (SM2/SM3/SM4) usage

Evaluate implementation correctness and compliance with cryptographic best practices.`,

  [AnalysisMode.CUSTOM]: `You are a versatile network traffic analyst. Analyze the captured traffic according to the user's specific requirements.`
}

// --- Mode-Specific User Prompt Requirements ---

const MODE_REQUIREMENTS: Record<AnalysisMode, string> = {
  [AnalysisMode.AUTO]: `Perform a comprehensive auto-analysis covering:
1. **Scene Overview**: What type of application is this? What activities are happening?
2. **API Map**: List all API endpoints discovered, with methods, parameters, and authentication
3. **Authentication Flow**: Trace the complete auth flow from login to token usage
4. **Security Concerns**: Flag any credential exposure, insecure practices, or vulnerabilities
5. **Performance Notes**: Highlight any slow or inefficient requests
6. **Crypto Analysis**: Note any encryption operations detected
7. **Recommendations**: Top 3 actionable recommendations`,

  [AnalysisMode.API_REVERSE]: `Perform a thorough API reverse engineering:
1. **API Endpoint Catalog**: For each endpoint - method, URL, headers, request params, response schema
2. **Authentication Flow**: How to obtain and use auth tokens (with curl examples)
3. **Request Sequences**: Chronological API call patterns and dependencies
4. **Data Models**: Infer data structures from requests/responses
5. **WebSocket/SSE**: Any real-time communication endpoints
6. **Complete API Usage Guide**: Step-by-step guide to replicate the API usage`,

  [AnalysisMode.SECURITY]: `Perform a thorough security assessment:
1. **Credential Exposure**: Any passwords, tokens, API keys visible in plaintext
2. **Authentication Issues**: Token handling weaknesses, session fixation risks
3. **Transport Security**: HTTPS enforcement, HSTS, certificate issues
4. **Cookie Security**: Missing security flags, insecure cookie handling
5. **Information Leakage**: Error messages, stack traces, version info disclosed
6. **CORS and Headers**: Misconfigured CORS, missing security headers
7. **Risk Summary**: Table of findings with severity and remediation`,

  [AnalysisMode.PERFORMANCE]: `Perform a thorough performance analysis:
1. **Timing Breakdown**: DNS, connect, TLS, TTFB, transfer times for each request
2. **Slow Request Report**: Requests exceeding acceptable thresholds
3. **Duplicate Calls**: Repeated identical requests that could be cached
4. **Cache Analysis**: Missing or misconfigured caching headers
5. **Payload Analysis**: Oversized responses, missing compression
6. **Connection Efficiency**: Keep-alive usage, HTTP/2 opportunity
7. **Optimization Recommendations**: Prioritized list with estimated impact`,

  [AnalysisMode.CRYPTO]: `Perform a thorough crypto analysis:
1. **Crypto Operations Found**: All encryption/decryption/signing/hashing operations
2. **Algorithm Inventory**: Which algorithms and modes are used (AES, RSA, SM2, etc.)
3. **Key Management**: How keys are derived, stored, and transmitted
4. **Code Quality**: Review extracted JS crypto code for correctness
5. **Implementation Security**: IV reuse, ECB mode, hardcoded keys, weak parameters
6. **TLS Analysis**: Certificate validation, protocol versions, cipher suites
7. **Compliance**: Standards compliance (NIST, GM/T for Chinese standards)
8. **Vulnerability Assessment**: Any exploitable weaknesses in the crypto implementation`,

  [AnalysisMode.CUSTOM]: ''
}

// --- Request Summary for Phase 1 Filter ---

interface RequestSummary {
  seq: number
  method: string
  url: string
  statusCode: number | null
  contentType: string | null
  isStreaming: boolean
  isWebsocket: boolean
}

/**
 * Build the complete system + user prompts for deep analysis (Phase 2).
 */
export function buildAnalysisPrompt(
  data: AssembledData,
  config: AnalysisConfigType
): { systemPrompt: string; userPrompt: string } {
  const mode = config.mode
  const systemPrompt = buildSystemPrompt(mode, config)

  const parts: string[] = []

  // Scene hints
  if (data.sceneHints.length > 0) {
    parts.push(formatSceneHints(data.sceneHints))
  }

  // Auth chains
  if (data.authChains.length > 0) {
    parts.push(formatAuthChains(data.authChains))
  }

  // Streaming requests
  if (data.streamingRequests.length > 0) {
    parts.push(formatStreamingRequests(data.streamingRequests))
  }

  // Request log with full details
  parts.push(formatRequestLog(data.requests))

  // JS hook data
  const allHooks = collectAllHooks(data.requests)
  if (allHooks.length > 0) {
    parts.push(formatHookData(allHooks))
  }

  // Crypto operations
  if (data.cryptoHooks.length > 0) {
    parts.push(formatCryptoOperations(data.cryptoHooks))
  }

  // Crypto code snippets
  if (data.cryptoSnippets.length > 0) {
    parts.push(formatCryptoSnippets(data.cryptoSnippets))
  }

  // Storage changes
  if (data.storageChanges) {
    parts.push(formatStorageChanges(data.storageChanges))
  }

  // Request index for tool-based inspection
  parts.push(formatRequestIndex(data.requests))

  // Mode-specific requirements
  const requirements = MODE_REQUIREMENTS[mode]
  if (requirements) {
    parts.push(`---\n\n## Analysis Requirements\n\n${requirements}`)
  }

  // Custom prompt / requirements
  if (config.customPrompt) {
    parts.push(`---\n\n## Custom Instructions\n\n${config.customPrompt}`)
  }
  if (config.customRequirements) {
    parts.push(`---\n\n## Custom Requirements\n\n${config.customRequirements}`)
  }

  const userPrompt = parts.join('\n\n')

  logger.info('Analysis prompt built', {
    mode,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    sections: parts.length
  })

  return { systemPrompt, userPrompt }
}

/**
 * Build the Phase 1 filter prompt (lightweight summaries only).
 * Used when there are 20+ requests to smart-filter before deep analysis.
 */
export function buildFilterPrompt(
  summaries: RequestSummary[],
  sceneHints: SceneHint[]
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a smart traffic filter for a packet analysis tool. You will be given a list of captured HTTP requests with basic metadata. Your task is to select the most relevant request sequence numbers for deeper analysis.

Selection criteria:
1. Prioritize requests that are part of API exchanges (non-static, non-navigation)
2. Include all requests involved in authentication flows (login, token exchange, OAuth)
3. Include requests with unusual or interesting patterns (streaming, WebSocket, crypto-related)
4. Include requests that carry important data (POST/PUT/PATCH with bodies)
5. Keep at least one example of each distinct endpoint pattern
6. Remove duplicate/identical repeated requests (keep the first occurrence)
7. Always include requests flagged by scene detection

Return ONLY a JSON array of sequence numbers, nothing else. Example: [1, 3, 7, 12, 15]`

  const summaryLines = summaries.map(s =>
    `#${s.seq} ${s.method} ${s.url} [${s.statusCode || 'pending'}] ${s.contentType || ''}${s.isStreaming ? ' [STREAMING]' : ''}${s.isWebsocket ? ' [WEBSOCKET]' : ''}`
  ).join('\n')

  const sceneInfo = sceneHints.length > 0
    ? `\n\nDetected scenes: ${sceneHints.map(h => `${h.scene} (confidence: ${h.confidence.toFixed(2)})`).join(', ')}`
    : ''

  const userPrompt = `以下是捕获到的 HTTP 请求列表。请选择最相关的请求序列号，以进行更深入的分析。\n\n${summaryLines}${sceneInfo}\n\n请返回一个应包含在深度分析中的请求序列号的 JSON 数组。目标选择约30-50%最有信息量的请求。如果少于10个请求看起来相关，则包含所有这些请求。`

  return { systemPrompt, userPrompt }
}

// --- Build System Prompt ---

function buildSystemPrompt(mode: AnalysisMode, config: AnalysisConfigType): string {
  let prompt = SYSTEM_PROMPTS[mode]

  // Add tool-calling instructions for Phase 2 agentic loop
  prompt += `

## Tool Calling

You have access to an \`inspect_request\` tool that allows you to get full details of any request by its sequence number. Use this when you need to see complete headers, request body, or response body for a specific request that was summarized in the data.

Tool schema:
{
  "name": "inspect_request",
  "description": "Get full details of a captured request by its sequence number",
  "parameters": {
    "type": "object",
    "properties": {
      "seq": {
        "type": "number",
        "description": "The request sequence number"
      },
      "part": {
        "type": "string",
        "enum": ["full", "headers", "request_body", "response_body", "timing"],
        "description": "Which part of the request to inspect (default: full)"
      }
    },
    "required": ["seq"]
  }
}

Use the tool to inspect any request you need more details about. Do not guess - use the tool to verify your analysis.`

  if (config.customPrompt) {
    prompt += `\n\n## Additional System Instructions\n\n${config.customPrompt}`
  }

  return prompt
}

// --- Format Scene Hints ---

function formatSceneHints(hints: SceneHint[]): string {
  const lines = ['## Detected Scenes\n']
  for (const hint of hints) {
    lines.push(`**${hint.scene}** (confidence: ${hint.confidence.toFixed(2)})`)
    for (const ev of hint.evidence.slice(0, 3)) {
      lines.push(`  - ${ev}`)
    }
    if (hint.evidence.length > 3) {
      lines.push(`  - ... and ${hint.evidence.length - 3} more evidence items`)
    }
  }
  return lines.join('\n')
}

// --- Format Auth Chains ---

function formatAuthChains(chains: AuthChainStep[]): string {
  const lines = ['## Authentication Chains\n']
  for (const chain of chains) {
    lines.push(
      `- **${chain.tokenType}**: Issued at request #${chain.issuedAt} → ` +
      `Consumed at request #${chain.consumedAt} via ${chain.carrier} ` +
      `(preview: \`${chain.tokenPreview}\`)`
    )
  }
  return lines.join('\n')
}

// --- Format Streaming Requests ---

function formatStreamingRequests(streaming: StreamingRequestInfo[]): string {
  const lines = ['## Streaming Requests\n']
  for (const req of streaming) {
    const flags: string[] = []
    if (req.isSSE) flags.push('SSE')
    if (req.isChunked) flags.push('chunked')
    lines.push(
      `- #${req.seq} ${req.method} ${req.url} [${req.contentType || 'unknown'}]${flags.length ? ` (${flags.join(', ')})` : ''}`
    )
  }
  return lines.join('\n')
}

// --- Format Request Log ---

function formatRequestLog(requests: RequestLogEntry[]): string {
  const lines = ['## Request Log\n']

  for (const req of requests) {
    lines.push(`### Request #${req.seq}`)
    lines.push(`- **Method**: ${req.method}`)
    lines.push(`- **URL**: ${req.url}`)
    lines.push(`- **Hostname**: ${req.hostname}`)
    lines.push(`- **Path**: ${req.path}`)
    lines.push(`- **Status**: ${req.statusCode ?? 'pending'}`)
    lines.push(`- **Content-Type**: ${req.contentType || 'N/A'}`)

    // Request headers (summarized)
    lines.push(`- **Request Headers**:`)
    for (const [key, value] of Object.entries(req.requestHeaders)) {
      lines.push(`  - \`${key}\`: ${truncate(String(value), 120)}`)
    }

    // Request body
    if (req.requestBody) {
      lines.push(`- **Request Body**:`)
      lines.push('```')
      lines.push(truncate(req.requestBody, 2000))
      lines.push('```')
    }

    // Response headers (summarized)
    if (req.responseHeaders) {
      lines.push(`- **Response Headers**:`)
      for (const [key, value] of Object.entries(req.responseHeaders)) {
        lines.push(`  - \`${key}\`: ${truncate(String(value), 120)}`)
      }
    }

    // Response body
    if (req.responseBody) {
      lines.push(`- **Response Body**:`)
      lines.push('```')
      lines.push(truncate(req.responseBody, 2000))
      lines.push('```')
    }

    // Timing
    if (req.timing) {
      lines.push(`- **Timing**: DNS=${req.timing.dns}ms, Connect=${req.timing.connect}ms, TLS=${req.timing.tls}ms, Wait=${req.timing.wait}ms, Receive=${req.timing.receive}ms, Total=${req.timing.total}ms`)
    }

    // Flags
    const flags: string[] = []
    if (req.isStreaming) flags.push('STREAMING')
    if (req.isWebsocket) flags.push('WEBSOCKET')
    if (flags.length) {
      lines.push(`- **Flags**: ${flags.join(', ')}`)
    }

    // Associated hooks
    if (req.associatedHooks.length > 0) {
      lines.push(`- **Associated Hooks** (${req.associatedHooks.length}):`)
      for (const hook of req.associatedHooks.slice(0, 5)) {
        lines.push(`  - [${hook.hookType}] ${hook.functionName}(${truncate(hook.args, 60)})`)
      }
      if (req.associatedHooks.length > 5) {
        lines.push(`  - ... and ${req.associatedHooks.length - 5} more`)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}

// --- Format Hook Data ---

function collectAllHooks(requests: RequestLogEntry[]): JsHookRecord[] {
  const allHooks: JsHookRecord[] = []
  const seen = new Set<string>()
  for (const req of requests) {
    for (const hook of req.associatedHooks) {
      if (!seen.has(hook.id)) {
        seen.add(hook.id)
        allHooks.push(hook)
      }
    }
  }
  return allHooks
}

function formatHookData(hooks: JsHookRecord[]): string {
  const lines = ['## JS Hook Interceptions\n']

  // Group by hook type
  const byType = new Map<string, JsHookRecord[]>()
  for (const hook of hooks) {
    const existing = byType.get(hook.hookType) || []
    existing.push(hook)
    byType.set(hook.hookType, existing)
  }

  for (const [hookType, records] of byType) {
    lines.push(`### ${hookType} (${records.length} calls)`)
    for (const record of records.slice(0, 20)) {
      lines.push(`- \`${record.functionName}\`(${truncate(record.args, 80)}) → ${record.returnValue ? truncate(record.returnValue, 60) : 'void'}`)
    }
    if (records.length > 20) {
      lines.push(`- ... and ${records.length - 20} more calls`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// --- Format Crypto Operations ---

function formatCryptoOperations(hooks: JsHookRecord[]): string {
  const lines = ['## Crypto Operations\n']

  for (const hook of hooks) {
    lines.push(`- **[${hook.hookType}] ${hook.functionName}**`)
    lines.push(`  - Args: ${truncate(hook.args, 200)}`)
    if (hook.returnValue) {
      lines.push(`  - Return: ${truncate(hook.returnValue, 100)}`)
    }
    // Include abbreviated stack trace
    if (hook.callStack) {
      const stackLines = hook.callStack.split('\n').slice(0, 3)
      lines.push(`  - Stack: ${stackLines.join(' <- ')}`)
    }
  }

  return lines.join('\n')
}

// --- Format Crypto Snippets ---

function formatCryptoSnippets(snippets: CryptoSnippet[]): string {
  const lines = ['## Crypto Code Snippets\n']

  for (const snippet of snippets) {
    lines.push(`### [Tier ${snippet.tier}] ${snippet.matchPattern} (from request #${snippet.seq}, ${snippet.url})`)
    lines.push(`Starting at line ${snippet.startLine}:`)
    lines.push('```javascript')
    lines.push(truncate(snippet.code, 3000))
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}

// --- Format Storage Changes ---

function formatStorageChanges(changes: StorageChangeSet): string {
  const lines = ['## Storage Changes\n']
  lines.push(`*Between ${new Date(changes.firstTimestamp).toISOString()} and ${new Date(changes.lastTimestamp).toISOString()}*\n`)

  const { diff } = changes

  // Cookies
  if (diff.cookies.added.length || diff.cookies.changed.length || diff.cookies.removed.length) {
    lines.push('### Cookies')
    formatDiffResult(lines, diff.cookies)
  }

  // localStorage
  if (diff.localStorage.added.length || diff.localStorage.changed.length || diff.localStorage.removed.length) {
    lines.push('### Local Storage')
    formatDiffResult(lines, diff.localStorage)
  }

  // sessionStorage
  if (diff.sessionStorage.added.length || diff.sessionStorage.changed.length || diff.sessionStorage.removed.length) {
    lines.push('### Session Storage')
    formatDiffResult(lines, diff.sessionStorage)
  }

  return lines.join('\n')
}

function formatDiffResult(lines: string[], diff: { added: any[]; changed: any[]; removed: string[] }): void {
  for (const entry of diff.added) {
    lines.push(`- **Added**: \`${entry.key}\` = \`${truncate(entry.value, 80)}\``)
  }
  for (const entry of diff.changed) {
    lines.push(`- **Changed**: \`${entry.key}\` = \`${truncate(entry.value, 80)}\``)
  }
  for (const key of diff.removed) {
    lines.push(`- **Removed**: \`${key}\``)
  }
}

// --- Format Request Index ---

function formatRequestIndex(requests: RequestLogEntry[]): string {
  const lines = ['## Request Index\n']
  lines.push('Use the `inspect_request` tool with these sequence numbers to get full details:')
  lines.push('')

  for (const req of requests) {
    const flags: string[] = []
    if (req.isStreaming) flags.push('S')
    if (req.isWebsocket) flags.push('W')
    if (req.associatedHooks.length > 0) flags.push(`H:${req.associatedHooks.length}`)
    if (req.requestBody) flags.push('hasBody')
    if (req.responseBody) flags.push('hasResp')

    lines.push(
      `#${req.seq} | ${req.method} | ${req.statusCode ?? '---'} | ` +
      `${truncate(req.path, 40)} | ${flags.join(',')}`
    )
  }

  return lines.join('\n')
}

// --- Utility ---

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.substring(0, maxLen - 3) + '...'
}

/**
 * Create lightweight summaries from raw requests for Phase 1 filtering.
 */
export function createRequestSummaries(requests: CapturedRequest[]): RequestSummary[] {
  return requests.map(req => ({
    seq: req.seq,
    method: req.method,
    url: req.url,
    statusCode: req.statusCode,
    contentType: req.contentType,
    isStreaming: req.isStreaming,
    isWebsocket: req.isWebsocket
  }))
}
