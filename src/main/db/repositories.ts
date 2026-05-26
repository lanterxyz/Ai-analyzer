// Typed repository classes with prepared statements
import Database from 'better-sqlite3'
import { getDatabase } from './database'
import {
  Session, CapturedRequest, JsHookRecord, StorageSnapshot,
  AnalysisReport, ChatMessage, AiRequestLog, FingerprintProfile,
  InteractionEvent, FavoriteRequest, DomainFilter,
  InterceptorConfig, HostsRule, RequestMapRule, RewriteRule,
  BlockRule, BreakpointRule, InterceptorScript, PromptTemplate,
  McpServerConfig, CaptureState
} from '@shared/types'
import { v4 as uuid } from 'uuid'

// ============================================================================
// Session Repository
// ============================================================================

export class SessionRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  list(): Session[] {
    return this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Session[]
  }

  getById(id: string): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined
  }

  create(data: { name: string; targetUrl?: string; proxyPort?: number }): Session {
    const now = Date.now()
    const session: Session = {
      id: uuid(),
      name: data.name,
      targetUrl: data.targetUrl ?? null,
      state: CaptureState.IDLE,
      proxyEnabled: false,
      proxyPort: data.proxyPort ?? 8888,
      systemProxyEnabled: false,
      caInstalled: false,
      fingerprintProfileId: null,
      createdAt: now,
      updatedAt: now
    }
    this.db.prepare(`
      INSERT INTO sessions (id, name, target_url, state, proxy_enabled, proxy_port, system_proxy_enabled, ca_installed, fingerprint_profile_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id, session.name, session.targetUrl, session.state,
      session.proxyEnabled ? 1 : 0, session.proxyPort,
      session.systemProxyEnabled ? 1 : 0, session.caInstalled ? 1 : 0,
      session.fingerprintProfileId, session.createdAt, session.updatedAt
    )
    return session
  }

  updateState(id: string, state: CaptureState): void {
    this.db.prepare('UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, Date.now(), id)
  }

  updateProxy(id: string, enabled: boolean, port: number, systemProxy: boolean, caInstalled: boolean): void {
    this.db.prepare(`
      UPDATE sessions SET proxy_enabled = ?, proxy_port = ?, system_proxy_enabled = ?, ca_installed = ?, updated_at = ? WHERE id = ?
    `).run(enabled ? 1 : 0, port, systemProxy ? 1 : 0, caInstalled ? 1 : 0, Date.now(), id)
  }

  rename(id: string, name: string): void {
    this.db.prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, Date.now(), id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }
}

// ============================================================================
// Request Repository
// ============================================================================

export class RequestRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  listBySession(sessionId: string, offset = 0, limit = 500): CapturedRequest[] {
    return this.db.prepare(
      'SELECT * FROM requests WHERE session_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?'
    ).all(sessionId, limit, offset) as CapturedRequest[]
  }

  countBySession(sessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM requests WHERE session_id = ?').get(sessionId) as { cnt: number }
    return row.cnt
  }

  getById(id: string): CapturedRequest | undefined {
    return this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as CapturedRequest | undefined
  }

  getBySeq(sessionId: string, seq: number): CapturedRequest | undefined {
    return this.db.prepare('SELECT * FROM requests WHERE session_id = ? AND seq = ?').get(sessionId, seq) as CapturedRequest | undefined
  }

  insert(req: CapturedRequest): void {
    this.db.prepare(`
      INSERT INTO requests (id, session_id, seq, source, method, url, hostname, path,
        status_code, content_type, request_headers, request_body, response_headers,
        response_body, response_encoding, is_streaming, is_websocket, timing, tab_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.id, req.sessionId, req.seq, req.source, req.method, req.url,
      req.hostname, req.path, req.statusCode, req.contentType,
      JSON.stringify(req.requestHeaders), req.requestBody,
      req.responseHeaders ? JSON.stringify(req.responseHeaders) : null,
      req.responseBody, req.responseEncoding,
      req.isStreaming ? 1 : 0, req.isWebsocket ? 1 : 0,
      req.timing ? JSON.stringify(req.timing) : null,
      req.tabId, req.createdAt
    )
  }

  updateResponse(id: string, statusCode: number | null, headers: Record<string, string> | null, body: string | null, encoding: string | null): void {
    this.db.prepare(`
      UPDATE requests SET status_code = ?, response_headers = ?, response_body = ?, response_encoding = ? WHERE id = ?
    `).run(statusCode, headers ? JSON.stringify(headers) : null, body, encoding, id)
  }

  filterByHostname(sessionId: string, hostname: string): CapturedRequest[] {
    return this.db.prepare(
      'SELECT * FROM requests WHERE session_id = ? AND hostname LIKE ? ORDER BY seq ASC'
    ).all(sessionId, `%${hostname}%`) as CapturedRequest[]
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM requests WHERE session_id = ?').run(sessionId)
  }
}

// ============================================================================
// JS Hook Repository
// ============================================================================

export class HookRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  listBySession(sessionId: string): JsHookRecord[] {
    return this.db.prepare('SELECT * FROM js_hooks WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId) as JsHookRecord[]
  }

  getByRequestId(requestId: string): JsHookRecord[] {
    return this.db.prepare('SELECT * FROM js_hooks WHERE request_id = ? ORDER BY timestamp ASC')
      .all(requestId) as JsHookRecord[]
  }

  insert(hook: JsHookRecord): void {
    this.db.prepare(`
      INSERT INTO js_hooks (id, session_id, request_id, hook_type, function_name, args, return_value, call_stack, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hook.id, hook.sessionId, hook.requestId, hook.hookType, hook.functionName, hook.args, hook.returnValue, hook.callStack, hook.timestamp)
  }
}

// ============================================================================
// Storage Snapshot Repository
// ============================================================================

export class StorageSnapshotRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  listBySession(sessionId: string): StorageSnapshot[] {
    return this.db.prepare('SELECT * FROM storage_snapshots WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId) as StorageSnapshot[]
  }

  getLatest(sessionId: string): StorageSnapshot | undefined {
    return this.db.prepare('SELECT * FROM storage_snapshots WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1')
      .get(sessionId) as StorageSnapshot | undefined
  }

  insert(snapshot: StorageSnapshot): void {
    this.db.prepare(`
      INSERT INTO storage_snapshots (id, session_id, cookies, local_storage, session_storage, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(snapshot.id, snapshot.sessionId, JSON.stringify(snapshot.cookies), JSON.stringify(snapshot.localStorage), JSON.stringify(snapshot.sessionStorage), snapshot.timestamp)
  }
}

// ============================================================================
// Analysis Report Repository
// ============================================================================

export class ReportRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  listBySession(sessionId: string): AnalysisReport[] {
    return this.db.prepare('SELECT * FROM analysis_reports WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as AnalysisReport[]
  }

  getById(id: string): AnalysisReport | undefined {
    return this.db.prepare('SELECT * FROM analysis_reports WHERE id = ?').get(id) as AnalysisReport | undefined
  }

  insert(report: AnalysisReport): void {
    this.db.prepare(`
      INSERT INTO analysis_reports (id, session_id, mode, content, prompt_tokens, completion_tokens, filter_prompt_tokens, filter_completion_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(report.id, report.sessionId, report.mode, report.content, report.promptTokens, report.completionTokens, report.filterPromptTokens, report.filterCompletionTokens, report.createdAt)
  }
}

// ============================================================================
// Chat Message Repository
// ============================================================================

export class ChatMessageRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  listByReport(reportId: string): ChatMessage[] {
    return this.db.prepare('SELECT * FROM chat_messages WHERE report_id = ? ORDER BY created_at ASC')
      .all(reportId) as ChatMessage[]
  }

  insert(msg: ChatMessage): void {
    this.db.prepare(`
      INSERT INTO chat_messages (id, report_id, role, content, tool_calls, tool_results, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(msg.id, msg.reportId, msg.role, msg.content, msg.toolCalls, msg.toolResults, msg.createdAt)
  }
}

// ============================================================================
// AI Request Log Repository
// ============================================================================

export class AiRequestLogRepo {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  listBySession(sessionId: string): AiRequestLog[] {
    return this.db.prepare('SELECT * FROM ai_request_logs WHERE session_id = ? ORDER BY timestamp DESC')
      .all(sessionId) as AiRequestLog[]
  }

  insert(log: AiRequestLog): void {
    this.db.prepare(`
      INSERT INTO ai_request_logs (id, session_id, provider, model, direction, url, headers, body, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(log.id, log.sessionId, log.provider, log.model, log.direction, log.url, JSON.stringify(log.headers), log.body, log.timestamp)
  }
}

// ============================================================================
// Interceptor Repositories
// ============================================================================

export class InterceptorConfigRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): InterceptorConfig[] {
    return this.db.prepare('SELECT * FROM interceptor_config ORDER BY sort_order').all() as InterceptorConfig[]
  }

  save(ic: InterceptorConfig): void {
    this.db.prepare(`
      INSERT INTO interceptor_config (name, enabled, sort_order, config_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET enabled = ?, sort_order = ?, config_json = ?
    `).run(ic.name, ic.enabled ? 1 : 0, ic.order, ic.configJson, ic.enabled ? 1 : 0, ic.order, ic.configJson)
  }
}

export class HostsRuleRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): HostsRule[] {
    return this.db.prepare('SELECT * FROM hosts_rules ORDER BY id').all() as HostsRule[]
  }

  save(rule: Omit<HostsRule, 'id'>): HostsRule {
    const result = this.db.prepare('INSERT INTO hosts_rules (enabled, hostname, ip) VALUES (?, ?, ?) ON CONFLICT(hostname) DO UPDATE SET enabled = ?, ip = ?')
      .run(rule.enabled ? 1 : 0, rule.hostname, rule.ip, rule.enabled ? 1 : 0, rule.ip)
    return { id: Number(result.lastInsertRowid), ...rule }
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM hosts_rules WHERE id = ?').run(id)
  }
}

export class RequestMapRuleRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): RequestMapRule[] {
    return this.db.prepare('SELECT * FROM request_map_rules ORDER BY id').all() as RequestMapRule[]
  }

  save(rule: Omit<RequestMapRule, 'id'>): RequestMapRule {
    const result = this.db.prepare(`
      INSERT INTO request_map_rules (enabled, url_pattern, method, mode, file_path, script_body, status_code, content_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(rule.enabled ? 1 : 0, rule.urlPattern, rule.method, rule.mode, rule.filePath, rule.scriptBody, rule.statusCode, rule.contentType)
    return { id: Number(result.lastInsertRowid), ...rule }
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM request_map_rules WHERE id = ?').run(id)
  }
}

export class RewriteRuleRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): RewriteRule[] {
    return this.db.prepare('SELECT * FROM rewrite_rules ORDER BY id').all() as RewriteRule[]
  }

  save(rule: Omit<RewriteRule, 'id'>): RewriteRule {
    const result = this.db.prepare(`
      INSERT INTO rewrite_rules (enabled, direction, url_pattern, header_add, header_remove, header_replace, body_replace, redirect_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(rule.enabled ? 1 : 0, rule.direction, rule.urlPattern, rule.headerAdd, rule.headerRemove, rule.headerReplace, rule.bodyReplace, rule.redirectUrl)
    return { id: Number(result.lastInsertRowid), ...rule }
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM rewrite_rules WHERE id = ?').run(id)
  }
}

export class BlockRuleRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): BlockRule[] {
    return this.db.prepare('SELECT * FROM block_rules ORDER BY id').all() as BlockRule[]
  }

  save(rule: Omit<BlockRule, 'id'>): BlockRule {
    const result = this.db.prepare('INSERT INTO block_rules (enabled, url_pattern, method, action) VALUES (?, ?, ?, ?)')
      .run(rule.enabled ? 1 : 0, rule.urlPattern, rule.method, rule.action)
    return { id: Number(result.lastInsertRowid), ...rule }
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM block_rules WHERE id = ?').run(id)
  }
}

export class BreakpointRuleRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): BreakpointRule[] {
    return this.db.prepare('SELECT * FROM breakpoint_rules ORDER BY id').all() as BreakpointRule[]
  }

  save(rule: Omit<BreakpointRule, 'id'>): BreakpointRule {
    const result = this.db.prepare('INSERT INTO breakpoint_rules (enabled, url_pattern, direction) VALUES (?, ?, ?)')
      .run(rule.enabled ? 1 : 0, rule.urlPattern, rule.direction)
    return { id: Number(result.lastInsertRowid), ...rule }
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM breakpoint_rules WHERE id = ?').run(id)
  }
}

export class InterceptorScriptRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): InterceptorScript[] {
    return this.db.prepare('SELECT * FROM interceptor_scripts ORDER BY id').all() as InterceptorScript[]
  }

  save(script: Omit<InterceptorScript, 'id'>): InterceptorScript {
    const result = this.db.prepare('INSERT INTO interceptor_scripts (enabled, name, script_body, url_pattern) VALUES (?, ?, ?, ?)')
      .run(script.enabled ? 1 : 0, script.name, script.scriptBody, script.urlPattern)
    return { id: Number(result.lastInsertRowid), ...script }
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM interceptor_scripts WHERE id = ?').run(id)
  }
}

// ============================================================================
// Favorite / Domain Filter Repositories
// ============================================================================

export class FavoriteRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(sessionId: string): FavoriteRequest[] {
    return this.db.prepare('SELECT * FROM favorite_requests WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as FavoriteRequest[]
  }

  add(sessionId: string, requestId: string, label?: string): void {
    this.db.prepare('INSERT INTO favorite_requests (session_id, request_id, label, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, requestId, label ?? null, Date.now())
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM favorite_requests WHERE id = ?').run(id)
  }
}

export class DomainFilterRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): DomainFilter[] {
    return this.db.prepare('SELECT * FROM domain_filters ORDER BY id').all() as DomainFilter[]
  }

  save(domain: string, enabled = true): void {
    this.db.prepare('INSERT INTO domain_filters (domain, enabled) VALUES (?, ?) ON CONFLICT(domain) DO UPDATE SET enabled = ?')
      .run(domain, enabled ? 1 : 0, enabled ? 1 : 0)
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM domain_filters WHERE id = ?').run(id)
  }
}

// ============================================================================
// Prompt Template Repository
// ============================================================================

export class PromptTemplateRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  list(): PromptTemplate[] {
    return this.db.prepare('SELECT * FROM prompt_templates ORDER BY name').all() as PromptTemplate[]
  }

  save(template: PromptTemplate): void {
    this.db.prepare(`
      INSERT INTO prompt_templates (id, name, mode, system_prompt, requirements, is_built_in)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = ?, mode = ?, system_prompt = ?, requirements = ?
    `).run(template.id, template.name, template.mode, template.systemPrompt, template.requirements, template.isBuiltIn ? 1 : 0, template.name, template.mode, template.systemPrompt, template.requirements)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM prompt_templates WHERE id = ? AND is_built_in = 0').run(id)
  }
}

// ============================================================================
// AppConfig Repository
// ============================================================================

export class AppConfigRepo {
  private db: Database.Database
  constructor() { this.db = getDatabase() }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run(key, value, value)
  }
}
