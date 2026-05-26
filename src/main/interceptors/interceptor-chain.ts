// Interceptor chain - executes interceptors in defined order
import { ProxyContext, InterceptorType } from '@shared/types'
import { Interceptor } from './types'
import { HostsInterceptor } from './hosts-interceptor'
import { RequestBlockInterceptor } from './request-block'
import { RequestMapInterceptor } from './request-map-interceptor'
import { RequestRewriteInterceptor } from './request-rewrite'
import { AesDecryptInterceptor } from './aes-decrypt'
import { ScriptInterceptor } from './script-interceptor'
import { BreakpointInterceptor } from './breakpoint-interceptor'
import { ReportServerInterceptor } from './report-server'
import { createLogger } from '../logger'

const logger = createLogger('interceptor-chain')

const DEFAULT_ORDER: InterceptorType[] = [
  InterceptorType.HOSTS,
  InterceptorType.REQUEST_BLOCK,
  InterceptorType.BREAKPOINT,
  InterceptorType.REQUEST_MAP,
  InterceptorType.REQUEST_REWRITE,
  InterceptorType.AES_DECRYPT,
  InterceptorType.SCRIPT,
  InterceptorType.REPORT_SERVER
]

export class InterceptorChain {
  private interceptors: Map<InterceptorType, Interceptor> = new Map()
  private order: InterceptorType[] = [...DEFAULT_ORDER]

  constructor() {
    // Register all interceptors
    this.register(new HostsInterceptor())
    this.register(new RequestBlockInterceptor())
    this.register(new RequestMapInterceptor())
    this.register(new RequestRewriteInterceptor())
    this.register(new AesDecryptInterceptor())
    this.register(new ScriptInterceptor())
    this.register(new BreakpointInterceptor())
    this.register(new ReportServerInterceptor())
  }

  private register(interceptor: Interceptor): void {
    this.interceptors.set(interceptor.name as InterceptorType, interceptor)
  }

  setOrder(order: InterceptorType[]): void {
    this.order = order
  }

  enable(name: InterceptorType, enabled: boolean): void {
    const interceptor = this.interceptors.get(name)
    if (interceptor) {
      interceptor.enabled = enabled
    }
  }

  async runRequest(ctx: ProxyContext): Promise<ProxyContext> {
    for (const name of this.order) {
      const interceptor = this.interceptors.get(name)
      if (!interceptor || !interceptor.enabled) continue

      try {
        await interceptor.onRequest(ctx)

        if (ctx.blocked) {
          logger.debug('Request blocked by interceptor', { interceptor: name, url: ctx.url })
          break
        }

        if (ctx.shortCircuit) {
          logger.debug('Request short-circuited by interceptor', { interceptor: name, url: ctx.url })
          break
        }

        if (ctx.breakpoint) {
          logger.debug('Request paused at breakpoint', { interceptor: name, url: ctx.url })
          break
        }
      } catch (err) {
        logger.error('Interceptor onRequest error', { name, error: (err as Error).message })
      }
    }

    return ctx
  }

  async runResponse(ctx: ProxyContext): Promise<ProxyContext> {
    // Run in reverse order for response
    for (let i = this.order.length - 1; i >= 0; i--) {
      const name = this.order[i]
      const interceptor = this.interceptors.get(name)
      if (!interceptor || !interceptor.enabled) continue

      try {
        await interceptor.onResponse(ctx)
      } catch (err) {
        logger.error('Interceptor onResponse error', { name, error: (err as Error).message })
      }
    }

    return ctx
  }

  getInterceptor(name: InterceptorType): Interceptor | undefined {
    return this.interceptors.get(name)
  }

  listInterceptors(): { name: InterceptorType; enabled: boolean; order: number }[] {
    return this.order.map((name, index) => {
      const interceptor = this.interceptors.get(name)
      return { name, enabled: interceptor?.enabled ?? false, order: index }
    })
  }
}
