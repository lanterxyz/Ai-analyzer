// Breakpoint interceptor - Debug pause + manual editing
import { BaseInterceptor } from './types'
import { ProxyContext, BreakpointRule } from '@shared/types'
import { BreakpointRuleRepo } from '../db/repositories'
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'

const breakpointEmitter = new EventEmitter()

export class BreakpointInterceptor extends BaseInterceptor {
  name = 'breakpoint'
  enabled = true

  async onRequest(ctx: ProxyContext): Promise<void> {
    const rules = this.getEnabledRules('request')
    for (const rule of rules) {
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue

      // Pause and wait for user action
      ctx.breakpoint = true
      const modified = await this.waitForUserEdit(ctx, 'request')
      if (modified) {
        Object.assign(ctx, modified)
      }
      ctx.breakpoint = false
      return
    }

    // Also check 'both' direction
    const bothRules = this.getEnabledRules('both')
    for (const rule of bothRules) {
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue
      ctx.breakpoint = true
      const modified = await this.waitForUserEdit(ctx, 'request')
      if (modified) Object.assign(ctx, modified)
      ctx.breakpoint = false
      return
    }
  }

  async onResponse(ctx: ProxyContext): Promise<void> {
    const rules = this.getEnabledRules('response')
    for (const rule of rules) {
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue
      ctx.breakpoint = true
      const modified = await this.waitForUserEdit(ctx, 'response')
      if (modified) Object.assign(ctx, modified)
      ctx.breakpoint = false
      return
    }

    const bothRules = this.getEnabledRules('both')
    for (const rule of bothRules) {
      if (!this.matchUrl(rule.urlPattern, ctx.url)) continue
      ctx.breakpoint = true
      const modified = await this.waitForUserEdit(ctx, 'response')
      if (modified) Object.assign(ctx, modified)
      ctx.breakpoint = false
      return
    }
  }

  private waitForUserEdit(ctx: ProxyContext, phase: 'request' | 'response'): Promise<Partial<ProxyContext> | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null) // Auto-continue after 10 minutes
      }, 600000)

      // Notify renderer about breakpoint hit
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        win.webContents.send('breakpoint:hit', {
          requestId: ctx.requestId,
          phase,
          method: ctx.method,
          url: ctx.url,
          requestHeaders: ctx.requestHeaders,
          requestBody: ctx.requestBody,
          statusCode: ctx.statusCode,
          responseHeaders: ctx.responseHeaders,
          responseBody: ctx.responseBody
        })
      }

      // Listen for user response
      const handler = (id: string, modified: Partial<ProxyContext> | null) => {
        if (id === ctx.requestId) {
          clearTimeout(timeout)
          breakpointEmitter.off('breakpoint:continue', handler)
          resolve(modified)
        }
      }

      breakpointEmitter.on('breakpoint:continue', handler)
    })
  }

  static continueBreakpoint(requestId: string, modified: Partial<ProxyContext> | null): void {
    breakpointEmitter.emit('breakpoint:continue', requestId, modified)
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
      const repo = new BreakpointRuleRepo()
      return repo.list().filter(r => r.enabled && (r.direction === direction || r.direction === 'both'))
    } catch {
      return []
    }
  }
}

export { breakpointEmitter }
