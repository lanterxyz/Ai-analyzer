# Ai-analyzer

Packet capture AI analysis software with embedded browser and MITM proxy.

## Features

### Traffic Capture
- **Embedded Chromium Browser** with CDP (Chrome DevTools Protocol) interception
- **Built-in MITM HTTPS Proxy** (port 8888) with dynamic certificate generation
- **Dual-channel capture** (CDP + Proxy) unified into a single session view
- **SSE/WebSocket detection** with automatic stream identification
- **Storage snapshots** (Cookie, localStorage, sessionStorage)

### JS Hook Injection
- `fetch()` and `XMLHttpRequest` interception
- `crypto.subtle` and **CryptoJS** hook (encrypt/decrypt/sign/verify/digest)
- **SM2/SM3/SM4** Chinese national cryptographic algorithm hooks
- `document.cookie` write capture
- **Call stack capture** with auto re-injection on navigation

### Interceptor Chain (from ProxyPin)
- **DNS Override** - Map hostnames to custom IPs
- **Request Map / Mock Server** - Serve local files or script-generated responses
- **Request Rewrite** - URL redirect + header/body regex replacement
- **JavaScript Scripting** - Custom JS manipulation of requests/responses
- **Request Block** - URL pattern blocking
- **Breakpoint Debug** - Pause traffic for manual editing
- **Report Server** - Forward captured traffic to remote endpoint
- **AES Decrypt** - Automatic AES request/response decryption

### AI Intelligent Analysis
- **Two-phase pipeline**: Smart Filtering → Deep Analysis
- **6 analysis modes**: Auto-detect, API Reverse Engineering, Security Audit, Performance, Crypto Reverse Engineering, Custom
- **13 scene detection rules** (AI Chat, OAuth, Token Auth, Login, etc.)
- **Three-tier crypto code extraction** from captured JS
- **Agentic tool-calling loop** (up to 10 rounds) during analysis
- **Multi-turn follow-up chat** with context compression
- **Streaming output** via SSE

### Multi-LLM Support
- OpenAI (Chat Completions)
- Anthropic (Messages API)
- Custom OpenAI-compatible providers (DeepSeek, Ollama, etc.)
- Minimax

### MCP Integration
- MCP Client: Connect to external MCP servers (stdio + StreamableHTTP)
- Built-in MCP Server: Expose capture & analysis as 15+ tools

### Toolbox
- AES Encrypt/Decrypt
- Encoding/Decoding (Base64, URL, Hex, HTML)
- JavaScript Runner
- Regex Tester
- Timestamp Converter
- WebSocket Client
- QR Code Generator
- HAR Export/Import
- cURL / Fetch Generation
- JSON/HTML/CSS/XML Formatter

### Other
- Browser fingerprint spoofing
- Interaction recording & replay
- Favorites and domain filtering
- Dark/Light theme, Chinese/English i18n
- Auto-update via GitHub Releases
- CA certificate management with cross-platform installation
- System proxy toggle
- Upstream proxy support (HTTP/SOCKS5)

## Development

```bash
# Install dependencies
pnpm install

# Start dev mode
pnpm dev

# Build
pnpm build

# Package Windows EXE
pnpm build:win

# Package macOS DMG
pnpm build:mac

# Package Linux AppImage
pnpm build:linux
```

## Release

Push a version tag to trigger automatic build and release via GitHub Actions:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This will automatically:
1. Build for Windows (NSIS installer + Portable), macOS (DMG), and Linux (AppImage + deb)
2. Create a GitHub Release with all artifacts attached

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 35 + electron-vite |
| Frontend | React 19 + TypeScript 5 + CSS Modules |
| Database | better-sqlite3 (WAL mode) |
| TLS/Crypto | node-forge |
| AI/LLM | OpenAI + Anthropic + compatible APIs |
| MCP | @modelcontextprotocol/sdk |
| Proxy | Custom Node.js HTTP/HTTPS MITM + SOCKS5 |

## License

MIT
