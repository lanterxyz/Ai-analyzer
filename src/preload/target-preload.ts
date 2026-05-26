// ============================================================================
// Target Preload Script
// Preload for target browser pages (BrowserView)
// Relays hook captures and interaction events from the page to the main process
// ============================================================================

import { ipcRenderer, contextBridge } from 'electron'
import { RENDERER_EVENTS } from '../shared/types'

// ============================================================================
// Expose minimal API for page interaction
// ============================================================================

contextBridge.exposeInMainWorld('__aiAnalyzerTarget', {
  isTargetPage: true,
  version: '1.0.0'
})

// ============================================================================
// Listen for HOOK_CAPTURE messages from the injected hook script
// The hook script runs in the page context and sends data via
// window.postMessage. We intercept those here and forward to main process.
// ============================================================================

window.addEventListener('message', (event: MessageEvent) => {
  // Only accept messages from the same window
  if (event.source !== window) return

  const data = event.data
  if (!data || typeof data !== 'object') return

  // --- Hook Capture Relay ---
  if (data.type === 'HOOK_CAPTURE') {
    try {
      // Forward to main process via IPC
      ipcRenderer.send('hook:captured-relay', {
        hookType: data.hookType,
        functionName: data.functionName,
        args: typeof data.args === 'string' ? data.args : JSON.stringify(data.args || []),
        returnValue: data.returnValue ? (typeof data.returnValue === 'string' ? data.returnValue : JSON.stringify(data.returnValue)) : null,
        callStack: data.callStack || '',
        timestamp: data.timestamp || Date.now(),
        sessionId: null, // Will be filled by CaptureEngine
        requestId: null  // Will be correlated by CaptureEngine
      })
    } catch (err) {
      // IPC may fail during shutdown
    }
  }

  // --- Interaction Capture Relay ---
  if (data.type === 'INTERACTION_CAPTURE') {
    try {
      ipcRenderer.send('interaction:captured-relay', {
        eventType: data.eventType,
        selector: data.selector,
        value: data.value || null,
        x: data.x || null,
        y: data.y || null,
        timestamp: data.timestamp || Date.now()
      })
    } catch {}
  }
})

// ============================================================================
// Inject interaction capture listeners into the page context
// These run in the page context and send INTERACTION_CAPTURE messages
// ============================================================================

// We use executeJavaScript from the main process to inject interaction hooks.
// However, for早早y load pages, we also inject a lightweight listener here
// that captures basic interactions and posts them as messages.

;(function injectInteractionCapture() {
  // Only inject if recording is requested
  // The main process will inject the full interaction recorder via executeJavaScript
  // This provides a basic fallback
  try {
    const script = document.createElement('script')
    script.textContent = `
      ;(function() {
        if (window.__aiAnalyzerInteractionCaptureInstalled) return;
        window.__aiAnalyzerInteractionCaptureInstalled = true;

        function getSelector(el) {
          if (!el || el === document) return 'document';
          if (el === window) return 'window';
          if (el.id) return '#' + el.id;
          if (el.className && typeof el.className === 'string') {
            return el.tagName + '.' + el.className.split(' ')[0];
          }
          return el.tagName;
        }

        document.addEventListener('click', function(e) {
          try {
            window.postMessage({
              type: 'INTERACTION_CAPTURE',
              eventType: 'click',
              selector: getSelector(e.target),
              value: null,
              x: e.clientX,
              y: e.clientY,
              timestamp: Date.now()
            }, '*');
          } catch(__e) {}
        }, true);

        document.addEventListener('input', function(e) {
          try {
            window.postMessage({
              type: 'INTERACTION_CAPTURE',
              eventType: 'input',
              selector: getSelector(e.target),
              value: e.target.value || null,
              x: null,
              y: null,
              timestamp: Date.now()
            }, '*');
          } catch(__e) {}
        }, true);

        document.addEventListener('scroll', function() {
          try {
            window.postMessage({
              type: 'INTERACTION_CAPTURE',
              eventType: 'scroll',
              selector: 'window',
              value: null,
              x: null,
              y: window.scrollY,
              timestamp: Date.now()
            }, '*');
          } catch(__e) {}
        }, true);

        document.addEventListener('keydown', function(e) {
          try {
            window.postMessage({
              type: 'INTERACTION_CAPTURE',
              eventType: 'keydown',
              selector: getSelector(e.target),
              value: e.key,
              x: null,
              y: null,
              timestamp: Date.now()
            }, '*');
          } catch(__e) {}
        }, true);

        document.addEventListener('focus', function(e) {
          try {
            window.postMessage({
              type: 'INTERACTION_CAPTURE',
              eventType: 'focus',
              selector: getSelector(e.target),
              value: null,
              x: null,
              y: null,
              timestamp: Date.now()
            }, '*');
          } catch(__e) {}
        }, true);

        document.addEventListener('blur', function(e) {
          try {
            window.postMessage({
              type: 'INTERACTION_CAPTURE',
              eventType: 'blur',
              selector: getSelector(e.target),
              value: null,
              x: null,
              y: null,
              timestamp: Date.now()
            }, '*');
          } catch(__e) {}
        }, true);
      })();
    `
    document.documentElement.appendChild(script)
    script.remove() // Clean up - the code is already executing
  } catch {
    // Script injection may fail in some contexts
  }
})()

// ============================================================================
// Forward main-process commands to the page
// ============================================================================

// Listen for commands from main process that need to execute in page context
ipcRenderer.on('target:executeScript', (_event, scriptBody: string) => {
  try {
    const script = document.createElement('script')
    script.textContent = scriptBody
    document.documentElement.appendChild(script)
    script.remove()
  } catch {}
})

// Listen for fingerprint override injection
ipcRenderer.on('target:applyFingerprint', (_event, overridesJson: string) => {
  try {
    const script = document.createElement('script')
    script.textContent = `
      ;(function() {
        const overrides = ${overridesJson};
        Object.defineProperty(navigator, 'userAgent', { get: () => overrides.userAgent });
        Object.defineProperty(navigator, 'platform', { get: () => overrides.platform });
        Object.defineProperty(navigator, 'language', { get: () => overrides.language });
        Object.defineProperty(navigator, 'languages', { get: () => overrides.languages });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => overrides.deviceMemory });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => overrides.hardwareConcurrency });
        if (window.screen) {
          const res = (overrides.screenResolution || '1920,1080').split(',').map(Number);
          const availRes = (overrides.availableScreenResolution || '1920,1040').split(',').map(Number);
          Object.defineProperty(screen, 'width', { get: () => res[0] });
          Object.defineProperty(screen, 'height', { get: () => res[1] });
          Object.defineProperty(screen, 'availWidth', { get: () => availRes[0] });
          Object.defineProperty(screen, 'availHeight', { get: () => availRes[1] });
          Object.defineProperty(screen, 'colorDepth', { get: () => overrides.colorDepth || 24 });
          Object.defineProperty(screen, 'pixelDepth', { get: () => overrides.colorDepth || 24 });
        }
      })();
    `
    document.documentElement.appendChild(script)
    script.remove()
  } catch {}
})

// ============================================================================
// Storage data collection helper
// Main process can request localStorage/sessionStorage data from the page
// ============================================================================

ipcRenderer.on('target:collectStorage', () => {
  try {
    const localStorageData: Array<{ key: string; value: string }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) {
        localStorageData.push({ key, value: localStorage.getItem(key) || '' })
      }
    }

    const sessionStorageData: Array<{ key: string; value: string }> = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key) {
        sessionStorageData.push({ key, value: sessionStorage.getItem(key) || '' })
      }
    }

    ipcRenderer.send('target:storageData', {
      localStorage: localStorageData,
      sessionStorage: sessionStorageData
    })
  } catch {}
})
