// MCP Configuration - Persistence of MCP server configs in the database
import { McpServerConfig } from '@shared/types'
import { getDatabase, withTransaction } from '../db/database'
import { createLogger } from '../logger'

const logger = createLogger('mcp-config')

// Row type from SQLite (integer boolean fields)
interface McpServerConfigRow {
  id: string
  name: string
  transport: string
  command: string | null
  args: string | null    // JSON string
  url: string | null
  env: string | null      // JSON string
  enabled: number         // 0 or 1
}

/**
 * Converts a raw database row to a McpServerConfig object.
 */
function rowToConfig(row: McpServerConfigRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as 'stdio' | 'streamable-http',
    command: row.command,
    args: row.args ? JSON.parse(row.args) : null,
    url: row.url,
    env: row.env ? JSON.parse(row.env) : null,
    enabled: row.enabled === 1
  }
}

/**
 * Converts a McpServerConfig object to database row values.
 */
function configToRow(config: McpServerConfig): {
  id: string
  name: string
  transport: string
  command: string | null
  args: string | null
  url: string | null
  env: string | null
  enabled: number
} {
  return {
    id: config.id,
    name: config.name,
    transport: config.transport,
    command: config.command,
    args: config.args ? JSON.stringify(config.args) : null,
    url: config.url,
    env: config.env ? JSON.stringify(config.env) : null,
    enabled: config.enabled ? 1 : 0
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * List all MCP server configurations.
 */
export function listMcpConfigs(): McpServerConfig[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM mcp_server_config ORDER BY name').all() as McpServerConfigRow[]
  return rows.map(rowToConfig)
}

/**
 * Get a single MCP server configuration by ID.
 */
export function getMcpConfig(id: string): McpServerConfig | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM mcp_server_config WHERE id = ?').get(id) as McpServerConfigRow | undefined
  return row ? rowToConfig(row) : null
}

/**
 * Save (upsert) an MCP server configuration.
 * Inserts if the ID doesn't exist, updates otherwise.
 */
export function saveMcpConfig(config: McpServerConfig): void {
  const db = getDatabase()
  const row = configToRow(config)

  db.prepare(`
    INSERT INTO mcp_server_config (id, name, transport, command, args, url, env, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      transport = excluded.transport,
      command = excluded.command,
      args = excluded.args,
      url = excluded.url,
      env = excluded.env,
      enabled = excluded.enabled
  `).run(row.id, row.name, row.transport, row.command, row.args, row.url, row.env, row.enabled)

  logger.info('MCP config saved', { id: config.id, name: config.name })
}

/**
 * Remove an MCP server configuration by ID.
 */
export function removeMcpConfig(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM mcp_server_config WHERE id = ?').run(id)
  const deleted = result.changes > 0
  if (deleted) {
    logger.info('MCP config removed', { id })
  } else {
    logger.warn('MCP config not found for removal', { id })
  }
  return deleted
}
