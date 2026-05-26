// Upstream proxy support (HTTP/HTTPS/SOCKS5)
import http from 'http'
import https from 'https'
import { SocksClient } from 'socks'
import { URL } from 'url'
import { UpstreamProxyConfig } from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('upstream-proxy')

export async function createUpstreamConnection(
  targetHost: string,
  targetPort: number,
  useTls: boolean,
  upstream: UpstreamProxyConfig
): Promise<net.Socket> {
  const net = await import('net')

  if (upstream.type === 'socks5') {
    logger.debug('Using SOCKS5 upstream', { host: upstream.host, port: upstream.port })

    const result = await SocksClient.createConnection({
      proxy: {
        host: upstream.host,
        port: upstream.port,
        type: 5,
        userId: upstream.username || undefined,
        password: upstream.password || undefined
      },
      command: 'connect',
      destination: {
        host: targetHost,
        port: targetPort
      }
    })

    if (useTls) {
      const tlsSocket = await import('tls')
      return tlsSocket.default.connect({
        socket: result.socket,
        servername: targetHost
      }) as any
    }

    return result.socket
  }

  // HTTP upstream proxy via CONNECT
  return new Promise((resolve, reject) => {
    const connectReq = http.request({
      host: upstream.host,
      port: upstream.port,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: upstream.username && upstream.password
        ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${upstream.username}:${upstream.password}`).toString('base64') }
        : {}
    })

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode === 200) {
        logger.debug('Upstream CONNECT established', { target: `${targetHost}:${targetPort}` })

        if (useTls) {
          import('tls').then(tls => {
            const tlsSocket = tls.default.connect({
              socket,
              servername: targetHost
            })
            resolve(tlsSocket as any)
          })
        } else {
          resolve(socket)
        }
      } else {
        reject(new Error(`Upstream proxy CONNECT failed: ${res.statusCode}`))
      }
    })

    connectReq.on('error', reject)
    connectReq.end()
  })
}

import net from 'net'
