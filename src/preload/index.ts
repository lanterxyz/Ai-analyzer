// ============================================================================
// Preload Script - Main Window
// Exposes electronAPI via contextBridge for secure IPC communication
// ============================================================================

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, RENDERER_EVENTS } from '../shared/types'

const listenerMap = new Map<(...args: any[]) => void, (...args: any[]) => void>()

const api = {
  // --- Core IPC helpers ---
  invoke(channel: string, ...args: any[]): Promise<any> {
    return ipcRenderer.invoke(channel, ...args)
  },

  send(channel: string, ...args: any[]): void {
    ipcRenderer.send(channel, ...args)
  },

  on(channel: string, callback: (...args: any[]) => void): () => void {
    const handler = (_event: any, ...args: any[]) => callback(...args)
    listenerMap.set(callback, handler)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
      listenerMap.delete(callback)
    }
  },

  off(channel: string, callback: (...args: any[]) => void): void {
    const handler = listenerMap.get(callback)
    if (handler) {
      ipcRenderer.removeListener(channel, handler)
      listenerMap.delete(callback)
    }
  },

  getPlatform(): string {
    return process.platform
  },

  // --- Session ---
  session: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
    create: (data: { name: string; targetUrl?: string; proxyPort?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, data),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, id),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET, id),
    rename: (id: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_RENAME, id, name)
  },

  // --- Capture ---
  capture: {
    start: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_START, sessionId),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_STOP),
    pause: () => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_PAUSE),
    resume: () => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_RESUME)
  },

  // --- Requests ---
  request: {
    list: (sessionId: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.REQUEST_LIST, sessionId, offset, limit),
    detail: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.REQUEST_DETAIL, id),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.REQUEST_DELETE, id),
    export: (ids: string[], format: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.REQUEST_EXPORT, ids, format),
    filter: (sessionId: string, filters: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.REQUEST_FILTER, sessionId, filters)
  },

  // --- Hooks ---
  hook: {
    list: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.HOOK_LIST, sessionId),
    detail: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.HOOK_DETAIL, requestId)
  },

  // --- Storage ---
  storage: {
    latest: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_LATEST, sessionId),
    diff: (sessionId: string, id1: string, id2: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DIFF, sessionId, id1, id2)
  },

  // --- AI Analysis ---
  analysis: {
    run: (sessionId: string, config: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYSIS_RUN, sessionId, config),
    cancel: (analysisId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYSIS_CANCEL, analysisId),
    list: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.ANALYSIS_LIST, sessionId),
    get: (reportId: string) => ipcRenderer.invoke(IPC_CHANNELS.ANALYSIS_GET, reportId)
  },

  // --- Chat ---
  chat: {
    send: (reportId: string, message: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, reportId, message),
    history: (reportId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_HISTORY, reportId)
  },

  // --- AI Logs ---
  aiLog: {
    list: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_LOG_LIST, sessionId)
  },

  // --- Browser ---
  browser: {
    navigate: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_NAVIGATE, url),
    back: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BACK),
    forward: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FORWARD),
    reload: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_RELOAD),
    clearEnv: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_ENV)
  },

  // --- Tabs ---
  tab: {
    create: (tabId: string, url?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, tabId, url),
    close: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, tabId),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.TAB_LIST),
    switch: (tabId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAB_SWITCH, tabId)
  },

  // --- Proxy ---
  proxy: {
    start: (port: number) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_START, port),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STOP),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STATUS),
    config: (cfg: any) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_CONFIG, cfg)
  },

  // --- System Proxy ---
  systemProxy: {
    set: (host: string, port: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_PROXY_SET, host, port),
    unset: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_PROXY_UNSET)
  },

  // --- CA ---
  ca: {
    install: () => ipcRenderer.invoke(IPC_CHANNELS.CA_INSTALL),
    uninstall: () => ipcRenderer.invoke(IPC_CHANNELS.CA_UNINSTALL),
    regenerate: () => ipcRenderer.invoke(IPC_CHANNELS.CA_REGENERATE),
    export: () => ipcRenderer.invoke(IPC_CHANNELS.CA_EXPORT),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.CA_STATUS)
  },

  // --- Settings ---
  config: {
    get: (key?: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET, key),
    set: (key: string, value: any) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, key, value)
  },

  // --- LLM ---
  llm: {
    config: (cfg?: any) => ipcRenderer.invoke(IPC_CHANNELS.LLM_CONFIG, cfg),
    test: (cfg: any) => ipcRenderer.invoke(IPC_CHANNELS.LLM_TEST, cfg)
  },

  // --- MCP ---
  mcp: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST),
    add: (config: any) => ipcRenderer.invoke(IPC_CHANNELS.MCP_ADD, config),
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_REMOVE, id),
    update: (id: string, config: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_UPDATE, id, config),
    status: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_STATUS, id)
  },

  // --- Interceptors ---
  interceptor: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.INTERCEPTOR_LIST),
    save: (name: string, enabled: boolean, configJson?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INTERCEPTOR_SAVE, name, enabled, configJson),
    delete: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.INTERCEPTOR_DELETE, name),
    reorder: (order: string[]) => ipcRenderer.invoke(IPC_CHANNELS.INTERCEPTOR_REORDER, order)
  },

  // --- Hosts ---
  hosts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.HOSTS_LIST),
    save: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.HOSTS_SAVE, rule),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.HOSTS_DELETE, id)
  },

  // --- Request Map ---
  requestMap: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.REQUEST_MAP_LIST),
    save: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.REQUEST_MAP_SAVE, rule),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.REQUEST_MAP_DELETE, id)
  },

  // --- Rewrite ---
  rewrite: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULE_LIST),
    save: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULE_SAVE, rule),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.REWRITE_RULE_DELETE, id)
  },

  // --- Script ---
  script: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SCRIPT_LIST),
    save: (s: any) => ipcRenderer.invoke(IPC_CHANNELS.SCRIPT_SAVE, s),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.SCRIPT_DELETE, id)
  },

  // --- Block ---
  block: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.BLOCK_RULE_LIST),
    save: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.BLOCK_RULE_SAVE, rule),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.BLOCK_RULE_DELETE, id)
  },

  // --- Breakpoint ---
  breakpoint: {
    ruleList: () => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_RULE_LIST),
    ruleSave: (rule: any) => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_RULE_SAVE, rule),
    ruleDelete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_RULE_DELETE, id),
    continue: (requestId: string, modified?: any) =>
      ipcRenderer.send(IPC_CHANNELS.BREAKPOINT_CONTINUE, requestId, modified),
    edit: (requestId: string, modified: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_EDIT, requestId, modified)
  },

  // --- Report Server ---
  reportServer: {
    config: (cfg?: any) => ipcRenderer.invoke(IPC_CHANNELS.REPORT_SERVER_CONFIG, cfg)
  },

  // --- AES Decrypt ---
  aesDecrypt: {
    config: (cfg?: any) => ipcRenderer.invoke(IPC_CHANNELS.AES_DECRYPT_CONFIG, cfg)
  },

  // --- Favorites ---
  favorite: {
    add: (sessionId: string, requestId: string, label?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FAVORITE_ADD, sessionId, requestId, label),
    remove: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.FAVORITE_REMOVE, id),
    list: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.FAVORITE_LIST, sessionId)
  },

  // --- Domain Filter ---
  domainFilter: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.DOMAIN_FILTER_LIST),
    save: (domain: string, enabled?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.DOMAIN_FILTER_SAVE, domain, enabled),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DOMAIN_FILTER_DELETE, id)
  },

  // --- Prompt Templates ---
  promptTemplate: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_TEMPLATE_LIST),
    save: (template: any) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_TEMPLATE_SAVE, template),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_TEMPLATE_DELETE, id)
  },

  // --- Toolbox ---
  toolbox: {
    aesEncrypt: (data: string, keyHex: string, ivHex?: string, algorithm?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TOOLBOX_AES_ENCRYPT, data, keyHex, ivHex, algorithm),
    aesDecrypt: (data: string, keyHex: string, ivHex?: string, algorithm?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TOOLBOX_AES_DECRYPT, data, keyHex, ivHex, algorithm),
    certHash: (certPem: string) => ipcRenderer.invoke(IPC_CHANNELS.TOOLBOX_CERT_HASH, certPem),
    jsRun: (code: string, context?: Record<string, any>) =>
      ipcRenderer.invoke(IPC_CHANNELS.TOOLBOX_JS_RUN, code, context)
  },

  // --- HAR ---
  har: {
    export: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.HAR_EXPORT, sessionId),
    import: (harJson: string, sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.HAR_IMPORT, harJson, sessionId)
  },

  // --- cURL / Fetch ---
  curl: {
    generate: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.CURL_GENERATE, requestId)
  },
  fetch: {
    generate: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.FETCH_GENERATE, requestId)
  },

  // --- Fingerprint ---
  fingerprint: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT_LIST),
    save: (profile: any) => ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT_SAVE, profile),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT_DELETE, id),
    apply: (profileId: string) => ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT_APPLY, profileId)
  },

  // --- Interaction ---
  interaction: {
    recordStart: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INTERACTION_RECORD_START, sessionId),
    recordStop: () => ipcRenderer.invoke(IPC_CHANNELS.INTERACTION_RECORD_STOP),
    get: () => ipcRenderer.invoke(IPC_CHANNELS.INTERACTION_GET),
    replay: (events: any[], speed?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.INTERACTION_REPLAY, events, speed)
  },

  // --- Window ---
  window: {
    minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
  }
}

// Expose to renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', api)

// ============================================================================
// Forward renderer-bound events from main process
// ============================================================================

// These events are emitted by the main process and need to be relayed
// to the renderer through the preload's contextBridge-exposed API.
const rendererEventChannels = [
  RENDERER_EVENTS.REQUEST_CAPTURED,
  RENDERER_EVENTS.REQUEST_UPDATED,
  RENDERER_EVENTS.HOOK_CAPTURED,
  RENDERER_EVENTS.STORAGE_CAPTURED,
  RENDERER_EVENTS.CAPTURE_STATE_CHANGED,
  RENDERER_EVENTS.ANALYSIS_PROGRESS,
  RENDERER_EVENTS.ANALYSIS_COMPLETE,
  RENDERER_EVENTS.CHAT_PROGRESS,
  RENDERER_EVENTS.CHAT_COMPLETE,
  RENDERER_EVENTS.BREAKPOINT_HIT,
  RENDERER_EVENTS.PROXY_STATUS_CHANGED,
  RENDERER_EVENTS.TAB_UPDATED,
  RENDERER_EVENTS.INTERACTION_CAPTURED
] as const

// Build a unified event listener map on the exposed API
// The renderer can subscribe to these events via electronAPI.on()
for (const channel of rendererEventChannels) {
  // Pre-register listeners so the renderer can subscribe later
  // The actual subscription happens when the renderer calls electronAPI.on()
}
