// CA certificate installer - OS-level installation
import { exec } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import sudo from '@vscode/sudo-prompt'
import { CaManager } from './ca-manager'
import { createLogger } from '../logger'

const logger = createLogger('cert-installer')
const execAsync = promisify(exec)

export async function installCaCertificate(caManager: CaManager): Promise<void> {
  const platform = process.platform
  const certDerPath = path.join(app.getPath('userData'), 'ca', 'ai-analyzer-ca.cer')

  // Ensure DER file exists
  fs.writeFileSync(certDerPath, caManager.getCaCertDer())

  try {
    if (platform === 'darwin') {
      await execAsync(`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certDerPath}"`)
      logger.info('CA installed (macOS)')

    } else if (platform === 'win32') {
      await execAsync(`certutil -addstore -f Root "${certDerPath}"`)
      logger.info('CA installed (Windows)')

    } else if (platform === 'linux') {
      const dest = '/usr/local/share/ca-certificates/ai-analyzer-ca.crt'
      fs.copyFileSync(certDerPath, dest)
      await execAsync('sudo update-ca-certificates')
      logger.info('CA installed (Linux)')
    }
  } catch (err) {
    // Try with elevated privileges
    logger.info('Attempting elevated installation')
    await new Promise<void>((resolve, reject) => {
      sudo.exec(getInstallCommand(platform, certDerPath), { name: 'Ai-analyzer' }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

export async function uninstallCaCertificate(): Promise<void> {
  const platform = process.platform

  try {
    if (platform === 'darwin') {
      await execAsync('security delete-certificate -c "Ai-analyzer CA" /Library/Keychains/System.keychain')
    } else if (platform === 'win32') {
      await execAsync('certutil -delstore Root "Ai-analyzer CA"')
    } else if (platform === 'linux') {
      await execAsync('rm -f /usr/local/share/ca-certificates/ai-analyzer-ca.crt && sudo update-ca-certificates --fresh')
    }
    logger.info('CA uninstalled')
  } catch (err) {
    logger.error('Failed to uninstall CA', err)
  }
}

function getInstallCommand(platform: string, certPath: string): string {
  if (platform === 'darwin') {
    return `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`
  } else if (platform === 'win32') {
    return `certutil -addstore -f Root "${certPath}"`
  } else {
    return `cp "${certPath}" /usr/local/share/ca-certificates/ai-analyzer-ca.crt && update-ca-certificates`
  }
}
