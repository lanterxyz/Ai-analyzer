// Interceptor interface - re-declare ProxyContext locally to avoid rollup type-only import issues
import type { ProxyContext as ProxyContextType } from '@shared/types'

export interface Interceptor {
  name: string
  enabled: boolean
  onRequest(ctx: ProxyContextType): Promise<void>
  onResponse(ctx: ProxyContextType): Promise<void>
}

export abstract class BaseInterceptor implements Interceptor {
  abstract name: string
  enabled: boolean = true

  async onRequest(_ctx: ProxyContextType): Promise<void> {}
  async onResponse(_ctx: ProxyContextType): Promise<void> {}
}

export type { ProxyContextType as ProxyContext }
