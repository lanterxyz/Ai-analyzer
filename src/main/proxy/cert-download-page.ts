// Certificate download HTTP page - serves at cert.ai-analyzer.test or direct IP
import http from 'http'
import { CaManager } from './ca-manager'
import os from 'os'

export function createCertDownloadHandler(caManager: CaManager): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const host = req.headers.host || ''
    const url = req.url || '/'

    if (!host.includes('cert.ai-analyzer') && !url.startsWith('/ssl')) {
      return // not our request
    }

    const certPem = caManager.getCaCertPem()
    const certDer = caManager.getCaCertDer()

    if (url === '/ssl/cer' || url === '/ssl/crt') {
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="ai-analyzer-ca.cer"'
      })
      res.end(certDer)
      return
    }

    if (url === '/ssl/pem') {
      res.writeHead(200, {
        'Content-Type': 'application/x-pem-file',
        'Content-Disposition': 'attachment; filename="ai-analyzer-ca.pem"'
      })
      res.end(certPem)
      return
    }

    // Default: show HTML download page
    const ips = getLocalIps()
    const port = host.split(':')[1] || '8888'

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ai-analyzer CA Certificate</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#333}
h1{color:#1677ff}h2{margin-top:30px;color:#555}
a.button{display:inline-block;padding:10px 24px;margin:8px 8px 8px 0;color:#fff;background:#1677ff;border-radius:6px;text-decoration:none}
a.button.secondary{background:#52c41a}
code{background:#f5f5f5;padding:2px 6px;border-radius:3px}
.steps{background:#f0f5ff;padding:16px;border-radius:8px;margin:12px 0}
</style></head><body>
<h1>Ai-analyzer CA Certificate</h1>
<p>Install this CA certificate on your device to enable HTTPS traffic capture.</p>

<h2>Download Certificate</h2>
<a class="button" href="/ssl/cer">Download .cer (Windows/macOS)</a>
<a class="button secondary" href="/ssl/pem">Download .pem (Linux)</a>

<h2>LAN Proxy Address</h2>
<p>Configure your device to use one of these proxy addresses (port: <code>${port}</code>):</p>
<ul>${ips.map(ip => `<li><code>${ip}:${port}</code></li>`).join('\n')}</ul>

<h2>iOS Installation Steps</h2>
<div class="steps">
<ol>
<li>Download the .cer file above</li>
<li>Open <strong>Settings → General → VPN & Device Management</strong></li>
<li>Tap the installed profile, then tap <strong>Install</strong></li>
<li>Go to <strong>Settings → General → About → Certificate Trust Settings</strong></li>
<li>Enable full trust for the Ai-analyzer CA</li>
</ol>
</div>

<h2>Android Installation Steps</h2>
<div class="steps">
<ol>
<li>Download the .cer file above</li>
<li>Open <strong>Settings → Security → Install from storage</strong></li>
<li>Select the downloaded certificate file</li>
<li>Name it "Ai-analyzer CA" and select "VPN and apps"</li>
<li>For Android 7+: may need system cert installation via adb</li>
</ol>
</div>

<h2>macOS Installation Steps</h2>
<div class="steps">
<ol>
<li>Download the .cer file above</li>
<li>Open <strong>Keychain Access</strong></li>
<li>Drag the certificate into the <strong>System</strong> keychain</li>
<li>Double-click the certificate, expand <strong>Trust</strong></li>
<li>Set "When using this certificate" to <strong>Always Trust</strong></li>
</ol>
</div>

<h2>Windows Installation Steps</h2>
<div class="steps">
<ol>
<li>Download the .cer file above</li>
<li>Double-click the certificate file</li>
<li>Click <strong>Install Certificate</strong> → <strong>Local Machine</strong></li>
<li>Select <strong>Place all certificates in: Trusted Root Certification Authorities</strong></li>
<li>Complete the wizard</li>
</ol>
</div>
</body></html>`

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  }
}

function getLocalIps(): string[] {
  const interfaces = os.networkInterfaces()
  const ips: string[] = []
  for (const name in interfaces) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }
  return ips
}
