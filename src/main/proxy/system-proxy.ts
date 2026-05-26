// System proxy setting/unsetting per OS
import { exec } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '../logger'

const logger = createLogger('system-proxy')
const execAsync = promisify(exec)

export async function setSystemProxy(host: string, port: number): Promise<void> {
  const platform = process.platform

  try {
    if (platform === 'darwin') {
      // macOS - set for all network services
      const { stdout } = await execAsync('networksetup -listallnetworkservices')
      const services = stdout.split('\n').slice(1).filter(s => s.trim() && !s.startsWith('*'))

      for (const service of services) {
        await execAsync(`networksetup -setwebproxy "${service}" ${host} ${port}`)
        await execAsync(`networksetup -setsecurewebproxy "${service}" ${host} ${port}`)
        await execAsync(`networksetup -setsocksfirewallproxy "${service}" ${host} ${port}`)
      }
      logger.info('System proxy set (macOS)', { host, port })

    } else if (platform === 'win32') {
      // Windows - set via registry
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
      await execAsync(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 1 /f`)
      await execAsync(`reg add "${regPath}" /v ProxyServer /t REG_SZ /d "${host}:${port}" /f`)
      logger.info('System proxy set (Windows)', { host, port })

    } else if (platform === 'linux') {
      // Linux - set via gsettings (GNOME)
      await execAsync(`gsettings set org.gnome.system.proxy mode 'manual'`)
      await execAsync(`gsettings set org.gnome.system.proxy.http host '${host}'`)
      await execAsync(`gsettings set org.gnome.system.proxy.http port ${port}`)
      await execAsync(`gsettings set org.gnome.system.proxy.https host '${host}'`)
      await execAsync(`gsettings set org.gnome.system.proxy.https port ${port}`)
      logger.info('System proxy set (Linux)', { host, port })
    }
  } catch (err) {
    logger.error('Failed to set system proxy', err)
    throw err
  }
}

export async function unsetSystemProxy(): Promise<void> {
  const platform = process.platform

  try {
    if (platform === 'darwin') {
      const { stdout } = await execAsync('networksetup -listallnetworkservices')
      const services = stdout.split('\n').slice(1).filter(s => s.trim() && !s.startsWith('*'))

      for (const service of services) {
        await execAsync(`networksetup -setwebproxystate "${service}" off`)
        await execAsync(`networksetup -setsecurewebproxystate "${service}" off`)
        await execAsync(`networksetup -setsocksfirewallproxystate "${service}" off`)
      }
      logger.info('System proxy unset (macOS)')

    } else if (platform === 'win32') {
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
      await execAsync(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 0 /f`)
      logger.info('System proxy unset (Windows)')

    } else if (platform === 'linux') {
      await execAsync(`gsettings set org.gnome.system.proxy mode 'none'`)
      logger.info('System proxy unset (Linux)')
    }
  } catch (err) {
    logger.error('Failed to unset system proxy', err)
    throw err
  }
}
