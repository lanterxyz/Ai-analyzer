// Hosts interceptor - DNS override
import { BaseInterceptor } from './types'
import { ProxyContext } from '@shared/types'
import { HostsRuleRepo } from '../db/repositories'
import dns from 'dns'

export class HostsInterceptor extends BaseInterceptor {
  name = 'hosts'
  enabled = true

  private rules: Map<string, string> = new Map()

  async onRequest(ctx: ProxyContext): Promise<void> {
    this.loadRules()
    const ip = this.rules.get(ctx.hostname)
    if (ip) {
      // Store original for potential later use
      ctx.requestHeaders['x-original-host'] = ctx.hostname
      // DNS override is handled by the proxy server using the IP
      // We set a hint header that the proxy server can read
      ctx.requestHeaders['x-resolved-ip'] = ip
    }
  }

  private loadRules(): void {
    try {
      const repo = new HostsRuleRepo()
      const rules = repo.list().filter(r => r.enabled)
      this.rules.clear()
      for (const rule of rules) {
        this.rules.set(rule.hostname, rule.ip)
      }
    } catch {
      // DB might not be ready
    }
  }
}
