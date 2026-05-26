// Request map interceptor - Mock server with file and script modes
import { BaseInterceptor } from './types'
import { ProxyContext } from '@shared/types'
import { RequestMapRuleRepo } from '../db/repositories'
import fs from 'fs'

export class RequestMapInterceptor extends BaseInterceptor {
  name = 'request_map'
  enabled = true

  async onRequest(ctx: ProxyContext): Promise<void> {
    const rules = this.getEnabledRules()
    for (const rule of rules) {
      if (rule.method !== '*' && rule.method !== ctx.method) continue
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue

      if (rule.mode === 'file' && rule.filePath) {
        try {
          const content = fs.readFileSync(rule.filePath, 'utf-8')
          ctx.statusCode = rule.statusCode
          ctx.responseHeaders = { 'Content-Type': rule.contentType }
          ctx.responseBody = content
          ctx.shortCircuit = true
          return
        } catch {
          continue
        }
      }

      if (rule.mode === 'script' && rule.scriptBody) {
        try {
          const result = this.executeScript(rule.scriptBody, ctx)
          if (result) {
            ctx.statusCode = result.statusCode || rule.statusCode
            ctx.responseHeaders = result.headers || { 'Content-Type': rule.contentType }
            ctx.responseBody = result.body || ''
            ctx.shortCircuit = true
            return
          }
        } catch {
          continue
        }
      }
    }
  }

  private executeScript(scriptBody: string, ctx: ProxyContext): { statusCode?: number; headers?: Record<string, string>; body?: string } | null {
    const vm = require('vm')
    const sandbox = {
      request: {
        method: ctx.method,
        url: ctx.url,
        headers: ctx.requestHeaders,
        body: ctx.requestBody
      },
      scriptSession: {}
    }
    try {
      const fn = vm.runInNewContext(`(${scriptBody})`, sandbox, { timeout: 5000 })
      if (typeof fn === 'function') {
        return fn(sandbox.request)
      }
      return fn
    } catch {
      return null
    }
  }

  private matchUrl(pattern: string, url: string): boolean {
    try {
      return new RegExp(pattern).test(url)
    } catch {
      return url.includes(pattern)
    }
  }

  private getEnabledRules() {
    try {
      return new RequestMapRuleRepo().list().filter(r => r.enabled)
    } catch {
      return []
    }
  }
}
