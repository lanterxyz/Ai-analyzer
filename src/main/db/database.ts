// Database singleton with WAL mode
import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { runMigrations } from './migrations'
import { createLogger } from '../logger'

const logger = createLogger('database')

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'ai-analyzer.db')
  logger.info('Opening database', { path: dbPath })

  db = new Database(dbPath)

  // Enable WAL mode for concurrent reads
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  runMigrations(db)

  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    logger.info('Database closed')
  }
}

export function withTransaction<T>(fn: () => T): T {
  const database = getDatabase()
  return database.transaction(fn)()
}
