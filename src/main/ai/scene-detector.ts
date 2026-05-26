// ============================================================================
// Scene Detector - Rule-based scene detection with 13 heuristics
// Analyzes captured requests and JS hooks to identify application scenes
// ============================================================================

import {
  CapturedRequest,
  JsHookRecord,
  SceneHint,
  HookType
} from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('scene-detector')

// --- Scene names ---
const SCENES = {
  AI_CHAT: 'ai-chat',
  AUTH_OAUTH: 'auth-oauth',
  AUTH_TOKEN: 'auth-token',
  AUTH_SESSION: 'auth-session',
  REGISTRATION: 'registration',
  LOGIN: 'login',
  WEBSOCKET: 'websocket',
  SSE_STREAM: 'sse-stream',
  API_GENERAL: 'api-general',
  CRYPTO_ENCRYPTION: 'crypto-encryption',
  FILE_UPLOAD: 'file-upload',
  PAYMENT: 'payment',
  GRAPHQL: 'graphql'
} as const

// --- AI Chat Detection ---
// Detects AI chat endpoints such as OpenAI, Claude, Cohere, etc.
function detectAiChat(requests: CapturedRequest[], hooks: JsHookRecord[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  // Check request URLs for AI service patterns
  const aiPatterns = [
    { pattern: /api\.openai\.com/i, name: 'OpenAI API' },
    { pattern: /chat\.openai\.com/i, name: 'OpenAI Chat' },
    { pattern: /api\.anthropic\.com/i, name: 'Anthropic API' },
    { pattern: /api\.cohere\.ai/i, name: 'Cohere API' },
    { pattern: /generativelanguage\.googleapis\.com/i, name: 'Google Gemini API' },
    { pattern: /console\.cloud\.google\.com\/generativelanguage/i, name: 'Google AI Studio' },
    { pattern: /dashscope\.aliyuncs\.com/i, name: 'Alibaba DashScope' },
    { pattern: /aip\.baidubce\.com/i, name: 'Baidu AI Platform' },
    { pattern: /api\.minimax\.chat/i, name: 'Minimax API' },
    { pattern: /api\.zhipuai\.cn/i, name: 'Zhipu AI API' },
    { pattern: /api\.moonshot\.cn/i, name: 'Moonshot AI API' },
    { pattern: /api\.deepseek\.com/i, name: 'DeepSeek API' },
    { pattern: /hunyuan\.tencentcloudapi\.com/i, name: 'Tencent Hunyuan' },
    { pattern: /api\.spark\.iflytek\.com/i, name: 'iFlyTek Spark' },
    { pattern: /chatglobally\.minimaxi\.com/i, name: 'Minimax Chat' },
    { pattern: /\/v1\/chat\/completions/i, name: 'OpenAI-compatible chat endpoint' },
    { pattern: /\/v1\/completions/i, name: 'OpenAI completions endpoint' },
    { pattern: /\/v1\/messages/i, name: 'Anthropic messages endpoint' },
    { pattern: /\/chat\/completions/i, name: 'Chat completions route' },
    { pattern: /\/completions/i, name: 'Completions route' }
  ]

  for (const req of requests) {
    for (const { pattern, name } of aiPatterns) {
      if (pattern.test(req.url)) {
        evidence.push(`Request #${req.seq} matches ${name}: ${req.method} ${req.url}`)
        confidence = Math.min(confidence + 0.35, 0.95)
      }
    }
  }

  // Check for streaming AI responses
  for (const req of requests) {
    if (req.isStreaming && /\/chat\/completions|\/completions|\/messages/i.test(req.url)) {
      evidence.push(`Streaming AI response at #${req.seq}: ${req.url}`)
      confidence = Math.min(confidence + 0.2, 0.95)
    }
  }

  // Check request bodies for AI-typical structures
  for (const req of requests) {
    if (req.requestBody) {
      try {
        const body = JSON.parse(req.requestBody)
        if (body.model || (Array.isArray(body.messages) && body.messages.length > 0)) {
          evidence.push(`Request #${req.seq} has AI request body with model=${body.model || 'unknown'}`)
          confidence = Math.min(confidence + 0.25, 0.95)
        }
        if (body.stream === true) {
          evidence.push(`Request #${req.seq} requests streaming response`)
          confidence = Math.min(confidence + 0.1, 0.95)
        }
      } catch {
        // Not JSON, skip
      }
    }
  }

  // Check hooks for crypto.subtle with AI-related operations
  for (const hook of hooks) {
    if (hook.hookType === HookType.CRYPTO_SUBTLE && /digest|sign/i.test(hook.functionName)) {
      if (requests.some(r => /chat|completion|message/i.test(r.url))) {
        evidence.push(`Crypto hook ${hook.functionName} in AI context`)
        confidence = Math.min(confidence + 0.05, 0.95)
      }
    }
  }

  return {
    scene: SCENES.AI_CHAT,
    confidence,
    evidence
  }
}

// --- OAuth Detection ---
// Detects OAuth2 authorization flows
function detectOAuth(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  const oauthPatterns = [
    { pattern: /\/oauth\/authorize/i, name: 'OAuth authorize endpoint' },
    { pattern: /\/oauth\/token/i, name: 'OAuth token endpoint' },
    { pattern: /\/oauth2\/authorize/i, name: 'OAuth2 authorize endpoint' },
    { pattern: /\/oauth2\/token/i, name: 'OAuth2 token endpoint' },
    { pattern: /\/connect\/authorize/i, name: 'OIDC authorize endpoint' },
    { pattern: /\/connect\/token/i, name: 'OIDC token endpoint' },
    { pattern: /response_type=code/i, name: 'Authorization code response type' },
    { pattern: /grant_type=authorization_code/i, name: 'Authorization code grant' },
    { pattern: /grant_type=client_credentials/i, name: 'Client credentials grant' },
    { pattern: /grant_type=refresh_token/i, name: 'Refresh token grant' },
    { pattern: /client_id=/i, name: 'OAuth client_id parameter' },
    { pattern: /redirect_uri=/i, name: 'OAuth redirect_uri parameter' },
    { pattern: /access_token=/i, name: 'Access token in URL' },
    { pattern: /code=/i, name: 'Authorization code in URL' },
    { pattern: /state=/i, name: 'OAuth state parameter' }
  ]

  for (const req of requests) {
    for (const { pattern, name } of oauthPatterns) {
      if (pattern.test(req.url) || pattern.test(req.requestBody || '')) {
        evidence.push(`Request #${req.seq} matches ${name}: ${req.method} ${req.url}`)
        confidence = Math.min(confidence + 0.25, 0.95)
      }
    }

    // Check response for OAuth tokens
    if (req.responseBody) {
      try {
        const body = JSON.parse(req.responseBody)
        if (body.access_token || body.refresh_token || body.id_token) {
          evidence.push(`Request #${req.seq} response contains OAuth token(s)`)
          confidence = Math.min(confidence + 0.3, 0.95)
        }
        if (body.token_type === 'Bearer' || body.token_type === 'bearer') {
          evidence.push(`Request #${req.seq} response contains Bearer token type`)
          confidence = Math.min(confidence + 0.1, 0.95)
        }
      } catch {
        // Not JSON, skip
      }
    }
  }

  return {
    scene: SCENES.AUTH_OAUTH,
    confidence,
    evidence
  }
}

// --- Token Auth Detection ---
// Detects token-based authentication (Bearer, JWT, API keys)
function detectTokenAuth(requests: CapturedRequest[], hooks: JsHookRecord[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  for (const req of requests) {
    // Check Authorization header
    const authHeader = req.requestHeaders['authorization'] || req.requestHeaders['Authorization']
    if (authHeader) {
      if (/^Bearer\s/i.test(authHeader)) {
        evidence.push(`Request #${req.seq} uses Bearer token: ${maskToken(authHeader)}`)
        confidence = Math.min(confidence + 0.3, 0.95)
      }
      if (/^JWT\s/i.test(authHeader)) {
        evidence.push(`Request #${req.seq} uses JWT token`)
        confidence = Math.min(confidence + 0.35, 0.95)
      }
      // Detect JWT structure in token
      if (/^Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authHeader)) {
        evidence.push(`Request #${req.seq} Bearer token appears to be JWT (3 base64url segments)`)
        confidence = Math.min(confidence + 0.15, 0.95)
      }
    }

    // Check for token in URL params
    if (/[?&]token=/i.test(req.url) || /[?&]api_key=/i.test(req.url)) {
      evidence.push(`Request #${req.seq} passes token in URL parameter`)
      confidence = Math.min(confidence + 0.2, 0.95)
    }

    // Check for API key headers
    const apiKeyHeaders = ['x-api-key', 'api-key', 'apikey', 'x-auth-token', 'x-access-token']
    for (const header of apiKeyHeaders) {
      const val = req.requestHeaders[header] || req.requestHeaders[header.replace(/-/g, '')]
      if (val) {
        evidence.push(`Request #${req.seq} uses API key header: ${header}`)
        confidence = Math.min(confidence + 0.25, 0.95)
      }
    }

    // Check for token in custom headers
    const xAuthHeaders = Object.keys(req.requestHeaders).filter(h => /^x-.*auth|^x-.*token/i.test(h))
    for (const h of xAuthHeaders) {
      evidence.push(`Request #${req.seq} has custom auth header: ${h}`)
      confidence = Math.min(confidence + 0.15, 0.95)
    }
  }

  // Check hooks for token-related operations
  for (const hook of hooks) {
    if (hook.hookType === HookType.COOKIE) {
      if (/token|jwt|auth/i.test(hook.args)) {
        evidence.push(`Cookie hook references token/auth: ${hook.functionName}`)
        confidence = Math.min(confidence + 0.1, 0.95)
      }
    }
  }

  return {
    scene: SCENES.AUTH_TOKEN,
    confidence,
    evidence
  }
}

// --- Session Auth Detection ---
// Detects session-based (cookie) authentication
function detectSessionAuth(requests: CapturedRequest[], hooks: JsHookRecord[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  for (const req of requests) {
    // Check Set-Cookie with session identifiers
    const setCookie = req.responseHeaders?.['set-cookie'] || req.responseHeaders?.['Set-Cookie']
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
      for (const cookie of cookies) {
        if (/session/i.test(cookie)) {
          evidence.push(`Request #${req.seq} sets session cookie: ${cookie.substring(0, 80)}...`)
          confidence = Math.min(confidence + 0.3, 0.95)
        }
        if (/sessionid|sess|sid/i.test(cookie)) {
          evidence.push(`Request #${req.seq} sets session ID cookie`)
          confidence = Math.min(confidence + 0.25, 0.95)
        }
        if (/httponly/i.test(cookie)) {
          evidence.push(`Request #${req.seq} sets HttpOnly cookie`)
          confidence = Math.min(confidence + 0.1, 0.95)
        }
      }
    }

    // Check Cookie header in requests
    const cookieHeader = req.requestHeaders['cookie'] || req.requestHeaders['Cookie']
    if (cookieHeader && /session|sid/i.test(cookieHeader)) {
      evidence.push(`Request #${req.seq} sends session cookie`)
      confidence = Math.min(confidence + 0.2, 0.95)
    }
  }

  // Check hooks for cookie operations
  for (const hook of hooks) {
    if (hook.hookType === HookType.COOKIE) {
      evidence.push(`Cookie hook captured: ${hook.functionName}`)
      confidence = Math.min(confidence + 0.15, 0.95)
    }
  }

  return {
    scene: SCENES.AUTH_SESSION,
    confidence,
    evidence
  }
}

// --- Registration Detection ---
// Detects user registration flows
function detectRegistration(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  const regPatterns = [
    { pattern: /\/register/i, name: 'Registration endpoint' },
    { pattern: /\/signup/i, name: 'Signup endpoint' },
    { pattern: /\/sign-up/i, name: 'Sign-up endpoint' },
    { pattern: /\/createAccount/i, name: 'Create account endpoint' },
    { pattern: /\/create-account/i, name: 'Create account endpoint' },
    { pattern: /\/join/i, name: 'Join endpoint' },
    { pattern: /\/enroll/i, name: 'Enrollment endpoint' }
  ]

  for (const req of requests) {
    // Only consider POST requests for registration
    if (req.method !== 'POST' && req.method !== 'PUT') continue

    for (const { pattern, name } of regPatterns) {
      if (pattern.test(req.url) || pattern.test(req.path)) {
        evidence.push(`Request #${req.seq} matches ${name}: ${req.method} ${req.url}`)
        confidence = Math.min(confidence + 0.35, 0.95)
      }
    }

    // Check request body for registration-like fields
    if (req.requestBody) {
      try {
        const body = JSON.parse(req.requestBody)
        const fields = Object.keys(body).map(k => k.toLowerCase())
        const regFields = ['password', 'email', 'username', 'confirm', 'firstname', 'lastname', 'phone']
        const matchCount = fields.filter(f => regFields.some(rf => f.includes(rf))).length
        if (matchCount >= 3 && /register|signup|sign-up|create/i.test(req.url)) {
          evidence.push(`Request #${req.seq} body has ${matchCount} registration-related fields`)
          confidence = Math.min(confidence + 0.3, 0.95)
        }
      } catch {
        // Not JSON, try form-encoded
        if (typeof req.requestBody === 'string') {
          const regFields = ['password', 'email', 'username', 'confirm']
          const matchCount = regFields.filter(f =>
            req.requestBody!.toLowerCase().includes(f)
          ).length
          if (matchCount >= 2 && /register|signup|sign-up/i.test(req.url)) {
            evidence.push(`Request #${req.seq} form body has ${matchCount} registration fields`)
            confidence = Math.min(confidence + 0.25, 0.95)
          }
        }
      }
    }

    // Check for successful registration response
    if (req.statusCode === 201 && /register|signup|sign-up/i.test(req.url)) {
      evidence.push(`Request #${req.seq} registration returned 201 Created`)
      confidence = Math.min(confidence + 0.2, 0.95)
    }
  }

  return {
    scene: SCENES.REGISTRATION,
    confidence,
    evidence
  }
}

// --- Login Detection ---
// Detects user login flows
function detectLogin(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  const loginPatterns = [
    { pattern: /\/login/i, name: 'Login endpoint' },
    { pattern: /\/signin/i, name: 'Signin endpoint' },
    { pattern: /\/sign-in/i, name: 'Sign-in endpoint' },
    { pattern: /\/auth\/login/i, name: 'Auth login endpoint' },
    { pattern: /\/authenticate/i, name: 'Authenticate endpoint' },
    { pattern: /\/session/i, name: 'Session creation endpoint' },
    { pattern: /\/token/i, name: 'Token creation endpoint' }
  ]

  for (const req of requests) {
    // Login is typically POST
    if (req.method !== 'POST') continue

    for (const { pattern, name } of loginPatterns) {
      if (pattern.test(req.path)) {
        evidence.push(`Request #${req.seq} matches ${name}: ${req.method} ${req.path}`)
        confidence = Math.min(confidence + 0.3, 0.95)
      }
    }

    // Check body for username + password combination
    if (req.requestBody) {
      const bodyLower = req.requestBody.toLowerCase()
      const hasPassword = bodyLower.includes('password') || bodyLower.includes('passwd')
      const hasUser = bodyLower.includes('username') || bodyLower.includes('email') ||
                      bodyLower.includes('user') || bodyLower.includes('account')
      if (hasPassword && hasUser && req.method === 'POST') {
        evidence.push(`Request #${req.seq} POST body contains username + password fields`)
        confidence = Math.min(confidence + 0.4, 0.95)
      }

      // Check for grant_type=password
      if (/grant_type=password/i.test(req.requestBody)) {
        evidence.push(`Request #${req.seq} uses Resource Owner Password grant`)
        confidence = Math.min(confidence + 0.35, 0.95)
      }
    }

    // Successful login indicators
    if (req.statusCode === 200 && /login|signin|authenticate|session/i.test(req.path)) {
      // Check for auth token in response
      if (req.responseBody) {
        try {
          const body = JSON.parse(req.responseBody)
          if (body.token || body.access_token || body.session_id || body.sessionId) {
            evidence.push(`Request #${req.seq} login returned auth token/session`)
            confidence = Math.min(confidence + 0.25, 0.95)
          }
        } catch {
          // Not JSON
        }
      }
    }
  }

  return {
    scene: SCENES.LOGIN,
    confidence,
    evidence
  }
}

// --- WebSocket Detection ---
function detectWebSocket(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  for (const req of requests) {
    if (req.isWebsocket) {
      evidence.push(`Request #${req.seq} is WebSocket: ${req.url}`)
      confidence = Math.min(confidence + 0.5, 0.95)
    }

    // Check upgrade headers
    const upgrade = req.requestHeaders['upgrade'] || req.requestHeaders['Upgrade']
    if (upgrade && /websocket/i.test(upgrade)) {
      evidence.push(`Request #${req.seq} has WebSocket Upgrade header`)
      confidence = Math.min(confidence + 0.45, 0.95)
    }

    // Check for ws:// or wss:// URLs
    if (/^wss?:\/\//i.test(req.url)) {
      evidence.push(`Request #${req.seq} uses WebSocket URL scheme: ${req.url.substring(0, 60)}`)
      confidence = Math.min(confidence + 0.5, 0.95)
    }

    // Check for socket.io patterns
    if (/socket\.io/i.test(req.url) || /\/socket\//i.test(req.path)) {
      evidence.push(`Request #${req.seq} matches socket.io pattern`)
      confidence = Math.min(confidence + 0.3, 0.95)
    }
  }

  return {
    scene: SCENES.WEBSOCKET,
    confidence,
    evidence
  }
}

// --- SSE Stream Detection ---
function detectSSEStream(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  for (const req of requests) {
    // Check content type for SSE
    if (req.contentType && /text\/event-stream/i.test(req.contentType)) {
      evidence.push(`Request #${req.seq} has SSE content type: text/event-stream`)
      confidence = Math.min(confidence + 0.6, 0.95)
    }

    // Check Accept header for SSE
    const accept = req.requestHeaders['accept'] || req.requestHeaders['Accept']
    if (accept && /text\/event-stream/i.test(accept)) {
      evidence.push(`Request #${req.seq} Accepts text/event-stream`)
      confidence = Math.min(confidence + 0.4, 0.95)
    }

    // SSE streaming URLs
    if (/\/stream|\/sse|\/events/i.test(req.path)) {
      evidence.push(`Request #${req.seq} path matches streaming endpoint: ${req.path}`)
      confidence = Math.min(confidence + 0.3, 0.95)
    }

    // Check for EventSource-like patterns in request headers
    if (req.isStreaming && req.contentType && /event-stream/i.test(req.contentType)) {
      evidence.push(`Request #${req.seq} is streaming with event-stream content type`)
      confidence = Math.min(confidence + 0.2, 0.95)
    }

    // Check response body for SSE format
    if (req.responseBody && /^data:/m.test(req.responseBody)) {
      evidence.push(`Request #${req.seq} response body contains SSE data format`)
      confidence = Math.min(confidence + 0.35, 0.95)
    }
  }

  return {
    scene: SCENES.SSE_STREAM,
    confidence,
    evidence
  }
}

// --- General API Detection ---
function detectGeneralAPI(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  // Count API-like requests (non-static, non-navigation)
  let apiCount = 0
  const apiMethods = new Set<string>()
  const apiHosts = new Set<string>()

  const staticExtensions = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|webp|mp4|webm|ogg|mp3)$/i

  for (const req of requests) {
    // Skip obviously static resources
    if (req.method === 'GET' && staticExtensions.test(req.path)) continue

    // API indicators
    if (/^\/api\//i.test(req.path) || /^\/v\d+\//i.test(req.path)) {
      apiCount++
      apiMethods.add(req.method)
      apiHosts.add(req.hostname)
      if (apiCount <= 5) {
        evidence.push(`API request #${req.seq}: ${req.method} ${req.path}`)
      }
    }

    // JSON content type is a strong API indicator
    if (req.contentType && /application\/json/i.test(req.contentType)) {
      apiCount++
      apiMethods.add(req.method)
      apiHosts.add(req.hostname)
      if (apiCount <= 5) {
        evidence.push(`JSON API request #${req.seq}: ${req.method} ${req.url.substring(0, 60)}`)
      }
    }

    // RESTful method usage (PUT, PATCH, DELETE)
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      apiCount++
      evidence.push(`RESTful method at #${req.seq}: ${req.method} ${req.path}`)
      confidence = Math.min(confidence + 0.1, 0.95)
    }
  }

  if (apiHosts.size > 0) {
    evidence.push(`API requests found across ${apiHosts.size} host(s), methods: ${[...apiMethods].join(', ')}`)
  }

  if (apiCount > 0) {
    confidence = Math.min(confidence + Math.min(apiCount * 0.1, 0.5), 0.85)
  }

  return {
    scene: SCENES.API_GENERAL,
    confidence,
    evidence
  }
}

// --- Crypto/Encryption Detection ---
function detectCryptoEncryption(requests: CapturedRequest[], hooks: JsHookRecord[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  // Check hooks for crypto operations
  for (const hook of hooks) {
    if (hook.hookType === HookType.CRYPTO_SUBTLE) {
      evidence.push(`crypto.subtle call: ${hook.functionName}(${truncate(hook.args, 60)})`)
      confidence = Math.min(confidence + 0.3, 0.95)
    }
    if (hook.hookType === HookType.CRYPTOJS) {
      evidence.push(`CryptoJS call: ${hook.functionName}(${truncate(hook.args, 60)})`)
      confidence = Math.min(confidence + 0.35, 0.95)
    }
    if (hook.hookType === HookType.SM2 || hook.hookType === HookType.SM3 || hook.hookType === HookType.SM4) {
      evidence.push(`${hook.hookType} call: ${hook.functionName}`)
      confidence = Math.min(confidence + 0.3, 0.95)
    }

    // Check function name for crypto-ish patterns
    if (/encrypt|decrypt|sign|verify|hash|cipher|hmac|digest/i.test(hook.functionName)) {
      evidence.push(`Crypto-related hook: ${hook.functionName}`)
      confidence = Math.min(confidence + 0.2, 0.95)
    }
  }

  // Check requests for encryption-related patterns
  for (const req of requests) {
    // Crypto endpoints
    if (/\/encrypt|\/decrypt|\/sign|\/verify|\/hash|\/cipher/i.test(req.path)) {
      evidence.push(`Request #${req.seq} path matches crypto endpoint: ${req.path}`)
      confidence = Math.min(confidence + 0.2, 0.95)
    }

    // Check for JWE/JWS in request or response
    if (req.requestBody && /^eyJ[A-Za-z0-9_-]+\.eyJ/i.test(req.requestBody)) {
      evidence.push(`Request #${req.seq} body appears to be JWS/JWT`)
      confidence = Math.min(confidence + 0.1, 0.95)
    }
  }

  return {
    scene: SCENES.CRYPTO_ENCRYPTION,
    confidence,
    evidence
  }
}

// --- File Upload Detection ---
function detectFileUpload(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  for (const req of requests) {
    // Check content type for multipart
    const contentType = req.requestHeaders['content-type'] || req.requestHeaders['Content-Type'] || ''
    if (/multipart\/form-data/i.test(contentType)) {
      evidence.push(`Request #${req.seq} uses multipart/form-data: ${req.method} ${req.path}`)
      confidence = Math.min(confidence + 0.35, 0.95)
    }

    // Check for upload endpoints
    if (/\/upload|\/file|\/attachment|\/media/i.test(req.path)) {
      evidence.push(`Request #${req.seq} path matches upload endpoint: ${req.path}`)
      confidence = Math.min(confidence + 0.3, 0.95)
    }

    // Check for base64-encoded binary in request body (heuristic)
    if (req.requestBody && req.requestBody.length > 1000) {
      try {
        const body = JSON.parse(req.requestBody)
        if (body.file || body.data || body.content) {
          const val = body.file || body.data || body.content
          if (typeof val === 'string' && /^data:.*;base64,/.test(val)) {
            evidence.push(`Request #${req.seq} contains base64-encoded file data`)
            confidence = Math.min(confidence + 0.25, 0.95)
          }
        }
      } catch {
        // Not JSON
      }
    }
  }

  return {
    scene: SCENES.FILE_UPLOAD,
    confidence,
    evidence
  }
}

// --- Payment Detection ---
function detectPayment(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  const paymentPatterns = [
    { pattern: /\/payment/i, name: 'Payment endpoint' },
    { pattern: /\/checkout/i, name: 'Checkout endpoint' },
    { pattern: /\/charge/i, name: 'Charge endpoint' },
    { pattern: /\/purchase/i, name: 'Purchase endpoint' },
    { pattern: /\/order/i, name: 'Order endpoint' },
    { pattern: /stripe\.com/i, name: 'Stripe payment' },
    { pattern: /paypal\.com/i, name: 'PayPal payment' },
    { pattern: /alipay/i, name: 'Alipay payment' },
    { pattern: /wechat\.com\/pay/i, name: 'WeChat Pay' },
    { pattern: /epay/i, name: 'ePayment' }
  ]

  for (const req of requests) {
    for (const { pattern, name } of paymentPatterns) {
      if (pattern.test(req.url)) {
        evidence.push(`Request #${req.seq} matches ${name}: ${req.method} ${req.url.substring(0, 80)}`)
        confidence = Math.min(confidence + 0.3, 0.95)
      }
    }

    // Check for payment-related request body fields
    if (req.requestBody) {
      try {
        const body = JSON.parse(req.requestBody)
        const paymentFields = ['amount', 'currency', 'card', 'cvv', 'expiry', 'payment_method']
        const matchCount = Object.keys(body).filter(k =>
          paymentFields.some(pf => k.toLowerCase().includes(pf))
        ).length
        if (matchCount >= 2) {
          evidence.push(`Request #${req.seq} body has ${matchCount} payment-related fields`)
          confidence = Math.min(confidence + 0.25, 0.95)
        }
      } catch {
        // Not JSON
      }
    }
  }

  return {
    scene: SCENES.PAYMENT,
    confidence,
    evidence
  }
}

// --- GraphQL Detection ---
function detectGraphQL(requests: CapturedRequest[]): SceneHint {
  const evidence: string[] = []
  let confidence = 0

  for (const req of requests) {
    // GraphQL endpoint
    if (/\/graphql/i.test(req.path)) {
      evidence.push(`Request #${req.seq} targets GraphQL endpoint: ${req.path}`)
      confidence = Math.min(confidence + 0.5, 0.95)
    }

    // Check for GraphQL query in request body
    if (req.requestBody) {
      try {
        const body = JSON.parse(req.requestBody)
        if (body.query && typeof body.query === 'string') {
          evidence.push(`Request #${req.seq} contains GraphQL query: ${body.query.substring(0, 50)}`)
          confidence = Math.min(confidence + 0.45, 0.95)
        }
        if (body.operationName) {
          evidence.push(`Request #${req.seq} GraphQL operation: ${body.operationName}`)
          confidence = Math.min(confidence + 0.15, 0.95)
        }
        if (body.variables) {
          evidence.push(`Request #${req.seq} includes GraphQL variables`)
          confidence = Math.min(confidence + 0.05, 0.95)
        }
      } catch {
        // Could be a raw query string
        if (/^\s*query\s*\{/i.test(req.requestBody) || /^\s*mutation\s*\{/i.test(req.requestBody)) {
          evidence.push(`Request #${req.seq} body is raw GraphQL query/mutation`)
          confidence = Math.min(confidence + 0.4, 0.95)
        }
      }
    }
  }

  return {
    scene: SCENES.GRAPHQL,
    confidence,
    evidence
  }
}

// --- Helper functions ---

function maskToken(token: string): string {
  if (token.length <= 15) return '***'
  return token.substring(0, 10) + '***' + token.substring(token.length - 5)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.substring(0, maxLen) + '...'
}

// --- Main Detection Function ---

/**
 * Runs all 13 scene detection heuristics against captured requests and JS hooks.
 * Returns only scenes with confidence > 0 (at least some evidence found).
 * Results are sorted by confidence descending.
 */
export function detect(requests: CapturedRequest[], hooks: JsHookRecord[]): SceneHint[] {
  logger.info('Running scene detection', { requestCount: requests.length, hookCount: hooks.length })

  const allHints: SceneHint[] = [
    detectAiChat(requests, hooks),
    detectOAuth(requests),
    detectTokenAuth(requests, hooks),
    detectSessionAuth(requests, hooks),
    detectRegistration(requests),
    detectLogin(requests),
    detectWebSocket(requests),
    detectSSEStream(requests),
    detectGeneralAPI(requests),
    detectCryptoEncryption(requests, hooks),
    detectFileUpload(requests),
    detectPayment(requests),
    detectGraphQL(requests)
  ]

  // Filter to only scenes with evidence
  const detected = allHints
    .filter(h => h.confidence > 0 && h.evidence.length > 0)
    .sort((a, b) => b.confidence - a.confidence)

  logger.info('Scene detection complete', {
    scenesDetected: detected.map(h => `${h.scene}(${h.confidence.toFixed(2)})`)
  })

  return detected
}
