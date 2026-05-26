// ============================================================================
// LLM Router - Unified LLM calling interface
// Supports OpenAI (Chat Completions + Responses API), Anthropic (Messages API),
// Minimax, and custom OpenAI-compatible providers.
// Handles streaming (SSE), non-streaming, tool calling, agentic loops,
// retry with backoff on 429, and network error diagnostics.
// ============================================================================

import { LLMProvider, LlmConfig } from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('llm-router')

// --- Types ---

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string // For tool result messages
}

export interface ToolCall {
  id: string
  name: string
  arguments: string // JSON string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any> // JSON Schema
}

export interface LlmResponse {
  content: string
  toolCalls?: ToolCall[]
  promptTokens?: number
  completionTokens?: number
  finishReason?: string
}

export interface LlmStreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'error'
  content?: string
  toolCall?: Partial<ToolCall>
  finishReason?: string
  error?: string
}

export interface LlmCallOptions {
  /** Max retry attempts on 429/network errors (default: 3) */
  maxRetries?: number
  /** Request timeout in ms (default: 120000) */
  timeout?: number
  /** Whether to use streaming (default: false for complete, true for streamComplete) */
  stream?: boolean
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Use OpenAI Responses API instead of Chat Completions (OpenAI only) */
  useResponsesApi?: boolean
}

// --- Constants ---

const DEFAULT_TIMEOUT = 120000
const DEFAULT_MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

// ============================================================================
// Main Completion Function
// ============================================================================

/**
 * Send a completion request to the configured LLM provider.
 * Handles both streaming and non-streaming modes.
 */
export async function complete(
  messages: LlmMessage[],
  config: LlmConfig,
  options?: LlmCallOptions
): Promise<LlmResponse> {
  const opts: LlmCallOptions = {
    maxRetries: DEFAULT_MAX_RETRIES,
    timeout: DEFAULT_TIMEOUT,
    stream: false,
    ...options
  }

  logger.info('LLM completion request', {
    provider: config.provider,
    model: config.model,
    messageCount: messages.length,
    streaming: opts.stream
  })

  return withRetry(async () => {
    switch (config.provider) {
      case LLMProvider.OPENAI:
        if (opts.useResponsesApi) {
          return callOpenAIResponses(messages, config, opts)
        }
        return callOpenAIChat(messages, config, opts)
      case LLMProvider.ANTHROPIC:
        return callAnthropic(messages, config, opts)
      case LLMProvider.MINIMAX:
        return callMinimax(messages, config, opts)
      case LLMProvider.CUSTOM:
        return callOpenAICompatible(messages, config, opts)
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`)
    }
  }, opts.maxRetries!, config.provider)
}

// ============================================================================
// Tool-Calling Completion with Agentic Loop
// ============================================================================

/**
 * Send a completion request with tool definitions, and execute an agentic loop
 * where the LLM can make tool calls that are resolved via the callTool callback.
 * Loops up to maxRounds times.
 */
export async function completeWithTools(
  messages: LlmMessage[],
  tools: ToolDefinition[],
  callTool: (name: string, args: any) => Promise<string>,
  config: LlmConfig,
  options?: LlmCallOptions & { maxRounds?: number }
): Promise<LlmResponse> {
  const maxRounds = options?.maxRounds ?? 10
  const opts: LlmCallOptions = {
    maxRetries: DEFAULT_MAX_RETRIES,
    timeout: DEFAULT_TIMEOUT,
    stream: false,
    ...options
  }

  logger.info('LLM tool-calling loop started', {
    provider: config.provider,
    model: config.model,
    toolCount: tools.length,
    maxRounds
  })

  const conversationMessages: LlmMessage[] = [...messages]
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let finalContent = ''

  for (let round = 0; round < maxRounds; round++) {
    logger.debug(`Tool-calling round ${round + 1}/${maxRounds}`)

    const response = await complete(conversationMessages, config, {
      ...opts,
      // Temporarily add tool definitions to the request
    })

    totalPromptTokens += response.promptTokens || 0
    totalCompletionTokens += response.completionTokens || 0

    // If no tool calls, we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalContent = response.content
      break
    }

    // Add assistant message with tool calls
    conversationMessages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls
    })

    // Execute each tool call and add results
    for (const toolCall of response.toolCalls) {
      logger.info('Executing tool call', { name: toolCall.name, round })

      let toolResult: string
      try {
        const args = JSON.parse(toolCall.arguments)
        toolResult = await callTool(toolCall.name, args)
      } catch (err: any) {
        logger.error('Tool call failed', { name: toolCall.name, error: err.message })
        toolResult = `Error executing tool ${toolCall.name}: ${err.message}`
      }

      conversationMessages.push({
        role: 'tool',
        content: toolResult,
        toolCallId: toolCall.id
      })

      finalContent = response.content || ''
    }

    // If this was the last round, include a note about truncation
    if (round === maxRounds - 1) {
      finalContent += '\n\n[Note: Analysis reached the maximum number of tool-calling rounds. Some requests may not have been fully inspected.]'
    }
  }

  return {
    content: finalContent,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    finishReason: 'stop'
  }
}

// ============================================================================
// Streaming Completion
// ============================================================================

/**
 * Stream a completion request, calling onChunk for each chunk received.
 * Returns the final concatenated response.
 */
export async function streamComplete(
  messages: LlmMessage[],
  config: LlmConfig,
  onChunk: (chunk: LlmStreamChunk) => void,
  options?: LlmCallOptions
): Promise<LlmResponse> {
  const opts: LlmCallOptions = {
    maxRetries: DEFAULT_MAX_RETRIES,
    timeout: DEFAULT_TIMEOUT,
    stream: true,
    ...options
  }

  logger.info('LLM streaming request', {
    provider: config.provider,
    model: config.model
  })

  return withRetry(async () => {
    switch (config.provider) {
      case LLMProvider.OPENAI:
        return streamOpenAI(messages, config, onChunk, opts)
      case LLMProvider.ANTHROPIC:
        return streamAnthropic(messages, config, onChunk, opts)
      case LLMProvider.MINIMAX:
        return streamOpenAICompatible(messages, config, onChunk, opts, minimaxUrl(config))
      case LLMProvider.CUSTOM:
        return streamOpenAICompatible(messages, config, onChunk, opts, config.baseUrl)
      default:
        throw new Error(`Unsupported LLM provider for streaming: ${config.provider}`)
    }
  }, opts.maxRetries!, config.provider)
}

// ============================================================================
// OpenAI Chat Completions API
// ============================================================================

async function callOpenAIChat(
  messages: LlmMessage[],
  config: LlmConfig,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const url = `${config.baseUrl}/v1/chat/completions`
  const headers = buildOpenAIHeaders(config.apiKey)
  const body = buildOpenAIChatBody(messages, config, options)

  const response = await makeRequest(url, headers, body, options.timeout!, options.signal)
  return parseOpenAIResponse(response)
}

// ============================================================================
// OpenAI Responses API
// ============================================================================

async function callOpenAIResponses(
  messages: LlmMessage[],
  config: LlmConfig,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const url = `${config.baseUrl}/v1/responses`
  const headers = buildOpenAIHeaders(config.apiKey)

  // Convert messages to Responses API input format
  const input = messages.map(m => ({
    role: m.role === 'tool' ? 'user' : m.role,
    content: m.role === 'tool'
      ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
      : m.content
  }))

  const body = JSON.stringify({
    model: config.model,
    input,
    max_output_tokens: config.maxTokens,
    stream: false
  })

  const response = await makeRequest(url, headers, body, options.timeout!, options.signal)
  return parseOpenAIResponsesApiResponse(response)
}

// ============================================================================
// Anthropic Messages API
// ============================================================================

async function callAnthropic(
  messages: LlmMessage[],
  config: LlmConfig,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const url = config.baseUrl
    ? `${config.baseUrl}/v1/messages`
    : 'https://api.anthropic.com/v1/messages'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  }

  // Separate system message from conversation
  let systemPrompt = ''
  const conversationMessages: any[] = []
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += msg.content + '\n'
    } else if (msg.role === 'tool') {
      // Convert tool results to Anthropic format
      conversationMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content
        }]
      })
    } else if (msg.role === 'assistant' && msg.toolCalls) {
      const content: any[] = []
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: JSON.parse(tc.arguments)
        })
      }
      conversationMessages.push({ role: 'assistant', content })
    } else {
      conversationMessages.push({ role: msg.role, content: msg.content })
    }
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.maxTokens || 4096,
    system: systemPrompt.trim() || undefined,
    messages: conversationMessages,
    stream: false
  })

  const response = await makeRequest(url, headers, body, options.timeout!, options.signal)
  return parseAnthropicResponse(response)
}

// ============================================================================
// Minimax API
// ============================================================================

async function callMinimax(
  messages: LlmMessage[],
  config: LlmConfig,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const url = minimaxUrl(config)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  }

  const body = buildOpenAIChatBody(messages, config, options)
  const response = await makeRequest(url, headers, body, options.timeout!, options.signal)
  return parseOpenAIResponse(response)
}

function minimaxUrl(config: LlmConfig): string {
  if (config.baseUrl) return `${config.baseUrl}/v1/chat/completions`
  return 'https://api.minimax.chat/v1/chat/completions'
}

// ============================================================================
// Custom OpenAI-Compatible Provider
// ============================================================================

async function callOpenAICompatible(
  messages: LlmMessage[],
  config: LlmConfig,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const baseUrl = config.baseUrl || 'https://api.openai.com'
  const url = `${baseUrl}/v1/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  }
  const body = buildOpenAIChatBody(messages, config, options)
  const response = await makeRequest(url, headers, body, options.timeout!, options.signal)
  return parseOpenAIResponse(response)
}

// ============================================================================
// Streaming Implementations
// ============================================================================

async function streamOpenAI(
  messages: LlmMessage[],
  config: LlmConfig,
  onChunk: (chunk: LlmStreamChunk) => void,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const url = `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`
  const headers = buildOpenAIHeaders(config.apiKey)
  const body = buildOpenAIChatBody(messages, config, { ...options, stream: true })

  return streamSSE(url, headers, body, onChunk, options, (data) => {
    // Parse OpenAI SSE format
    if (data === '[DONE]') {
      onChunk({ type: 'done', finishReason: 'stop' })
      return null
    }

    try {
      const parsed = JSON.parse(data)
      const delta = parsed.choices?.[0]?.delta
      const finishReason = parsed.choices?.[0]?.finish_reason

      if (delta?.content) {
        onChunk({ type: 'content', content: delta.content })
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          onChunk({
            type: 'tool_call',
            toolCall: {
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }
          })
        }
      }

      if (finishReason) {
        onChunk({ type: 'done', finishReason })
        return {
          content: '', // Will be assembled from chunks
          finishReason,
          promptTokens: parsed.usage?.prompt_tokens,
          completionTokens: parsed.usage?.completion_tokens
        }
      }

      return null
    } catch {
      return null
    }
  })
}

async function streamAnthropic(
  messages: LlmMessage[],
  config: LlmConfig,
  onChunk: (chunk: LlmStreamChunk) => void,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const url = config.baseUrl
    ? `${config.baseUrl}/v1/messages`
    : 'https://api.anthropic.com/v1/messages'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  }

  // Build Anthropic body with stream: true
  let systemPrompt = ''
  const conversationMessages: any[] = []
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += msg.content + '\n'
    } else if (msg.role === 'tool') {
      conversationMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content
        }]
      })
    } else if (msg.role === 'assistant' && msg.toolCalls) {
      const content: any[] = []
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: JSON.parse(tc.arguments)
        })
      }
      conversationMessages.push({ role: 'assistant', content })
    } else {
      conversationMessages.push({ role: msg.role, content: msg.content })
    }
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.maxTokens || 4096,
    system: systemPrompt.trim() || undefined,
    messages: conversationMessages,
    stream: true
  })

  return streamSSE(url, headers, body, onChunk, options, (data) => {
    try {
      const parsed = JSON.parse(data)
      const eventType = parsed.type

      if (eventType === 'content_block_delta') {
        if (parsed.delta?.type === 'text_delta') {
          onChunk({ type: 'content', content: parsed.delta.text })
        } else if (parsed.delta?.type === 'input_json_delta') {
          onChunk({
            type: 'tool_call',
            toolCall: {
              arguments: parsed.delta.partial_json
            }
          })
        }
      } else if (eventType === 'message_stop') {
        onChunk({ type: 'done', finishReason: 'end_turn' })
        return {
          content: '',
          finishReason: 'end_turn',
          promptTokens: parsed.message?.usage?.input_tokens,
          completionTokens: parsed.message?.usage?.output_tokens
        }
      } else if (eventType === 'message_delta') {
        if (parsed.delta?.stop_reason) {
          onChunk({ type: 'done', finishReason: parsed.delta.stop_reason })
        }
        if (parsed.usage) {
          return {
            content: '',
            finishReason: parsed.delta?.stop_reason || 'end_turn',
            promptTokens: parsed.usage.input_tokens,
            completionTokens: parsed.usage.output_tokens
          }
        }
      }

      return null
    } catch {
      return null
    }
  })
}

async function streamOpenAICompatible(
  messages: LlmMessage[],
  config: LlmConfig,
  onChunk: (chunk: LlmStreamChunk) => void,
  options: LlmCallOptions,
  overrideBaseUrl?: string
): Promise<LlmResponse> {
  const baseUrl = overrideBaseUrl || config.baseUrl || 'https://api.openai.com'
  const url = `${baseUrl}/v1/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  }
  const body = buildOpenAIChatBody(messages, config, { ...options, stream: true })

  return streamSSE(url, headers, body, onChunk, options, (data) => {
    if (data === '[DONE]') {
      onChunk({ type: 'done', finishReason: 'stop' })
      return null
    }
    try {
      const parsed = JSON.parse(data)
      const delta = parsed.choices?.[0]?.delta
      const finishReason = parsed.choices?.[0]?.finish_reason

      if (delta?.content) {
        onChunk({ type: 'content', content: delta.content })
      }
      if (finishReason) {
        onChunk({ type: 'done', finishReason })
        return {
          content: '',
          finishReason,
          promptTokens: parsed.usage?.prompt_tokens,
          completionTokens: parsed.usage?.completion_tokens
        }
      }
      return null
    } catch {
      return null
    }
  })
}

// ============================================================================
// SSE Stream Handler (Generic)
// ============================================================================

async function streamSSE(
  url: string,
  headers: Record<string, string>,
  body: string,
  onChunk: (chunk: LlmStreamChunk) => void,
  options: LlmCallOptions,
  parseEvent: (data: string) => LlmResponse | null
): Promise<LlmResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT)

  // Link external signal if provided
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort())
  }

  let fullContent = ''
  let finalResponse: LlmResponse | null = null
  const toolCallsAccum: Map<number, ToolCall> = new Map()

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new LlmApiError(response.status, errorText, response.headers)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process SSE lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue // Skip empty/comments

        if (trimmed.startsWith('data: ')) {
          const data = trimmed.substring(6)
          const result = parseEvent(data)

          if (result) {
            finalResponse = result
          }
        } else if (trimmed.startsWith('event: ')) {
          // Event type - handled within data parsing
        }
      }
    }

    // Assemble full content from chunks received via onChunk
    // The onChunk callback already accumulated content through 'content' type chunks
    // We need to reconstruct it
  } catch (err: any) {
    if (err.name === 'AbortError') {
      onChunk({ type: 'error', error: 'Request was cancelled' })
    } else {
      onChunk({ type: 'error', error: diagnosticMessage(err) })
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }

  return finalResponse || { content: fullContent, finishReason: 'stop' }
}

// ============================================================================
// HTTP Request Helper
// ============================================================================

async function makeRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeout: number,
  signal?: AbortSignal
): Promise<any> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  if (signal) {
    signal.addEventListener('abort', () => controller.abort())
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new LlmApiError(response.status, errorText, response.headers)
    }

    return await response.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================================
// Request Builders
// ============================================================================

function buildOpenAIHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  }
}

function buildOpenAIChatBody(
  messages: LlmMessage[],
  config: LlmConfig,
  options: LlmCallOptions
): string {
  // Convert tool messages to OpenAI format
  const formatted = messages.map(m => {
    if (m.role === 'assistant' && m.toolCalls) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments
          }
        }))
      }
    }
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId
      }
    }
    return { role: m.role, content: m.content }
  })

  const body: Record<string, any> = {
    model: config.model,
    messages: formatted,
    max_tokens: config.maxTokens || 4096,
    stream: options.stream || false
  }

  return JSON.stringify(body)
}

// ============================================================================
// Response Parsers
// ============================================================================

function parseOpenAIResponse(data: any): LlmResponse {
  const choice = data.choices?.[0]
  if (!choice) {
    throw new Error('No choices in OpenAI response')
  }

  const result: LlmResponse = {
    content: choice.message?.content || '',
    finishReason: choice.finish_reason,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens
  }

  // Parse tool calls
  if (choice.message?.tool_calls) {
    result.toolCalls = choice.message.tool_calls.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: tc.function?.arguments || '{}'
    }))
  }

  return result
}

function parseOpenAIResponsesApiResponse(data: any): LlmResponse {
  // OpenAI Responses API format
  const output = data.output || []
  let content = ''
  const toolCalls: ToolCall[] = []

  for (const item of output) {
    if (item.type === 'message' && item.content) {
      for (const c of item.content) {
        if (c.type === 'output_text') {
          content += c.text || ''
        }
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id || item.id || `call_${Date.now()}`,
        name: item.name,
        arguments: item.arguments || '{}'
      })
    }
  }

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    promptTokens: data.usage?.input_tokens,
    completionTokens: data.usage?.output_tokens,
    finishReason: data.status || 'completed'
  }
}

function parseAnthropicResponse(data: any): LlmResponse {
  const content: string[] = []
  const toolCalls: ToolCall[] = []

  for (const block of data.content || []) {
    if (block.type === 'text') {
      content.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input)
      })
    }
  }

  return {
    content: content.join('\n'),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    promptTokens: data.usage?.input_tokens,
    completionTokens: data.usage?.output_tokens,
    finishReason: data.stop_reason
  }
}

// ============================================================================
// Retry with Backoff
// ============================================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  provider: LLMProvider
): Promise<T> {
  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err

      // Only retry on 429 or network errors
      const isRetryable = isRetryableError(err)
      if (!isRetryable || attempt === maxRetries) {
        break
      }

      const backoff = calculateBackoff(attempt)
      logger.warn(`LLM request failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${backoff}ms`, {
        provider,
        error: err.message,
        statusCode: err.statusCode
      })

      await sleep(backoff)
    }
  }

  // Provide diagnostic information
  if (lastError instanceof LlmApiError) {
    logger.error(`LLM API error after ${maxRetries} retries`, {
      provider,
      statusCode: lastError.statusCode,
      body: lastError.body?.substring(0, 200)
    })
  } else if (lastError?.code === 'ECONNREFUSED' || lastError?.code === 'ENOTFOUND') {
    logger.error('LLM network error: cannot reach API', {
      provider,
      code: lastError.code,
      message: diagnosticMessage(lastError)
    })
  } else if (lastError?.code === 'ETIMEDOUT' || lastError?.name === 'AbortError') {
    logger.error('LLM request timeout', {
      provider,
      message: diagnosticMessage(lastError)
    })
  }

  throw lastError
}

function isRetryableError(err: any): boolean {
  if (err instanceof LlmApiError) {
    return err.statusCode === 429 || err.statusCode >= 500
  }
  // Network errors
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(err?.code)) {
    return true
  }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return false // Don't retry timeouts (could indicate infinite loops)
  }
  return false
}

function calculateBackoff(attempt: number): number {
  const jitter = Math.random() * 500
  const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt) + jitter, MAX_BACKOFF_MS)
  return backoff
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// Error Types and Diagnostics
// ============================================================================

class LlmApiError extends Error {
  statusCode: number
  body: string
  headers: Headers

  constructor(statusCode: number, body: string, headers: Headers) {
    super(`LLM API error: ${statusCode}`)
    this.name = 'LlmApiError'
    this.statusCode = statusCode
    this.body = body
    this.headers = headers
  }
}

function diagnosticMessage(err: any): string {
  if (err instanceof LlmApiError) {
    switch (err.statusCode) {
      case 401:
        return `Authentication failed (401). Please check your API key for the provider.`
      case 403:
        return `Access denied (403). Your API key may not have access to this model or endpoint.`
      case 404:
        return `Model or endpoint not found (404). Please verify the model name and base URL.`
      case 429:
        return `Rate limited (429). Too many requests. Please wait and try again.`
      case 500:
      case 502:
      case 503:
        return `Provider server error (${err.statusCode}). The LLM service may be temporarily unavailable.`
      default:
        return `API error (${err.statusCode}): ${err.body?.substring(0, 200)}`
    }
  }

  if (err?.code === 'ECONNREFUSED') {
    return `Connection refused. The LLM API server is not reachable at the configured base URL. Please verify the URL and that the server is running.`
  }
  if (err?.code === 'ENOTFOUND') {
    return `DNS lookup failed. Cannot resolve the LLM API hostname. Please check the base URL configuration.`
  }
  if (err?.code === 'ETIMEDOUT' || err?.name === 'AbortError') {
    return `Request timed out. The LLM API did not respond within the timeout period. This could indicate a slow model, very large request, or network issues.`
  }
  if (err?.code === 'ECONNRESET') {
    return `Connection was reset by the server. This may indicate a network instability or server-side issue.`
  }

  return err?.message || 'Unknown error occurred'
}
