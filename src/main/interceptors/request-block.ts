// Request block interceptor - URL pattern blocking
import { BaseInterceptor } from './types'
import { ProxyContext } from '@shared/types'
import { BlockRuleRepo } from '../db/repositories'

export class RequestBlockInterceptor extends BaseInterceptor {
  name = 'request_block'
  enabled = true

  async onRequest(ctx: ProxyContext): Promise<void> {
    const rules = this.getEnabledRules()
    for (const rule of rules) {
      if (rule.method !== '*' && rule.method !== ctx.method) continue
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue

      ctx.blocked = true
      if (rule.action === 'abort') {
        ctx.shortCircuit = true
      }
      return
    }
  }

  private matchUrl(pattern: string, url: string): boolean {
    try {
      const regex = new RegExp(pattern)
      return regex.test(url)
    } catch {
      // Fallback to simple includes
      return url.includes(pattern)
    }
  }

  private getEnabledRules() {
    try {
      const repo = new BlockRuleRepo()
      return repo.list().filter(r => r.enabled)
    } catch {
      return []
    }
  }
}
