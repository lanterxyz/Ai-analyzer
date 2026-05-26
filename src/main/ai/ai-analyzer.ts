// ============================================================================
// AI Analyzer - Two-phase analysis orchestrator
// Phase 1: Smart Filtering (when 20+ requests) - lightweight LLM call
// Phase 2: Deep Analysis - full data + agentic tool-calling loop (10 rounds)
// Also: manual multi-select analysis, multi-turn chat with context compression
// ============================================================================

import {
  AnalysisMode,
  LLMProvider,
  AnalysisConfig as AnalysisConfigType,
  AnalysisReport,
  ChatMessage,
  CapturedRequest,
  JsHookRecord,
  SceneHint,
  LlmConfig
} from '@shared/types'
import { RequestRepo, HookRepo, ReportRepo, ChatMessageRepo, AiRequestLogRepo } from '../db/repositories'
import { assembleData, AssembledData, RequestLogEntry } from './data-assembler'
import { buildAnalysisPrompt, buildFilterPrompt, createRequestSummaries } from './prompt-builder'
import { complete, completeWithTools, streamComplete, LlmMessage, ToolDefinition, LlmStreamChunk } from './llm-router'
import { detect as detectScenes } from './scene-detector'
import { v4 as uuid } from 'uuid'
import { createLogger } from '../logger'

const logger = createLogger('ai-analyzer')

// --- Constants ---

const FILTER_THRESHOLD = 20 // Number of requests above which Phase 1 filtering kicks in
const MAX_AGENT_ROUNDS = 10 // Max tool-calling rounds in Phase 2
const MAX_CHAT_HISTORY_TOKENS = 20000 // Approximate token limit for chat history
const CHAT_COMPRESS_THRESHOLD = 15 // Number of messages before compression kicks in

// --- Tool Definitions for Agentic Loop ---

const INSPECT_REQUEST_TOOL: ToolDefinition = {
  name: 'inspect_request',
  description: 'Get full details of a captured request by its sequence number. Returns complete headers, request body, response body, and timing information.',
  parameters: {
    type: 'object',
    properties: {
      seq: {
        type: 'number',
        description: 'The request sequence number'
      },
      part: {
        type: 'string',
        enum: ['full', 'headers', 'request_body', 'response_body', 'timing'],
        description: 'Which part of the request to inspect (default: full)'
      }
    },
    required: ['seq']
  }
}

// --- Progress Callback Type ---

export type ProgressCallback = (stage: string, detail?: string) => void

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Run a two-phase AI analysis on a captured session.
 *
 * Phase 1 (Smart Filtering): When 20+ requests exist, sends lightweight summaries
 * to the LLM to determine which requests are most relevant for deeper analysis.
 *
 * Phase 2 (Deep Analysis): Sends full data (possibly filtered) to the LLM with
 * an agentic tool-calling loop that allows the LLM to inspect individual requests
 * in detail.
 *
 * @param sessionId - Session to analyze
 * @param config - Analysis configuration (provider, model, mode, etc.)
 * @param onProgress - Optional progress callback
 * @param purpose - Optional analysis purpose description
 * @param template - Optional prompt template system prompt override
 * @param selectedSeqs - Optional pre-selected request sequence numbers (skips Phase 1)
 * @param signal - Optional AbortSignal for cancellation
 * @returns Analysis report
 */
export async function analyze(
  sessionId: string,
  config: AnalysisConfigType,
  onProgress?: ProgressCallback,
  purpose?: string,
  template?: string,
  selectedSeqs?: number[],
  signal?: AbortSignal
): Promise<AnalysisReport> {
  const startTime = Date.now()
  logger.info('Starting analysis', { sessionId, mode: config.mode, provider: config.provider })

  const requestRepo = new RequestRepo()

  // Load raw data for initial assessment
  const rawRequests = requestRepo.listBySession(sessionId, 0, 2000)
  const totalRequests = rawRequests.length

  if (totalRequests === 0) {
    return createEmptyReport(sessionId, config, 'No captured requests found in this session.')
  }

  // --- Phase 1: Smart Filtering (if needed) ---
  let filteredSeqs: number[] = selectedSeqs || []

  if (selectedSeqs && selectedSeqs.length > 0) {
    // User pre-selected requests, skip Phase 1
    logger.info('Using pre-selected requests', { count: selectedSeqs.length })
    onProgress?.('phase2', `Using ${selectedSeqs.length} selected requests`)
  } else if (totalRequests >= FILTER_THRESHOLD) {
    // Run Phase 1 filtering
    logger.info('Phase 1: Smart filtering', { totalRequests })
    onProgress?.('phase1', `Filtering ${totalRequests} requests...`)

    try {
      filteredSeqs = await runPhase1Filtering(rawRequests, config, sessionId, signal)
      logger.info('Phase 1 complete', { filteredCount: filteredSeqs.length })
      onProgress?.('phase1_done', `Selected ${filteredSeqs.length} of ${totalRequests} requests`)
    } catch (err: any) {
      // If Phase 1 fails (e.g., API error), fall back to top 30 requests
      logger.warn('Phase 1 filtering failed, using fallback', { error: err.message })
      filteredSeqs = rawRequests.slice(0, 30).map(r => r.seq)
      onProgress?.('phase1_fallback', 'Filtering failed, using first 30 requests')
    }
  } else {
    // Few enough requests, use all
    filteredSeqs = rawRequests.map(r => r.seq)
  }

  // --- Assemble Data ---
  onProgress?.('assembling', 'Assembling captured data...')

  // Assemble all data (filtering happens within assembleData for static resources)
  let data = assembleData(sessionId, config.mode)

  // If we have filtered seqs, further narrow the request log
  if (filteredSeqs.length > 0 && !selectedSeqs) {
    const seqSet = new Set(filteredSeqs)
    data.requests = data.requests.filter(r => seqSet.has(r.seq))
  }

  // --- Phase 2: Deep Analysis with Agentic Tool-Calling ---
  logger.info('Phase 2: Deep analysis', {
    requestCount: data.requests.length,
    mode: config.mode
  })
  onProgress?.('phase2', `Analyzing ${data.requests.length} requests...`)

  const llmConfig: LlmConfig = {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens
  }

  // Build prompts
  const { systemPrompt, userPrompt } = buildAnalysisPrompt(data, config)

  // Override system prompt with template if provided
  const finalSystemPrompt = template || systemPrompt

  // Add purpose to user prompt if provided
  const finalUserPrompt = purpose
    ? `${userPrompt}\n\n---\n\n## Purpose\n\n${purpose}`
    : userPrompt

  const messages: LlmMessage[] = [
    { role: 'system', content: finalSystemPrompt },
    { role: 'user', content: finalUserPrompt }
  ]

  // Build the tool callback for inspect_request
  const inspectTool = (name: string, args: any): Promise<string> => {
    if (name === 'inspect_request') {
      return inspectRequestToolCall(args.seq, args.part, sessionId, data)
    }
    return Promise.resolve(`Unknown tool: ${name}`)
  }

  // Run agentic loop with streaming progress
  let analysisContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let filterPromptTokens: number | null = null
  let filterCompletionTokens: number | null = null

  try {
    // Try streaming first for better UX
    const chunks: string[] = []
    const streamResponse = await streamComplete(
      messages,
      llmConfig,
      (chunk: LlmStreamChunk) => {
        if (chunk.type === 'content' && chunk.content) {
          chunks.push(chunk.content)
          analysisContent += chunk.content
          // Periodic progress updates
          if (chunks.length % 50 === 0) {
            onProgress?.('phase2_streaming', `Generating analysis... (${chunks.length} chunks)`)
          }
        }
      },
      { signal, timeout: 180000 }
    )

    analysisContent = chunks.join('')
    promptTokens = streamResponse.promptTokens || 0
    completionTokens = streamResponse.completionTokens || 0
  } catch (err: any) {
    // Streaming failed, fall back to non-streaming with tool-calling
    logger.warn('Streaming failed, falling back to tool-calling loop', { error: err.message })

    try {
      const response = await completeWithTools(
        messages,
        [INSPECT_REQUEST_TOOL],
        inspectTool,
        llmConfig,
        {
          maxRounds: MAX_AGENT_ROUNDS,
          timeout: 180000,
          signal
        }
      )

      analysisContent = response.content
      promptTokens = response.promptTokens || 0
      completionTokens = response.completionTokens || 0
    } catch (innerErr: any) {
      logger.error('Tool-calling loop also failed', { error: innerErr.message })
      analysisContent = `Analysis failed: ${innerErr.message}\n\nPlease check your LLM configuration and try again.`
    }
  }

  // Track Phase 1 tokens if applicable
  // (token counts from Phase 1 are tracked separately)

  // --- Create Report ---
  const report: AnalysisReport = {
    id: uuid(),
    sessionId,
    mode: config.mode,
    content: analysisContent,
    promptTokens,
    completionTokens,
    filterPromptTokens,
    filterCompletionTokens,
    createdAt: Date.now()
  }

  // Persist report
  const reportRepo = new ReportRepo()
  reportRepo.insert(report)

  const elapsed = Date.now() - startTime
  logger.info('Analysis complete', {
    reportId: report.id,
    elapsed,
    promptTokens,
    completionTokens,
    contentLength: analysisContent.length
  })

  onProgress?.('complete', `Analysis complete in ${(elapsed / 1000).toFixed(1)}s`)

  return report
}

// ============================================================================
// Phase 1: Smart Filtering
// ============================================================================

async function runPhase1Filtering(
  rawRequests: CapturedRequest[],
  config: AnalysisConfigType,
  sessionId: string,
  signal?: AbortSignal
): Promise<number[]> {
  const hookRepo = new HookRepo()
  const hooks = hookRepo.listBySession(sessionId)

  // Run lightweight scene detection on raw requests
  const sceneHints = detectScenes(rawRequests, hooks)

  // Create lightweight summaries
  const summaries = createRequestSummaries(rawRequests)

  // Build filter prompt
  const { systemPrompt, userPrompt } = buildFilterPrompt(summaries, sceneHints)

  const llmConfig: LlmConfig = {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    maxTokens: 4096 // Small budget for filtering
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]

  const response = await complete(messages, llmConfig, {
    timeout: 60000,
    signal,
    maxRetries: 2
  })

  // Parse the sequence numbers from the response
  return parseFilteredSeqs(response.content)
}

function parseFilteredSeqs(content: string): number[] {
  // Try to extract a JSON array from the response
  const jsonMatch = content.match(/\[[\d,\s]+\]/)
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0])
      if (Array.isArray(arr) && arr.every(n => typeof n === 'number')) {
        return arr
      }
    } catch {
      // Fall through to alternative parsing
    }
  }

  // Alternative: find all numbers in the response
  const numbers = content.match(/\d+/g)
  if (numbers) {
    return numbers.map(Number).filter(n => n > 0)
  }

  // Last resort: return empty (will trigger fallback to all requests)
  return []
}

// ============================================================================
// Inspect Request Tool Implementation
// ============================================================================

async function inspectRequestToolCall(
  seq: number,
  part: string | undefined,
  sessionId: string,
  data: AssembledData
): Promise<string> {
  const requestRepo = new RequestRepo()

  const request = requestRepo.getBySeq(sessionId, seq)
  if (!request) {
    return `Request #${seq} not found.`
  }

  switch (part) {
    case 'headers':
      return formatHeadersInspection(request)
    case 'request_body':
      return request.requestBody || '(no request body)'
    case 'response_body':
      return request.responseBody || '(no response body)'
    case 'timing':
      return formatTimingInspection(request)
    case 'full':
    default:
      return formatFullInspection(request, data)
  }
}

function formatHeadersInspection(req: CapturedRequest): string {
  const lines: string[] = [`# Request #${req.seq} Headers\n`]
  lines.push('## Request Headers')
  for (const [key, value] of Object.entries(req.requestHeaders)) {
    lines.push(`- ${key}: ${value}`)
  }
  if (req.responseHeaders) {
    lines.push('\n## Response Headers')
    for (const [key, value] of Object.entries(req.responseHeaders)) {
      lines.push(`- ${key}: ${value}`)
    }
  }
  return lines.join('\n')
}

function formatTimingInspection(req: CapturedRequest): string {
  if (!req.timing) return `No timing data available for request #${req.seq}`
  const t = req.timing
  return [
    `# Request #${req.seq} Timing\n`,
    `DNS: ${t.dnsEnd - t.dnsStart}ms`,
    `Connect: ${t.connectEnd - t.connectStart}ms`,
    `TLS: ${t.tlsEnd - t.tlsStart}ms`,
    `Send: ${t.sendEnd - t.sendStart}ms`,
    `Wait (TTFB): ${t.receiveStart - t.sendEnd}ms`,
    `Receive: ${t.receiveEnd - t.receiveStart}ms`,
    `Total: ${t.receiveEnd - t.dnsStart}ms`
  ].join('\n')
}

function formatFullInspection(req: CapturedRequest, _data: AssembledData): string {
  const lines: string[] = [`# Request #${req.seq} Full Details\n`]
  lines.push(`Method: ${req.method}`)
  lines.push(`URL: ${req.url}`)
  lines.push(`Hostname: ${req.hostname}`)
  lines.push(`Path: ${req.path}`)
  lines.push(`Status: ${req.statusCode || 'pending'}`)
  lines.push(`Content-Type: ${req.contentType || 'N/A'}`)
  lines.push(`Streaming: ${req.isStreaming}`)
  lines.push(`WebSocket: ${req.isWebsocket}`)

  lines.push('\n## Request Headers')
  for (const [key, value] of Object.entries(req.requestHeaders)) {
    lines.push(`${key}: ${value}`)
  }

  if (req.requestBody) {
    lines.push('\n## Request Body')
    lines.push('```')
    lines.push(req.requestBody.substring(0, 5000))
    if (req.requestBody.length > 5000) lines.push('... [truncated]')
    lines.push('```')
  }

  if (req.responseHeaders) {
    lines.push('\n## Response Headers')
    for (const [key, value] of Object.entries(req.responseHeaders)) {
      lines.push(`${key}: ${value}`)
    }
  }

  if (req.responseBody) {
    lines.push('\n## Response Body')
    lines.push('```')
    lines.push(req.responseBody.substring(0, 5000))
    if (req.responseBody.length > 5000) lines.push('... [truncated]')
    lines.push('```')
  }

  if (req.timing) {
    lines.push('\n## Timing')
    lines.push(formatTimingInspection(req))
  }

  return lines.join('\n')
}

// ============================================================================
// Chat Function (Multi-turn with Context Compression)
// ============================================================================

/**
 * Send a follow-up message in a multi-turn chat session about an analysis report.
 * Supports context compression when the conversation gets too long.
 */
export async function chat(
  sessionId: string,
  config: AnalysisConfigType,
  history: ChatMessage[],
  userMessage: string,
  onProgress?: ProgressCallback,
  reportId?: string
): Promise<ChatMessage> {
  logger.info('Chat message received', {
    sessionId,
    historyLength: history.length,
    reportId
  })

  const llmConfig: LlmConfig = {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens
  }

  // Build message list from history
  let llmMessages: LlmMessage[] = history.map(msg => ({
    role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
    content: msg.content,
    toolCalls: msg.toolCalls ? JSON.parse(msg.toolCalls) : undefined,
    toolCallId: undefined
  }))

  // Add the new user message
  llmMessages.push({ role: 'user', content: userMessage })

  // Apply context compression if needed
  if (estimateTokenCount(llmMessages) > MAX_CHAT_HISTORY_TOKENS) {
    logger.info('Compressing chat history', {
      estimatedTokens: estimateTokenCount(llmMessages),
      threshold: MAX_CHAT_HISTORY_TOKENS
    })
    llmMessages = compressChatHistory(llmMessages)
    onProgress?.('compressed', 'Chat history was compressed to fit context window')
  }

  // If we have a report, include its data context as a system message
  if (reportId) {
    const reportRepo = new ReportRepo()
    const report = reportRepo.getById(reportId)
    if (report) {
      // Insert context about the current analysis
      const contextMessage: LlmMessage = {
        role: 'system',
        content: `You are continuing a conversation about an analysis report. The original analysis was for mode "${report.mode}" and found the following:\n\n${report.content.substring(0, 3000)}${report.content.length > 3000 ? '\n\n[... truncated]' : ''}`
      }
      // Put system context at the beginning
      llmMessages = [contextMessage, ...llmMessages.filter(m => m.role !== 'system')]
    }
  }

  onProgress?.('generating', 'Generating response...')

  // Call LLM
  let responseContent = ''
  try {
    // Try streaming for responsive UX
    const chunks: string[] = []
    await streamComplete(
      llmMessages,
      llmConfig,
      (chunk: LlmStreamChunk) => {
        if (chunk.type === 'content' && chunk.content) {
          chunks.push(chunk.content)
        }
      },
      { timeout: 120000 }
    )
    responseContent = chunks.join('')
  } catch (err: any) {
    logger.warn('Streaming chat failed, falling back to non-streaming', { error: err.message })
    const response = await complete(llmMessages, llmConfig, { timeout: 120000 })
    responseContent = response.content
  }

  // Persist the chat message
  const assistantMessage: ChatMessage = {
    id: uuid(),
    reportId: reportId || '',
    role: 'assistant',
    content: responseContent,
    toolCalls: null,
    toolResults: null,
    createdAt: Date.now()
  }

  if (reportId) {
    const chatRepo = new ChatMessageRepo()
    chatRepo.insert(assistantMessage)
  }

  logger.info('Chat response generated', {
    contentLength: responseContent.length
  })

  return assistantMessage
}

// ============================================================================
// Chat History Compression
// ============================================================================

function compressChatHistory(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length < CHAT_COMPRESS_THRESHOLD) return messages

  // Strategy: Keep system messages, the latest 5 exchanges, and summarize older content
  const systemMessages = messages.filter(m => m.role === 'system')
  const nonSystemMessages = messages.filter(m => m.role !== 'system')

  // Keep the latest N messages intact
  const recentCount = 10 // 5 exchanges = 10 messages
  const recent = nonSystemMessages.slice(-recentCount)
  const older = nonSystemMessages.slice(0, -recentCount)

  if (older.length === 0) {
    return [...systemMessages, ...recent]
  }

  // Compress older messages: strip tool_contexts and summarize
  const compressedSummary = compressOlderMessages(older)
  const compressionMessage: LlmMessage = {
    role: 'system',
    content: `## Earlier Conversation Summary\n\n${compressedSummary}\n\n---\nThe above is a summary of earlier conversation context. Continue the conversation naturally.`
  }

  return [...systemMessages, compressionMessage, ...recent]
}

function compressOlderMessages(messages: LlmMessage[]): string {
  // Strip tool_context fields and build a summary
  const summaries: string[] = []

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        // Keep user messages relatively intact but truncate
        summaries.push(`User: ${msg.content.substring(0, 200)}`)
        break
      case 'assistant':
        // Summarize assistant responses
        let content = msg.content
        // Remove tool_context sections (verbose inspection results)
        content = content.replace(/## Tool Context[\s\S]*?(?=\n##|\n---|\Z)/gi, '')
        content = content.replace(/<tool_context>[\s\S]*?<\/tool_context>/gi, '[tool results omitted]')
        summaries.push(`Assistant: ${content.substring(0, 300)}`)
        break
      case 'tool':
        // Tool results are compressed to just the fact they happened
        summaries.push(`[Tool result for ${msg.toolCallId || 'unknown'}]`)
        break
    }
  }

  return summaries.join('\n').substring(0, 4000)
}

// ============================================================================
// Utility Functions
// ============================================================================

function estimateTokenCount(messages: LlmMessage[]): number {
  // Rough estimate: 1 token per 4 characters for English, 1 per 2 for CJK
  let charCount = 0
  for (const msg of messages) {
    charCount += msg.content.length
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        charCount += tc.arguments.length
      }
    }
  }
  // Assume mixed content, use 3 chars/token as average
  return Math.ceil(charCount / 3)
}

function createEmptyReport(
  sessionId: string,
  config: AnalysisConfigType,
  content: string
): AnalysisReport {
  const report: AnalysisReport = {
    id: uuid(),
    sessionId,
    mode: config.mode,
    content,
    promptTokens: 0,
    completionTokens: 0,
    filterPromptTokens: null,
    filterCompletionTokens: null,
    createdAt: Date.now()
  }

  const reportRepo = new ReportRepo()
  reportRepo.insert(report)

  return report
}
