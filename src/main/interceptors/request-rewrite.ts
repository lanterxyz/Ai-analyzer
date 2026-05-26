// Request rewrite interceptor - URL redirect + header/body rewrite
import { BaseInterceptor } from './types'
import { ProxyContext } from '@shared/types'
import { RewriteRuleRepo } from '../db/repositories'

export class RequestRewriteInterceptor extends BaseInterceptor {
  name = 'request_rewrite'
  enabled = true

  async onRequest(ctx: ProxyContext): Promise<void> {
    const rules = this.getEnabledRules('request')
    for (const rule of rules) {
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue

      // URL redirect
      if (rule.redirectUrl) {
        ctx.url = rule.redirectUrl
        try {
          const urlObj = new URL(ctx.url)
          ctx.hostname = urlObj.hostname
          ctx.port = parseInt(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80)
        } catch {}
      }

      // Header add
      if (rule.headerAdd) {
        try {
          const adds = JSON.parse(rule.headerAdd)
          for (const { name, value } of adds) {
            ctx.requestHeaders[name] = value
          }
        } catch {}
      }

      // Header remove
      if (rule.headerRemove) {
        try {
          const removes: string[] = JSON.parse(rule.headerRemove)
          for (const name of removes) {
            delete ctx.requestHeaders[name]
          }
        } catch {}
      }

      // Header replace
      if (rule.headerReplace) {
        try {
          const replaces = JSON.parse(rule.headerReplace)
          for (const { name, value } of replaces) {
            if (ctx.requestHeaders[name] !== undefined) {
              ctx.requestHeaders[name] = value
            }
          }
        } catch {}
      }

      // Body replace with regex
      if (rule.bodyReplace && ctx.requestBody) {
        try {
          const replaces = JSON.parse(rule.bodyReplace)
          for (const { pattern, replacement, flags } of replaces) {
            ctx.requestBody = ctx.requestBody.replace(new RegExp(pattern, flags || 'g'), replacement)
          }
        } catch {}
      }
    }
  }

  async onResponse(ctx: ProxyContext): Promise<void> {
    const rules = this.getEnabledRules('response')
    for (const rule of rules) {
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue

      // Header operations on response
      if (rule.headerAdd && ctx.responseHeaders) {
        try {
          const adds = JSON.parse(rule.headerAdd)
          for (const { name, value } of adds) {
            ctx.responseHeaders[name] = value
          }
        } catch {}
      }

      if (rule.headerRemove && ctx.responseHeaders) {
        try {
          const removes: string[] = JSON.parse(rule.headerRemove)
          for (const name of removes) {
            delete ctx.responseHeaders[name]
          }
        } catch {}
      }

      if (rule.headerReplace && ctx.responseHeaders) {
        try {
          const replaces = JSON.parse(rule.headerReplace)
          for (const { name, value } of replaces) {
            if (ctx.responseHeaders[name] !== undefined) {
              ctx.responseHeaders[name] = value
            }
          }
        } catch {}
      }

      // Body replace with regex
      if (rule.bodyReplace && ctx.responseBody) {
        try {
          const replaces = JSON.parse(rule.bodyReplace)
          for (const { pattern, replacement, flags } of replaces) {
            ctx.responseBody = ctx.responseBody.replace(new RegExp(pattern, flags || 'g'), replacement)
          }
        } catch {}
      }
    }
  }

  private matchUrl(pattern: string, url: string): boolean {
    try {
      return new RegExp(pattern).test(url)
    } catch {
      return url.includes(pattern)
    }
  }

  private getEnabledRules(direction: string) {
    try {
      return new RewriteRuleRepo().list().filter(r => r.enabled && r.direction === direction)
    } catch {
      return []
    }
  }
}
