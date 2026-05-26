// Proxy config persistence
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { ProxyConfig, UpstreamProxyConfig } from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('proxy-config')

const DEFAULT_CONFIG: ProxyConfig = {
  enabled: false,
  port: 8888,
  systemProxyEnabled: false,
  caInstalled: false,
  upstreamProxy: null
}

export class MitmProxyConfig {
  private configPath: string
  private config: ProxyConfig

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'proxy-config.json')
    this.config = { ...DEFAULT_CONFIG }
    this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))
        this.config = { ...DEFAULT_CONFIG, ...data }
        logger.info('Proxy config loaded')
      }
    } catch (err) {
      logger.error('Failed to load proxy config, using defaults', err)
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (err) {
      logger.error('Failed to save proxy config', err)
    }
  }

  get(): ProxyConfig {
    return { ...this.config }
  }

  update(partial: Partial<ProxyConfig>): ProxyConfig {
    this.config = { ...this.config, ...partial }
    this.save()
    return this.get()
  }

  setUpstream(upstream: UpstreamProxyConfig | null): void {
    this.config.upstreamProxy = upstream
    this.save()
  }
}
