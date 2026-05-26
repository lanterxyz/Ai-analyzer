// AES decrypt interceptor
import { BaseInterceptor } from './types'
import { ProxyContext } from '@shared/types'
import crypto from 'crypto'
import { getDatabase } from '../db/database'

export class AesDecryptInterceptor extends BaseInterceptor {
  name = 'aes_decrypt'
  enabled = false // Off by default

  async onRequest(ctx: ProxyContext): Promise<void> {
    const config = this.getConfig()
    if (!config || !config.enabled) return
    if (config.direction === 'response') return

    if (ctx.requestBody) {
      ctx.requestBody = this.decrypt(ctx.requestBody, config)
    }
  }

  async onResponse(ctx: ProxyContext): Promise<void> {
    const config = this.getConfig()
    if (!config || !config.enabled) return
    if (config.direction === 'request') return

    if (ctx.responseBody) {
      ctx.responseBody = this.decrypt(ctx.responseBody, config)
    }
  }

  private decrypt(data: string, config: { algorithm: string; keyHex: string; ivHex: string | null }): string {
    try {
      const key = Buffer.from(config.keyHex, 'hex')
      const iv = config.ivHex ? Buffer.from(config.ivHex, 'hex') : null

      let ciphertext: Buffer
      try {
        ciphertext = Buffer.from(data, 'base64')
      } catch {
        ciphertext = Buffer.from(data, 'utf-8')
      }

      const decipher = crypto.createDecipheriv(
        config.algorithm,
        key,
        iv || Buffer.alloc(16, 0)
      )

      let decrypted = decipher.update(ciphertext)
      decrypted = Buffer.concat([decrypted, decipher.final()])

      return decrypted.toString('utf-8')
    } catch (err) {
      return data // Return original on failure
    }
  }

  private getConfig(): { enabled: boolean; algorithm: string; keyHex: string; ivHex: string | null; direction: string } | null {
    try {
      const db = getDatabase()
      const row = db.prepare('SELECT * FROM aes_decrypt_config WHERE id = 1').get() as any
      if (!row) return null
      return {
        enabled: row.enabled === 1,
        algorithm: row.algorithm,
        keyHex: row.key_hex,
        ivHex: row.iv_hex,
        direction: row.direction
      }
    } catch {
      return null
    }
  }
}
