// Storage Collector - Periodic Cookie/localStorage/sessionStorage snapshots
import { session as electronSession, WebContents } from 'electron'
import { StorageSnapshot, StorageEntry } from '@shared/types'
import { v4 as uuid } from 'uuid'
import { createLogger } from '../logger'

const logger = createLogger('storage-collector')

export class StorageCollector {
  private intervalId: NodeJS.Timeout | null = null
  private sessionId: string | null = null
  private partition: string | null = null
  private onSnapshot: ((snapshot: Omit<StorageSnapshot, 'id'>) => void) | null = null

  start(
    sessionId: string,
    partition: string,
    onSnapshot: (snapshot: Omit<StorageSnapshot, 'id'>) => void,
    intervalMs = 30000
  ): void {
    this.sessionId = sessionId
    this.partition = partition
    this.onSnapshot = onSnapshot

    // Collect initial snapshot
    this.collect()

    // Set up periodic collection
    this.intervalId = setInterval(() => {
      this.collect()
    }, intervalMs)

    logger.info('Storage collector started', { sessionId, intervalMs })
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.sessionId = null
    this.partition = null
    this.onSnapshot = null
    logger.info('Storage collector stopped')
  }

  private async collect(): Promise<void> {
    if (!this.sessionId || !this.partition || !this.onSnapshot) return

    try {
      const ses = electronSession.fromPartition(this.partition)

      // Collect cookies
      const cookies = await ses.cookies.get({ allDomains: true })
      const cookieEntries: StorageEntry[] = cookies.map(c => ({
        key: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expirationDate ? c.expirationDate * 1000 : undefined,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite
      }))

      // localStorage/sessionStorage need to be collected via JS execution
      // This is done through the webContents
      const localStorageEntries: StorageEntry[] = []
      const sessionStorageEntries: StorageEntry[] = []

      this.onSnapshot({
        sessionId: this.sessionId,
        cookies: cookieEntries,
        localStorage: localStorageEntries,
        sessionStorage: sessionStorageEntries,
        timestamp: Date.now()
      })
    } catch (err) {
      logger.error('Storage collection failed', err)
    }
  }
}
