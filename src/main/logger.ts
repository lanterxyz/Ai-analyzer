// Structured logging via electron-log
import log from 'electron-log'

export function createLogger(scope: string) {
  const scopeLog = log.scope(scope)
  return {
    info: scopeLog.info.bind(scopeLog),
    warn: scopeLog.warn.bind(scopeLog),
    error: scopeLog.error.bind(scopeLog),
    debug: scopeLog.debug.bind(scopeLog)
  }
}
