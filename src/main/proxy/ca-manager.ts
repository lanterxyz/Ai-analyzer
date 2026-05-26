// CA Manager - Root CA and dynamic leaf certificate generation
import forge from 'node-forge'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { createLogger } from '../logger'

const logger = createLogger('ca-manager')

const CA_KEY_SIZE = 2048
const CA_VALIDITY_YEARS = 10
const LEAF_VALIDITY_DAYS = 825 // Apple compliant
const LRU_MAX = 500

export class CaManager {
  private caKey: forge.pki.rsa.PrivateKey | null = null
  private caCert: forge.pki.Certificate | null = null
  private certCache = new Map<string, { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }>()

  private caDir: string
  private caKeyPath: string
  private caCertPath: string

  constructor() {
    this.caDir = path.join(app.getPath('userData'), 'ca')
    this.caKeyPath = path.join(this.caDir, 'root-ca.key')
    this.caCertPath = path.join(this.caDir, 'root-ca.crt')
  }

  async initialize(): Promise<void> {
    fs.mkdirSync(this.caDir, { recursive: true })

    if (fs.existsSync(this.caKeyPath) && fs.existsSync(this.caCertPath)) {
      logger.info('Loading existing CA certificate')
      await this.loadCA()
    } else {
      logger.info('Generating new CA certificate')
      await this.generateCA()
    }
  }

  private async loadCA(): Promise<void> {
    const keyPem = fs.readFileSync(this.caKeyPath, 'utf-8')
    const certPem = fs.readFileSync(this.caCertPath, 'utf-8')
    this.caKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey
    this.caCert = forge.pki.certificateFromPem(certPem)
  }

  private async generateCA(): Promise<void> {
    const keys = forge.pki.rsa.generateKeyPair({ bits: CA_KEY_SIZE })
    const cert = forge.pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'

    const now = new Date()
    cert.validity.notBefore = now
    cert.validity.notAfter = new Date(now.getFullYear() + CA_VALIDITY_YEARS, now.getMonth(), now.getDate())

    const attrs: forge.pki.NameField[] = [
      { name: 'commonName', value: 'Ai-analyzer CA' },
      { name: 'organizationName', value: 'Ai-analyzer' }
    ]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)

    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true },
      { name: 'subjectKeyIdentifier' }
    ])

    cert.sign(keys.privateKey, forge.md.sha256.create())

    this.caKey = keys.privateKey
    this.caCert = cert

    fs.writeFileSync(this.caKeyPath, forge.pki.privateKeyToPem(keys.privateKey))
    fs.writeFileSync(this.caCertPath, forge.pki.certificateToPem(cert))
    logger.info('CA certificate generated and saved')
  }

  async regenerateCA(): Promise<void> {
    fs.unlinkSync(this.caKeyPath)
    fs.unlinkSync(this.caCertPath)
    this.certCache.clear()
    await this.generateCA()
  }

  getCaCertPem(): string {
    if (!this.caCert) throw new Error('CA not initialized')
    return forge.pki.certificateToPem(this.caCert)
  }

  getCaCertDer(): Buffer {
    const pem = this.getCaCertPem()
    const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
    return Buffer.from(base64, 'base64')
  }

  isInitialized(): boolean {
    return this.caKey !== null && this.caCert !== null
  }

  getLeafCertContext(hostname: string): { cert: Buffer; key: Buffer; caCert: Buffer } {
    if (!this.caKey || !this.caCert) throw new Error('CA not initialized')

    // Check LRU cache
    const cached = this.certCache.get(hostname)
    if (cached) {
      return {
        cert: this.toDer(cached.cert),
        key: this.toDerKey(cached.key),
        caCert: this.getCaCertDer()
      }
    }

    // Generate leaf certificate
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })
    const cert = forge.pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = String(Date.now())

    const now = new Date()
    cert.validity.notBefore = now
    cert.validity.notAfter = new Date(now.getTime() + LEAF_VALIDITY_DAYS * 86400000)

    cert.setSubject([{ name: 'commonName', value: hostname }])
    cert.setIssuer(this.caCert.subject.attributes)

    cert.setExtensions([
      { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] },
      { name: 'authorityKeyIdentifier' },
      { name: 'subjectKeyIdentifier' }
    ])

    cert.sign(this.caKey, forge.md.sha256.create())

    // LRU eviction
    if (this.certCache.size >= LRU_MAX) {
      const firstKey = this.certCache.keys().next().value
      if (firstKey) this.certCache.delete(firstKey)
    }

    this.certCache.set(hostname, { cert, key: keys.privateKey })
    logger.debug('Generated leaf cert', { hostname })

    return {
      cert: this.toDer(cert),
      key: this.toDerKey(keys.privateKey),
      caCert: this.getCaCertDer()
    }
  }

  private toDer(cert: forge.pki.Certificate): Buffer {
    const asn1 = forge.pki.certificateToAsn1(cert)
    return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
  }

  private toDerKey(key: forge.pki.rsa.PrivateKey): Buffer {
    const asn1 = forge.pki.privateKeyToAsn1(key)
    return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
  }
}
