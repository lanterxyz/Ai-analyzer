// ============================================================================
// Ai-analyzer Shared Types
// Master type definitions, IPC channels, enums, and utilities
// ============================================================================

// --- Enums ---

export enum CaptureSource {
  CDP = 'cdp',
  PROXY = 'proxy'
}

export enum CaptureState {
  IDLE = 'idle',
  CAPTURING = 'capturing',
  PAUSED = 'paused',
  STOPPED = 'stopped'
}

export enum AnalysisMode {
  AUTO = 'auto',
  API_REVERSE = 'api_reverse',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  CRYPTO = 'crypto',
  CUSTOM = 'custom'
}

export enum LLMProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  CUSTOM = 'custom',
  MINIMAX = 'minimax'
}

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD',
  TRACE = 'TRACE',
  CONNECT = 'CONNECT'
}

export enum HookType {
  FETCH = 'fetch',
  XHR = 'xhr',
  CRYPTO_SUBTLE = 'crypto_subtle',
  CRYPTOJS = 'cryptojs',
  SM2 = 'sm2',
  SM3 = 'sm3',
  SM4 = 'sm4',
  COOKIE = 'cookie'
}

export enum InterceptorType {
  HOSTS = 'hosts',
  REQUEST_MAP = 'request_map',
  REQUEST_REWRITE = 'request_rewrite',
  SCRIPT = 'script',
  REQUEST_BLOCK = 'request_block',
  BREAKPOINT = 'breakpoint',
  REPORT_SERVER = 'report_server',
  AES_DECRYPT = 'aes_decrypt'
}

export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark'
}

export enum Locale {
  ZH = 'zh',
  EN = 'en'
}

// --- Session Types ---

export interface Session {
  id: string
  name: string
  targetUrl: string | null
  state: CaptureState
  proxyEnabled: boolean
  proxyPort: number
  systemProxyEnabled: boolean
  caInstalled: boolean
  fingerprintProfileId: string | null
  createdAt: number
  updatedAt: number
}

// --- Request Types ---

export interface CapturedRequest {
  id: string
  sessionId: string
  seq: number
  source: CaptureSource
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
  responseEncoding: string | null
  isStreaming: boolean
  isWebsocket: boolean
  timing: RequestTiming | null
  tabId: string | null
  createdAt: number
}

export interface RequestTiming {
  dnsStart: number
  dnsEnd: number
  connectStart: number
  connectEnd: number
  tlsStart: number
  tlsEnd: number
  sendStart: number
  sendEnd: number
  receiveStart: number
  receiveEnd: number
}

// --- JS Hook Types ---

export interface JsHookRecord {
  id: string
  sessionId: string
  requestId: string | null
  hookType: HookType
  functionName: string
  args: string
  returnValue: string | null
  callStack: string
  timestamp: number
}

// --- Storage Types ---

export interface StorageSnapshot {
  id: string
  sessionId: string
  cookies: StorageEntry[]
  localStorage: StorageEntry[]
  sessionStorage: StorageEntry[]
  timestamp: number
}

export interface StorageEntry {
  key: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

export interface StorageDiff {
  cookies: DiffResult
  localStorage: DiffResult
  sessionStorage: DiffResult
}

export interface DiffResult {
  added: StorageEntry[]
  changed: StorageEntry[]
  removed: string[]
}

// --- AI Analysis Types ---

export interface AnalysisConfig {
  provider: LLMProvider
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  mode: AnalysisMode
  customPrompt: string | null
  customRequirements: string | null
  selectedSeqs: number[] | null
}

export interface AnalysisReport {
  id: string
  sessionId: string
  mode: AnalysisMode
  content: string
  promptTokens: number
  completionTokens: number
  filterPromptTokens: number | null
  filterCompletionTokens: number | null
  createdAt: number
}

export interface ChatMessage {
  id: string
  reportId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls: string | null
  toolResults: string | null
  createdAt: number
}

export interface AiRequestLog {
  id: string
  sessionId: string
  provider: LLMProvider
  model: string
  direction: 'request' | 'response'
  url: string
  headers: Record<string, string>
  body: string | null
  timestamp: number
}

// --- Scene Detection Types ---

export interface SceneHint {
  scene: string
  confidence: number
  evidence: string[]
}

// --- Interceptor Types ---

export interface InterceptorConfig {
  name: InterceptorType
  enabled: boolean
  order: number
  configJson: string | null
}

export interface ProxyContext {
  requestId: string
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody: string | null
  hostname: string
  port: number
  isTls: boolean
  statusCode: number | null
  responseHeaders: Record<string, string> | null
  responseBody: string | null
  shortCircuit: boolean
  blocked: boolean
  breakpoint: boolean
}

// --- Interceptor Rule Types ---

export interface HostsRule {
  id: number
  enabled: boolean
  hostname: string
  ip: string
}

export interface RequestMapRule {
  id: number
  enabled: boolean
  urlPattern: string
  method: string
  mode: 'file' | 'script'
  filePath: string | null
  scriptBody: string | null
  statusCode: number
  contentType: string
}

export interface RewriteRule {
  id: number
  enabled: boolean
  direction: 'request' | 'response'
  urlPattern: string
  headerAdd: string | null
  headerRemove: string | null
  headerReplace: string | null
  bodyReplace: string | null
  redirectUrl: string | null
}

export interface BlockRule {
  id: number
  enabled: boolean
  urlPattern: string
  method: string
  action: 'block' | 'abort'
}

export interface BreakpointRule {
  id: number
  enabled: boolean
  urlPattern: string
  direction: 'request' | 'response' | 'both'
}

export interface InterceptorScript {
  id: number
  enabled: boolean
  name: string
  scriptBody: string
  urlPattern: string
}

export interface ReportServerConfig {
  enabled: boolean
  endpointUrl: string
  authHeader: string | null
  filterPattern: string | null
}

export interface AesDecryptConfig {
  enabled: boolean
  algorithm: 'AES-CBC' | 'AES-ECB' | 'AES-GCM'
  keyHex: string
  ivHex: string | null
  direction: 'request' | 'response' | 'both'
}

// --- Fingerprint Types ---

export interface FingerprintProfile {
  id: string
  name: string
  userAgent: string
  platform: string
  language: string
  languages: string[]
  colorDepth: number
  deviceMemory: number
  hardwareConcurrency: number
  screenResolution: [number, number]
  availableScreenResolution: [number, number]
  timezoneOffset: number
  webglVendor: string
  webglRenderer: string
  isDefault: boolean
  createdAt: number
}

// --- Interaction Types ---

export interface InteractionEvent {
  id: string
  sessionId: string
  eventType: 'click' | 'input' | 'scroll' | 'keydown' | 'focus' | 'blur'
  selector: string
  value: string | null
  x: number | null
  y: number | null
  timestamp: number
}

// --- Favorite / Filter Types ---

export interface FavoriteRequest {
  id: number
  sessionId: string
  requestId: string
  label: string | null
  createdAt: number
}

export interface DomainFilter {
  id: number
  domain: string
  enabled: boolean
}

// --- Prompt Template Types ---

export interface PromptTemplate {
  id: string
  name: string
  mode: AnalysisMode
  systemPrompt: string
  requirements: string
  isBuiltIn: boolean
}

// --- MCP Types ---

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'streamable-http'
  command: string | null
  args: string[] | null
  url: string | null
  env: Record<string, string> | null
  enabled: boolean
}

// --- LLM Config Types ---

export interface LlmConfig {
  provider: LLMProvider
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
}

// --- Proxy Config Types ---

export interface ProxyConfig {
  enabled: boolean
  port: number
  systemProxyEnabled: boolean
  caInstalled: boolean
  upstreamProxy: UpstreamProxyConfig | null
}

export interface UpstreamProxyConfig {
  type: 'http' | 'socks5'
  host: string
  port: number
  username: string | null
  password: string | null
}

// --- App Config Types ---

export interface AppConfig {
  theme: ThemeMode
  locale: Locale
  llm: LlmConfig
  proxy: ProxyConfig
  autoUpdate: boolean
}

// --- IPC Channel Names ---

export const IPC_CHANNELS = {
  // Session
  SESSION_LIST: 'session:list',
  SESSION_CREATE: 'session:create',
  SESSION_DELETE: 'session:delete',
  SESSION_GET: 'session:get',
  SESSION_RENAME: 'session:rename',

  // Capture
  CAPTURE_START: 'capture:start',
  CAPTURE_STOP: 'capture:stop',
  CAPTURE_PAUSE: 'capture:pause',
  CAPTURE_RESUME: 'capture:resume',
  CAPTURE_STATE: 'capture:state',

  // Requests
  REQUEST_LIST: 'request:list',
  REQUEST_DETAIL: 'request:detail',
  REQUEST_DELETE: 'request:delete',
  REQUEST_EXPORT: 'request:export',
  REQUEST_FILTER: 'request:filter',

  // Hooks
  HOOK_LIST: 'hook:list',
  HOOK_DETAIL: 'hook:detail',

  // Storage
  STORAGE_LATEST: 'storage:latest',
  STORAGE_DIFF: 'storage:diff',

  // AI Analysis
  ANALYSIS_RUN: 'analysis:run',
  ANALYSIS_CANCEL: 'analysis:cancel',
  ANALYSIS_LIST: 'analysis:list',
  ANALYSIS_GET: 'analysis:get',
  CHAT_SEND: 'chat:send',
  CHAT_HISTORY: 'chat:history',
  AI_LOG_LIST: 'aiLog:list',

  // Browser control
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_CLEAR_ENV: 'browser:clearEnv',

  // Tabs
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_LIST: 'tab:list',
  TAB_SWITCH: 'tab:switch',

  // Proxy
  PROXY_START: 'proxy:start',
  PROXY_STOP: 'proxy:stop',
  PROXY_STATUS: 'proxy:status',
  PROXY_CONFIG: 'proxy:config',
  SYSTEM_PROXY_SET: 'systemProxy:set',
  SYSTEM_PROXY_UNSET: 'systemProxy:unset',

  // CA Certificate
  CA_INSTALL: 'ca:install',
  CA_UNINSTALL: 'ca:uninstall',
  CA_REGENERATE: 'ca:regenerate',
  CA_EXPORT: 'ca:export',
  CA_STATUS: 'ca:status',

  // Settings
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',

  // LLM
  LLM_CONFIG: 'llm:config',
  LLM_TEST: 'llm:test',

  // MCP
  MCP_LIST: 'mcp:list',
  MCP_ADD: 'mcp:add',
  MCP_REMOVE: 'mcp:remove',
  MCP_UPDATE: 'mcp:update',
  MCP_STATUS: 'mcp:status',

  // Interceptor chain
  INTERCEPTOR_LIST: 'interceptor:list',
  INTERCEPTOR_SAVE: 'interceptor:save',
  INTERCEPTOR_DELETE: 'interceptor:delete',
  INTERCEPTOR_REORDER: 'interceptor:reorder',

  // Interceptor-specific
  HOSTS_LIST: 'hosts:list',
  HOSTS_SAVE: 'hosts:save',
  HOSTS_DELETE: 'hosts:delete',

  REQUEST_MAP_LIST: 'requestMap:list',
  REQUEST_MAP_SAVE: 'requestMap:save',
  REQUEST_MAP_DELETE: 'requestMap:delete',

  REWRITE_RULE_LIST: 'rewrite:list',
  REWRITE_RULE_SAVE: 'rewrite:save',
  REWRITE_RULE_DELETE: 'rewrite:delete',

  SCRIPT_LIST: 'script:list',
  SCRIPT_SAVE: 'script:save',
  SCRIPT_DELETE: 'script:delete',

  BLOCK_RULE_LIST: 'block:list',
  BLOCK_RULE_SAVE: 'block:save',
  BLOCK_RULE_DELETE: 'block:delete',

  BREAKPOINT_RULE_LIST: 'breakpoint:list',
  BREAKPOINT_RULE_SAVE: 'breakpoint:save',
  BREAKPOINT_RULE_DELETE: 'breakpoint:delete',
  BREAKPOINT_CONTINUE: 'breakpoint:continue',
  BREAKPOINT_EDIT: 'breakpoint:edit',

  REPORT_SERVER_CONFIG: 'reportServer:config',

  AES_DECRYPT_CONFIG: 'aesDecrypt:config',

  // Favorites
  FAVORITE_ADD: 'favorite:add',
  FAVORITE_REMOVE: 'favorite:remove',
  FAVORITE_LIST: 'favorite:list',

  // Domain filter
  DOMAIN_FILTER_LIST: 'domainFilter:list',
  DOMAIN_FILTER_SAVE: 'domainFilter:save',
  DOMAIN_FILTER_DELETE: 'domainFilter:delete',

  // Prompt templates
  PROMPT_TEMPLATE_LIST: 'promptTemplate:list',
  PROMPT_TEMPLATE_SAVE: 'promptTemplate:save',
  PROMPT_TEMPLATE_DELETE: 'promptTemplate:delete',

  // Toolbox
  TOOLBOX_AES_ENCRYPT: 'toolbox:aesEncrypt',
  TOOLBOX_AES_DECRYPT: 'toolbox:aesDecrypt',
  TOOLBOX_CERT_HASH: 'toolbox:certHash',
  TOOLBOX_JS_RUN: 'toolbox:jsRun',

  // HAR
  HAR_EXPORT: 'har:export',
  HAR_IMPORT: 'har:import',

  // cURL / Fetch
  CURL_GENERATE: 'curl:generate',
  FETCH_GENERATE: 'fetch:generate',

  // Fingerprint
  FINGERPRINT_LIST: 'fingerprint:list',
  FINGERPRINT_SAVE: 'fingerprint:save',
  FINGERPRINT_DELETE: 'fingerprint:delete',
  FINGERPRINT_APPLY: 'fingerprint:apply',

  // Interaction
  INTERACTION_RECORD_START: 'interaction:recordStart',
  INTERACTION_RECORD_STOP: 'interaction:recordStop',
  INTERACTION_GET: 'interaction:get',
  INTERACTION_REPLAY: 'interaction:replay',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close'
} as const

// --- Event types from main to renderer ---

export const RENDERER_EVENTS = {
  REQUEST_CAPTURED: 'request:captured',
  REQUEST_UPDATED: 'request:updated',
  HOOK_CAPTURED: 'hook:captured',
  STORAGE_CAPTURED: 'storage:captured',
  CAPTURE_STATE_CHANGED: 'capture:stateChanged',
  ANALYSIS_PROGRESS: 'analysis:progress',
  ANALYSIS_COMPLETE: 'analysis:complete',
  CHAT_PROGRESS: 'chat:progress',
  CHAT_COMPLETE: 'chat:complete',
  BREAKPOINT_HIT: 'breakpoint:hit',
  PROXY_STATUS_CHANGED: 'proxy:statusChanged',
  TAB_UPDATED: 'tab:updated',
  INTERACTION_CAPTURED: 'interaction:captured'
} as const

// --- Utility types ---

export type IpcInvoke<K extends string> = (channel: K, ...args: any[]) => Promise<any>
export type IpcSend<K extends string> = (channel: K, ...args: any[]) => void

// --- Hook injection message types ---

export interface HookMessage {
  type: 'HOOK_CAPTURE'
  hookType: HookType
  functionName: string
  args: any[]
  returnValue: any
  callStack: string
  timestamp: number
}

export interface InteractionMessage {
  type: 'INTERACTION_CAPTURE'
  eventType: InteractionEvent['eventType']
  selector: string
  value: string | null
  x: number | null
  y: number | null
  timestamp: number
}

// Scene detection constants
export const SCENE_NAMES = [
  'ai-chat',
  'auth-oauth',
  'auth-token',
  'auth-session',
  'registration',
  'login',
  'websocket',
  'sse-stream',
  'api-general',
  'crypto-encryption'
] as const

export type SceneName = (typeof SCENE_NAMES)[number]