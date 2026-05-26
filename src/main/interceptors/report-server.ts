// Report server interceptor - Forward captured traffic to remote endpoint
import { BaseInterceptor } from './types'
import { ProxyContext } from '@shared/types'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import zlib from 'zlib'
import { getDatabase } from '../db/database'
import { createLogger } from '../logger'

const logger = createLogger('report-server')

export class ReportServerInterceptor extends BaseInterceptor {
  name = 'report_server'
  enabled = false // Off by default

  async onResponse(ctx: ProxyContext): Promise<void> {
    const config = this.getConfig()
    if (!config || !config.enabled) return

    if (config.filterPattern) {
      try {
        if (!new RegExp(config.filterPattern).test(ctx.url)) return
      } catch {
        return
      }
    }

    // Send request data to report server
    this.report(ctx, 'request', config).catch(err => {
      logger.error('Report request failed', err)
    })

    // Send response data to report server
    this.report(ctx, 'response', config).catch(err => {
      logger.error('Report response failed', err)
    })
  }

  private async report(ctx: ProxyContext, phase: 'request' | 'response', config: { endpointUrl: string; authHeader: string | null }): Promise<void> {
    const payload = JSON.stringify({
      requestId: ctx.requestId,
      phase,
      method: ctx.method,
      url: ctx.url,
      headers: phase === 'request' ? ctx.requestHeaders : ctx.responseHeaders,
      body: phase === 'request' ? ctx.requestBody : ctx.responseBody,
      statusCode: phase === 'response' ? ctx.statusCode : null,
      timestamp: Date.now()
    })

    const urlObj = new URL(config.endpointUrl)
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Report-Phase': phase,
        'Content-Length': Buffer.byteLength(payload),
        ...(config.authHeader ? { 'Authorization': config.authHeader } : {})
      }
    }

    return new Promise((resolve, reject) => {
      const client = urlObj.protocol === 'https:' ? https : http
      const req = client.request(options, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', reject)
      req.write(payload)
      req.end()
    })
  }

  private getConfig(): { enabled: boolean; endpointUrl: string; authHeader: string | null; filterPattern: string | null } | null {
    try {
      const db = getDatabase()
      const row = db.prepare('SELECT * FROM report_server_config WHERE id = 1').get() as any
      if (!row) return null
      return {
        enabled: row.enabled === 1,
        endpointUrl: row.endpoint_url,
        authHeader: row.auth_header,
        filterPattern: row.filter_pattern
      }
    } catch {
      return null
    }
  }
}
