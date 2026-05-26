// Database schema migrations
import Database from 'better-sqlite3'
import { createLogger } from '../logger'

const logger = createLogger('migrations')

const MIGRATIONS: string[] = [
  // === Core tables from anything-analyzer ===

  `CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    target_url    TEXT,
    state         TEXT NOT NULL DEFAULT 'idle',
    proxy_enabled INTEGER NOT NULL DEFAULT 0,
    proxy_port    INTEGER NOT NULL DEFAULT 8888,
    system_proxy_enabled INTEGER NOT NULL DEFAULT 0,
    ca_installed  INTEGER NOT NULL DEFAULT 0,
    fingerprint_profile_id TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS requests (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    source          TEXT NOT NULL,
    method          TEXT NOT NULL,
    url             TEXT NOT NULL,
    hostname        TEXT NOT NULL,
    path            TEXT NOT NULL,
    status_code     INTEGER,
    content_type    TEXT,
    request_headers TEXT NOT NULL DEFAULT '{}',
    request_body    TEXT,
    response_headers TEXT,
    response_body   TEXT,
    response_encoding TEXT,
    is_streaming    INTEGER NOT NULL DEFAULT 0,
    is_websocket    INTEGER NOT NULL DEFAULT 0,
    timing          TEXT,
    tab_id          TEXT,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_hostname ON requests(session_id, hostname)`,

  `CREATE TABLE IF NOT EXISTS js_hooks (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    request_id    TEXT,
    hook_type     TEXT NOT NULL,
    function_name TEXT NOT NULL,
    args          TEXT NOT NULL DEFAULT '',
    return_value  TEXT,
    call_stack    TEXT NOT NULL DEFAULT '',
    timestamp     INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_js_hooks_session ON js_hooks(session_id, timestamp)`,

  `CREATE TABLE IF NOT EXISTS storage_snapshots (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    cookies       TEXT NOT NULL DEFAULT '[]',
    local_storage TEXT NOT NULL DEFAULT '[]',
    session_storage TEXT NOT NULL DEFAULT '[]',
    timestamp     INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_storage_snapshots_session ON storage_snapshots(session_id, timestamp)`,

  `CREATE TABLE IF NOT EXISTS analysis_reports (
    id                     TEXT PRIMARY KEY,
    session_id             TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    mode                   TEXT NOT NULL,
    content                TEXT NOT NULL,
    prompt_tokens          INTEGER NOT NULL DEFAULT 0,
    completion_tokens      INTEGER NOT NULL DEFAULT 0,
    filter_prompt_tokens   INTEGER,
    filter_completion_tokens INTEGER,
    created_at             INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
    id            TEXT PRIMARY KEY,
    report_id     TEXT NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    tool_calls    TEXT,
    tool_results  TEXT,
    created_at    INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chat_messages_report ON chat_messages(report_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS ai_request_logs (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    direction     TEXT NOT NULL,
    url           TEXT NOT NULL,
    headers       TEXT NOT NULL DEFAULT '{}',
    body          TEXT,
    timestamp     INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS fingerprint_profiles (
    id                          TEXT PRIMARY KEY,
    name                        TEXT NOT NULL,
    user_agent                  TEXT NOT NULL,
    platform                    TEXT NOT NULL,
    language                    TEXT NOT NULL,
    languages                   TEXT NOT NULL DEFAULT '[]',
    color_depth                 INTEGER NOT NULL DEFAULT 24,
    device_memory               INTEGER NOT NULL DEFAULT 8,
    hardware_concurrency        INTEGER NOT NULL DEFAULT 8,
    screen_resolution           TEXT NOT NULL DEFAULT '1920,1080',
    available_screen_resolution TEXT NOT NULL DEFAULT '1920,1040',
    timezone_offset             INTEGER NOT NULL DEFAULT -480,
    webgl_vendor                TEXT NOT NULL DEFAULT 'Google Inc.',
    webgl_renderer              TEXT NOT NULL DEFAULT 'ANGLE',
    is_default                  INTEGER NOT NULL DEFAULT 0,
    created_at                  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS interaction_events (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL,
    selector      TEXT NOT NULL,
    value         TEXT,
    x             REAL,
    y             REAL,
    timestamp     INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_interaction_events_session ON interaction_events(session_id, timestamp)`,

  // === Interceptor tables from proxypin concepts ===

  `CREATE TABLE IF NOT EXISTS interceptor_config (
    name        TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL,
    config_json TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS hosts_rules (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    enabled   INTEGER NOT NULL DEFAULT 1,
    hostname  TEXT NOT NULL UNIQUE,
    ip        TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS request_map_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    url_pattern   TEXT NOT NULL,
    method        TEXT NOT NULL DEFAULT '*',
    mode          TEXT NOT NULL DEFAULT 'file',
    file_path     TEXT,
    script_body   TEXT,
    status_code   INTEGER NOT NULL DEFAULT 200,
    content_type  TEXT NOT NULL DEFAULT 'application/json'
  )`,

  `CREATE TABLE IF NOT EXISTS rewrite_rules (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    enabled        INTEGER NOT NULL DEFAULT 1,
    direction      TEXT NOT NULL,
    url_pattern    TEXT NOT NULL,
    header_add     TEXT,
    header_remove  TEXT,
    header_replace TEXT,
    body_replace   TEXT,
    redirect_url   TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS block_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    url_pattern TEXT NOT NULL,
    method      TEXT NOT NULL DEFAULT '*',
    action      TEXT NOT NULL DEFAULT 'block'
  )`,

  `CREATE TABLE IF NOT EXISTS breakpoint_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    url_pattern TEXT NOT NULL,
    direction   TEXT NOT NULL DEFAULT 'request'
  )`,

  `CREATE TABLE IF NOT EXISTS interceptor_scripts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    name        TEXT NOT NULL,
    script_body TEXT NOT NULL,
    url_pattern TEXT NOT NULL DEFAULT '*'
  )`,

  `CREATE TABLE IF NOT EXISTS report_server_config (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    enabled         INTEGER NOT NULL DEFAULT 0,
    endpoint_url    TEXT NOT NULL,
    auth_header     TEXT,
    filter_pattern  TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS aes_decrypt_config (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    enabled     INTEGER NOT NULL DEFAULT 0,
    algorithm   TEXT NOT NULL DEFAULT 'AES-CBC',
    key_hex     TEXT NOT NULL,
    iv_hex      TEXT,
    direction   TEXT NOT NULL DEFAULT 'response'
  )`,

  // === Extended tables ===

  `CREATE TABLE IF NOT EXISTS favorite_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    request_id  TEXT NOT NULL,
    label       TEXT,
    created_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS domain_filters (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    domain    TEXT NOT NULL UNIQUE,
    enabled   INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS prompt_templates (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    mode            TEXT NOT NULL,
    system_prompt   TEXT NOT NULL,
    requirements    TEXT NOT NULL,
    is_built_in     INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS mcp_server_config (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    transport TEXT NOT NULL,
    command   TEXT,
    args      TEXT,
    url       TEXT,
    env       TEXT,
    enabled   INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`
]

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null }
  const startAt = (currentVersion?.v ?? 0)

  if (startAt < MIGRATIONS.length) {
    logger.info(`Running migrations ${startAt + 1} to ${MIGRATIONS.length}`)

    const insertVersion = db.prepare('INSERT INTO schema_version (version) VALUES (?)')

    db.transaction(() => {
      for (let i = startAt; i < MIGRATIONS.length; i++) {
        db.exec(MIGRATIONS[i])
        insertVersion.run(i + 1)
      }
    })()

    logger.info('Migrations complete')
  } else {
    logger.info('Database schema is up to date')
  }
}
