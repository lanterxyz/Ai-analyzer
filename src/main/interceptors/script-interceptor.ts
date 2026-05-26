// Script interceptor - JavaScript scripting engine for custom manipulation
import { BaseInterceptor } from './types'
import { ProxyContext } from '@shared/types'
import { InterceptorScriptRepo } from '../db/repositories'
import vm from 'vm'

export class ScriptInterceptor extends BaseInterceptor {
  name = 'script'
  enabled = true

  async onRequest(ctx: ProxyContext): Promise<void> {
    const scripts = this.getEnabledScripts()
    for (const script of scripts) {
      if (script.urlPattern !== '*' && !this.matchUrl(script.urlPattern, ctx.url)) continue
      try {
        await this.runScript(script.scriptBody, ctx, 'request')
      } catch {
        continue
      }
    }
  }

  async onResponse(ctx: ProxyContext): Promise<void> {
    const scripts = this.getEnabledScripts()
    for (const script of scripts) {
      if (script.urlPattern !== '*' && !this.matchUrl(script.urlPattern, ctx.url)) continue
      try {
        await this.runScript(script.scriptBody, ctx, 'response')
      } catch {
        continue
      }
    }
  }

  private async runScript(scriptBody: string, ctx: ProxyContext, phase: 'request' | 'response'): Promise<void> {
    const context = vm.createContext({
      request: {
        method: ctx.method,
        url: ctx.url,
        headers: { ...ctx.requestHeaders },
        body: ctx.requestBody
      },
      response: {
        statusCode: ctx.statusCode,
        headers: ctx.responseHeaders ? { ...ctx.responseHeaders } : {},
        body: ctx.responseBody
      },
      phase,
      scriptSession: {},
      modifyRequest: (mod: { url?: string; method?: string; headers?: Record<string, string>; body?: string }) => {
        if (mod.url) ctx.url = mod.url
        if (mod.method) ctx.method = mod.method
        if (mod.headers) ctx.requestHeaders = mod.headers
        if (mod.body) ctx.requestBody = mod.body
      },
      modifyResponse: (mod: { statusCode?: number; headers?: Record<string, string>; body?: string }) => {
        if (mod.statusCode) ctx.statusCode = mod.statusCode
        if (mod.headers) ctx.responseHeaders = mod.headers
        if (mod.body) ctx.responseBody = mod.body
      },
      block: () => { ctx.blocked = true },
      shortCircuit: () => { ctx.shortCircuit = true }
    })

    const wrappedScript = new vm.Script(`
      (async () => {
        ${scriptBody}
      })()
    `, { filename: 'interceptor-script.js' })

    await wrappedScript.runInContext(context, { timeout: 5000 })
  }

  private matchUrl(pattern: string, url: string): boolean {
    try {
      return new RegExp(pattern).test(url)
    } catch {
      return url.includes(pattern)
    }
  }

  private getEnabledScripts() {
    try {
      return new InterceptorScriptRepo().list().filter(s => s.enabled)
    } catch {
      return []
    }
  }
}
