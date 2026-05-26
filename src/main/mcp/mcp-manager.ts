// MCP Client Manager - Connects to external MCP servers and manages tool discovery
// Supports stdio and StreamableHTTP transports via @modelcontextprotocol/sdk
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServerConfig } from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('mcp-manager')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolInfo {
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: any
}

interface ManagedConnection {
  config: McpServerConfig
  client: Client
  transport: StdioClientTransport | StreamableHTTPClientTransport
  tools: ToolInfo[]
  connected: boolean
}

// ---------------------------------------------------------------------------
// MCP Client Manager
// ---------------------------------------------------------------------------

class McpClientManager {
  private connections = new Map<string, ManagedConnection>()

  // =========================================================================
  // Connection Lifecycle
  // =========================================================================

  /**
   * Connect to an MCP server using the given config.
   * Creates the appropriate transport (stdio or streamable-http),
   * initializes the client, and discovers available tools.
   */
  async connect(config: McpServerConfig): Promise<void> {
    // Disconnect existing connection with same id if any
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id)
    }

    logger.info('Connecting to MCP server', { id: config.id, name: config.name, transport: config.transport })

    let transport: StdioClientTransport | StreamableHTTPClientTransport

    try {
      if (config.transport === 'stdio') {
        if (!config.command) {
          throw new Error('stdio transport requires a command')
        }
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? undefined,
          env: config.env ? { ...config.env } as Record<string, string> : undefined
        })
      } else if (config.transport === 'streamable-http') {
        if (!config.url) {
          throw new Error('streamable-http transport requires a URL')
        }
        transport = new StreamableHTTPClientTransport(new URL(config.url))
      } else {
        throw new Error(`Unknown transport type: ${config.transport}`)
      }
    } catch (err) {
      logger.error('Failed to create MCP transport', { id: config.id, err })
      throw err
    }

    const client = new Client(
      { name: 'ai-analyzer-mcp-client', version: '1.0.0' },
      { capabilities: {} }
    )

    try {
      await client.connect(transport)
    } catch (err) {
      logger.error('Failed to connect MCP client', { id: config.id, err })
      throw err
    }

    // Discover available tools
    let tools: ToolInfo[] = []
    try {
      const toolsResult = await client.listTools()
      tools = (toolsResult.tools || []).map(tool => ({
        serverId: config.id,
        serverName: config.name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
      logger.info('Discovered MCP tools', { id: config.id, count: tools.length })
    } catch (err) {
      logger.warn('Failed to list tools from MCP server (server may not expose tools)', { id: config.id, err })
    }

    const connection: ManagedConnection = {
      config,
      client,
      transport,
      tools,
      connected: true
    }

    this.connections.set(config.id, connection)
    logger.info('MCP server connected', { id: config.id, name: config.name })
  }

  /**
   * Disconnect from an MCP server by ID.
   * Closes the transport and removes the connection.
   */
  async disconnect(id: string): Promise<void> {
    const conn = this.connections.get(id)
    if (!conn) {
      logger.warn('No MCP connection found for disconnect', { id })
      return
    }

    try {
      await conn.client.close()
    } catch (err) {
      logger.warn('Error closing MCP client', { id, err })
    }

    try {
      await conn.transport.close()
    } catch (err) {
      logger.warn('Error closing MCP transport', { id, err })
    }

    this.connections.delete(id)
    logger.info('MCP server disconnected', { id })
  }

  /**
   * Disconnect all managed connections.
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    for (const id of ids) {
      await this.disconnect(id)
    }
  }

  // =========================================================================
  // Tool Discovery
  // =========================================================================

  /**
   * Get all available tools from all connected MCP servers.
   * Returns a flat list with the server information embedded in each tool.
   */
  getAvailableTools(): ToolInfo[] {
    const allTools: ToolInfo[] = []
    for (const conn of this.connections.values()) {
      if (conn.connected) {
        allTools.push(...conn.tools)
      }
    }
    return allTools
  }

  /**
   * Refresh the tool list for a specific server by re-querying it.
   */
  async refreshTools(serverId: string): Promise<ToolInfo[]> {
    const conn = this.connections.get(serverId)
    if (!conn || !conn.connected) {
      throw new Error(`MCP server not connected: ${serverId}`)
    }

    try {
      const toolsResult = await conn.client.listTools()
      conn.tools = (toolsResult.tools || []).map(tool => ({
        serverId: conn.config.id,
        serverName: conn.config.name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
      logger.info('Refreshed MCP tools', { id: serverId, count: conn.tools.length })
    } catch (err) {
      logger.error('Failed to refresh tools', { serverId, err })
      throw err
    }

    return conn.tools
  }

  // =========================================================================
  // Tool Execution
  // =========================================================================

  /**
   * Call a tool on a specific MCP server.
   */
  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    const conn = this.connections.get(serverId)
    if (!conn) {
      throw new Error(`MCP server not found: ${serverId}`)
    }
    if (!conn.connected) {
      throw new Error(`MCP server not connected: ${serverId}`)
    }

    logger.info('Calling MCP tool', { serverId, toolName })

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args })
      logger.info('MCP tool call completed', { serverId, toolName })
      return result
    } catch (err) {
      logger.error('MCP tool call failed', { serverId, toolName, err })
      throw err
    }
  }

  // =========================================================================
  // Connection Status
  // =========================================================================

  /**
   * List all configured server connections with their status.
   */
  listConnections(): (McpServerConfig & { connected: boolean; toolCount: number })[] {
    const result: (McpServerConfig & { connected: boolean; toolCount: number })[] = []

    for (const conn of this.connections.values()) {
      result.push({
        ...conn.config,
        connected: conn.connected,
        toolCount: conn.tools.length
      })
    }

    return result
  }

  /**
   * Check if a specific server is connected.
   */
  isConnected(id: string): boolean {
    const conn = this.connections.get(id)
    return conn?.connected ?? false
  }

  /**
   * Get connection info for a specific server.
   */
  getConnection(id: string): ManagedConnection | undefined {
    return this.connections.get(id)
  }
}

// Singleton instance
let instance: McpClientManager | null = null

export function getMcpClientManager(): McpClientManager {
  if (!instance) {
    instance = new McpClientManager()
  }
  return instance
}

export function resetMcpClientManager(): void {
  instance = null
}
