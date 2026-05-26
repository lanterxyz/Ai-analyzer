// ============================================================================
// Hook Injection Script
// Self-contained IIFE that intercepts browser APIs and reports via postMessage
// This script is injected into target page contexts via executeJavaScript
// ============================================================================

;(function() {
  'use strict'

  // Guard against double injection
  if (window.__aiAnalyzerHooksInstalled) return
  window.__aiAnalyzerHooksInstalled = true

  // --- Utility: Capture call stack as string ---
  function captureCallStack(): string {
    try {
      throw new Error()
    } catch (e: any) {
      const stack = e.stack || ''
      // Remove the first 2 lines (Error and this function)
      const lines = stack.split('\n').slice(2, 12)
      return lines.join('\n')
    }
  }

  // --- Utility: Safely serialize values ---
  function safeSerialize(value: any, maxDepth: number = 3): string {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'

    const type = typeof value
    if (type === 'number' || type === 'boolean') return String(value)
    if (type === 'string') {
      // Truncate long strings
      if (value.length > 500) return value.substring(0, 500) + '...[truncated]'
      return value
    }
    if (type === 'function') return '[Function: ' + (value.name || 'anonymous') + ']'
    if (type === 'symbol') return value.toString()

    // Objects and arrays
    if (maxDepth <= 0) return '[Object]'
    try {
      if (value instanceof ArrayBuffer) {
        return '[ArrayBuffer: ' + value.byteLength + ' bytes]'
      }
      if (ArrayBuffer.isView(value)) {
        return '[TypedArray: ' + value.byteLength + ' bytes]'
      }
      if (value instanceof Blob) {
        return '[Blob: ' + value.size + ' bytes, type=' + value.type + ']'
      }
      return JSON.stringify(value, (_, v) => {
        if (typeof v === 'function') return '[Function]'
        if (v instanceof ArrayBuffer) return '[ArrayBuffer: ' + v.byteLength + ' bytes]'
        if (ArrayBuffer.isView(v)) return '[TypedArray: ' + v.byteLength + ' bytes]'
        if (v instanceof Blob) return '[Blob: ' + v.size + ' bytes]'
        return v
      })
    } catch {
      return String(value)
    }
  }

  // --- Utility: Post hook data to the main world ---
  function postHookCapture(hookType: string, functionName: string, args: any[], returnValue: any): void {
    try {
      window.postMessage({
        type: 'HOOK_CAPTURE',
        hookType: hookType,
        functionName: functionName,
        args: args.map((a: any) => safeSerialize(a)),
        returnValue: safeSerialize(returnValue),
        callStack: captureCallStack(),
        timestamp: Date.now()
      }, '*')
    } catch {}
  }

  // ========================================================================
  // 1. Fetch API Interception
  // ========================================================================

  const originalFetch = window.fetch

  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const url = typeof input === 'string' ? input :
        input instanceof URL ? input.href :
          (input as Request).url || ''

      const method = init?.method || (typeof input !== 'string' && (input as Request).method) || 'GET'

      const headerObj: Record<string, string> = {}
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => { headerObj[key] = value })
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headerObj[key] = value
          }
        } else {
          Object.assign(headerObj, init.headers)
        }
      }

      const body = init?.body ? safeSerialize(init.body) : null

      postHookCapture('fetch', 'fetch', [
        { url, method, headers: headerObj, body }
      ], null)
    } catch {}

    const promise = originalFetch.call(this, input, init)

    // Capture response
    promise.then((response: Response) => {
      try {
        const respHeaders: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          respHeaders[key] = value
        })

        // Clone response to read body without consuming it
        const cloned = response.clone()
        cloned.text().then((bodyText: string) => {
          postHookCapture('fetch', 'fetch.response', [
            {
              url: response.url,
              status: response.status,
              statusText: response.statusText,
              headers: respHeaders,
              body: bodyText
            }
          ], { status: response.status, ok: response.ok })
        }).catch(() => {
          postHookCapture('fetch', 'fetch.response', [
            {
              url: response.url,
              status: response.status,
              statusText: response.statusText,
              headers: respHeaders,
              body: null
            }
          ], { status: response.status })
        })
      } catch {}
      return response
    }).catch(() => {})

    return promise
  }

  // Preserve toString for stealth
  window.fetch.toString = function() { return 'function fetch() { [native code] }' }

  // ========================================================================
  // 2. XMLHttpRequest Interception
  // ========================================================================

  const OriginalXHR = window.XMLHttpRequest
  const originalXHROpen = OriginalXHR.prototype.open
  const originalXHRSend = OriginalXHR.prototype.send

  // Store metadata on XHR instances
  const xhrMetadata = new WeakMap<XMLHttpRequest, { method: string; url: string; async: boolean }>()

  OriginalXHR.prototype.open = function(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    xhrMetadata.set(this, {
      method: method,
      url: typeof url === 'string' ? url : url.href,
      async: async !== false
    })

    postHookCapture('xhr', 'XMLHttpRequest.open', [method, typeof url === 'string' ? url : url.href], null)

    return originalXHROpen.call(this, method, url, async as any, username as any, password as any)
  }

  OriginalXHR.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = xhrMetadata.get(this)

    if (meta) {
      postHookCapture('xhr', 'XMLHttpRequest.send', [
        { method: meta.method, url: meta.url, body: safeSerialize(body) }
      ], null)
    }

    // Capture response on load
    const originalOnLoad = this.onload
    this.addEventListener('load', function() {
      try {
        const self = this as XMLHttpRequest
        const m = xhrMetadata.get(self)
        const respHeaders: Record<string, string> = {}
        const headerStr = self.getAllResponseHeaders()
        if (headerStr) {
          const lines = headerStr.trim().split(/\r?\n/)
          for (const line of lines) {
            const idx = line.indexOf(':')
            if (idx > 0) {
              const key = line.substring(0, idx).trim().toLowerCase()
              const value = line.substring(idx + 1).trim()
              respHeaders[key] = value
            }
          }
        }

        postHookCapture('xhr', 'XMLHttpRequest.onload', [{
          method: m?.method,
          url: m?.url || self.responseURL,
          status: self.status,
          statusText: self.statusText,
          headers: respHeaders,
          response: safeSerialize(self.response),
          responseType: self.responseType
        }], { status: self.status })
      } catch {}
    })

    // Capture error
    this.addEventListener('error', function() {
      try {
        const m = xhrMetadata.get(this as XMLHttpRequest)
        postHookCapture('xhr', 'XMLHttpRequest.error', [{
          method: m?.method,
          url: m?.url
        }], null)
      } catch {}
    })

    return originalXHRSend.call(this, body)
  }

  OriginalXHR.prototype.open.toString = function() { return 'function open() { [native code] }' }
  OriginalXHR.prototype.send.toString = function() { return 'function send() { [native code] }' }

  // ========================================================================
  // 3. crypto.subtle Interception
  // ========================================================================

  if (window.crypto && window.crypto.subtle) {
    const subtle = window.crypto.subtle
    const cryptoMethods = ['encrypt', 'decrypt', 'sign', 'verify', 'digest', 'generateKey',
      'deriveKey', 'deriveBits', 'importKey', 'exportKey', 'wrapKey', 'unwrapKey']

    for (const methodName of cryptoMethods) {
      const original = (subtle as any)[methodName]
      if (typeof original !== 'function') continue

      ;(subtle as any)[methodName] = function(...args: any[]) {
        // Serialize algorithm parameter specially
        const serializedArgs = args.map((arg, idx) => {
          if (idx === 0 && typeof arg === 'object') {
            // Algorithm param - include name and all fields
            return safeSerialize(arg)
          }
          if (arg instanceof ArrayBuffer || ArrayBuffer.isView(arg)) {
            const bytes = arg instanceof ArrayBuffer ? arg.byteLength : (arg as any).byteLength
            return '[BinaryData: ' + bytes + ' bytes]'
          }
          return safeSerialize(arg)
        })

        postHookCapture('crypto_subtle', 'crypto.subtle.' + methodName, serializedArgs, null)

        const result = original.apply(this, args)

        // All crypto.subtle methods return Promises
        result.then((value: any) => {
          let serializedResult: any
          if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
            serializedResult = '[BinaryResult: ' +
              (value instanceof ArrayBuffer ? value.byteLength : (value as any).byteLength) + ' bytes]'
          } else if (typeof value === 'object' && value !== null) {
            // CryptoKey or similar
            serializedResult = safeSerialize(value)
          } else {
            serializedResult = safeSerialize(value)
          }

          postHookCapture('crypto_subtle', 'crypto.subtle.' + methodName + '.result', [], serializedResult)
          return value
        }).catch(() => {})

        return result
      }

      // Stealth
      ;(subtle as any)[methodName].toString = function() {
        return 'function ' + methodName + '() { [native code] }'
      }
    }
  }

  // ========================================================================
  // 4. CryptoJS Interception (if loaded)
  // ========================================================================

  function hookCryptoJS(): void {
    const CJ = (window as any).CryptoJS
    if (!CJ) return

    const methods = ['encrypt', 'decrypt', 'HmacSHA1', 'HmacSHA256', 'HmacSHA512',
      'SHA1', 'SHA256', 'SHA512', 'MD5', 'AES', 'DES', 'TripleDES', 'Rabbit', 'RC4']

    for (const methodName of methods) {
      const target = CJ[methodName]
      if (!target || typeof target !== 'function') continue

      const original = target
      CJ[methodName] = function(...args: any[]) {
        postHookCapture('cryptojs', 'CryptoJS.' + methodName, args.map((a: any) => safeSerialize(a)), null)

        const result = original.apply(this, args)

        let serialized: any
        if (result && typeof result.toString === 'function') {
          try {
            serialized = result.toString()
          } catch {
            serialized = safeSerialize(result)
          }
        } else {
          serialized = safeSerialize(result)
        }

        postHookCapture('cryptojs', 'CryptoJS.' + methodName + '.result', [], serialized)
        return result
      }

      CJ[methodName].toString = function() {
        return 'function ' + methodName + '() { [native code] }'
      }
    }

    // Also hook on CryptoJS.enc if present
    if (CJ.enc) {
      const encMethods = ['Hex', 'Base64', 'Latin1', 'Utf8', 'Utf16', 'Utf16LE']
      for (const m of encMethods) {
        if (CJ.enc[m] && CJ.enc[m].stringify) {
          const origStringify = CJ.enc[m].stringify
          CJ.enc[m].stringify = function(...args: any[]) {
            postHookCapture('cryptojs', 'CryptoJS.enc.' + m + '.stringify', args.map((a: any) => safeSerialize(a)), null)
            const result = origStringify.apply(this, args)
            postHookCapture('cryptojs', 'CryptoJS.enc.' + m + '.stringify.result', [], safeSerialize(result))
            return result
          }
        }
      }
    }
  }

  // Check if CryptoJS is already loaded
  hookCryptoJS()

  // Also watch for late-loaded CryptoJS via MutationObserver
  let cryptoJsHooked = !!(window as any).CryptoJS
  if (!cryptoJsHooked) {
    const observer = new MutationObserver(() => {
      if (!cryptoJsHooked && (window as any).CryptoJS) {
        cryptoJsHooked = true
        hookCryptoJS()
        observer.disconnect()
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  // ========================================================================
  // 5. SM2/SM3/SM4 National Crypto Interception (if loaded)
  // ========================================================================

  function hookSMCrypto(): void {
    // sm-crypto library pattern
    const smCrypto = (window as any).sm2 || (window as any).smCrypto
    const sm3Lib = (window as any).sm3
    const sm4Lib = (window as any).sm4

    // SM2
    if (smCrypto) {
      const sm2Methods = ['encrypt', 'decrypt', 'doEncrypt', 'doDecrypt', 'doSignature', 'doVerifySignature']
      for (const method of sm2Methods) {
        if (typeof smCrypto[method] !== 'function') continue
        const original = smCrypto[method]
        smCrypto[method] = function(...args: any[]) {
          postHookCapture('sm2', 'sm2.' + method, args.map((a: any) => safeSerialize(a)), null)
          const result = original.apply(this, args)
          postHookCapture('sm2', 'sm2.' + method + '.result', [], safeSerialize(result))
          return result
        }
        smCrypto[method].toString = function() {
          return 'function ' + method + '() { [native code] }'
        }
      }
    }

    // SM3
    if (sm3Lib) {
      if (typeof sm3Lib === 'function') {
        const original = sm3Lib
        ;(window as any).sm3 = function(...args: any[]) {
          postHookCapture('sm3', 'sm3', args.map((a: any) => safeSerialize(a)), null)
          const result = original.apply(this, args)
          postHookCapture('sm3', 'sm3.result', [], safeSerialize(result))
          return result
        }
      } else if (sm3Lib.sm3 && typeof sm3Lib.sm3 === 'function') {
        const original = sm3Lib.sm3
        sm3Lib.sm3 = function(...args: any[]) {
          postHookCapture('sm3', 'sm3.sm3', args.map((a: any) => safeSerialize(a)), null)
          const result = original.apply(this, args)
          postHookCapture('sm3', 'sm3.sm3.result', [], safeSerialize(result))
          return result
        }
      }
    }

    // SM4
    if (sm4Lib) {
      const sm4Methods = ['encrypt', 'decrypt']
      for (const method of sm4Methods) {
        if (typeof sm4Lib[method] !== 'function') continue
        const original = sm4Lib[method]
        sm4Lib[method] = function(...args: any[]) {
          postHookCapture('sm4', 'sm4.' + method, args.map((a: any) => safeSerialize(a)), null)
          const result = original.apply(this, args)
          postHookCapture('sm4', 'sm4.' + method + '.result', [], safeSerialize(result))
          return result
        }
        sm4Lib[method].toString = function() {
          return 'function ' + method + '() { [native code] }'
        }
      }
    }
  }

  // Check if SM crypto libs are already loaded
  hookSMCrypto()

  // Watch for late-loaded SM crypto
  let smCryptoHooked = !!(window as any).sm2 || !!(window as any).sm3 || !!(window as any).sm4
  if (!smCryptoHooked) {
    const smObserver = new MutationObserver(() => {
      if (!smCryptoHooked && ((window as any).sm2 || (window as any).sm3 || (window as any).sm4)) {
        smCryptoHooked = true
        hookSMCrypto()
        smObserver.disconnect()
      }
    })
    smObserver.observe(document.documentElement, { childList: true, subtree: true })
  }

  // ========================================================================
  // 6. document.cookie Setter Interception
  // ========================================================================

  try {
    const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
      Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie')

    if (originalCookieDescriptor && originalCookieDescriptor.set) {
      const originalSet = originalCookieDescriptor.set

      Object.defineProperty(document, 'cookie', {
        get: originalCookieDescriptor.get,
        set: function(value: string) {
          postHookCapture('cookie', 'document.cookie.set', [value], null)
          return originalSet!.call(this, value)
        },
        configurable: true,
        enumerable: true
      })

      // Try to stealth the setter
      try {
        Object.defineProperty(Object.getOwnPropertyDescriptor(document, 'cookie')!.set!, 'toString', {
          value: function() { return 'function set() { [native code] }' },
          configurable: true
        })
      } catch {}
    }
  } catch (e) {
    // Some environments restrict Document.prototype access
  }

  // ========================================================================
  // 7. Cookie change detection via polling (fallback)
  // ========================================================================

  let lastCookieString = document.cookie
  setInterval(() => {
    const currentCookie = document.cookie
    if (currentCookie !== lastCookieString) {
      // Determine what changed
      const oldCookies = new Map(
        lastCookieString.split(';').map(c => {
          const [k, ...v] = c.trim().split('=')
          return [k, v.join('=')]
        })
      )
      const newCookies = new Map(
        currentCookie.split(';').map(c => {
          const [k, ...v] = c.trim().split('=')
          return [k, v.join('=')]
        })
      )

      for (const [key, value] of newCookies) {
        if (oldCookies.get(key) !== value) {
          postHookCapture('cookie', 'document.cookie.changed', [key + '=' + value], null)
        }
      }

      lastCookieString = currentCookie
    }
  }, 1000)

  console.log('[Ai-analyzer] Hook injection complete')
})()
