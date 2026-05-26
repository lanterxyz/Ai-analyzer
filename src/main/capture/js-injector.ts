// JS Injector - Hook script injection and re-injection on navigation
import { WebContents } from 'electron'
import fs from 'fs'
import path from 'path'
import { createLogger } from '../logger'

const logger = createLogger('js-injector')

let hookScript: string | null = null

function getHookScript(): string {
  if (hookScript) return hookScript
  try {
    hookScript = fs.readFileSync(path.join(__dirname, '../preload/hook-script.js'), 'utf-8')
  } catch {
    hookScript = '' // Will be loaded later
  }
  return hookScript
}

export function injectHooks(webContents: WebContents): void {
  const script = getHookScript()
  if (!script) {
    logger.warn('Hook script not available')
    return
  }

  webContents.executeJavaScript(script)
    .then(() => logger.debug('Hooks injected'))
    .catch(err => logger.debug('Hook injection failed', { error: err.message }))
}

export function setupAutoReinject(webContents: WebContents): void {
  webContents.on('did-navigate', () => {
    injectHooks(webContents)
  })

  webContents.on('did-navigate-in-page', () => {
    injectHooks(webContents)
  })

  // Initial injection when page finishes loading
  webContents.on('dom-ready', () => {
    injectHooks(webContents)
  })

  logger.debug('Auto re-injection set up')
}
