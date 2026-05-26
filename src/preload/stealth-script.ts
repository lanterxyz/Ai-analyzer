// Stealth script - Browser fingerprint spoofing
// Injected into target pages to disguise automation and prevent detection

(function() {
  'use strict'

  // Overwrite navigator properties
  const originalNavigator = window.navigator

  // WebGL fingerprint spoofing
  const getParameter = WebGLRenderingContext.prototype.getParameter
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    // UNMASKED_VENDOR_WEBGL
    if (parameter === 0x9245) return 'Google Inc. (NVIDIA)'
    // UNMASKED_RENDERER_WEBGL
    if (parameter === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060, OpenGL 4.5)'
    return getParameter.call(this, parameter)
  }

  // Canvas fingerprint noise
  const toDataURL = HTMLCanvasElement.prototype.toDataURL
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    const context = this.getContext('2d')
    if (context) {
      // Add minimal noise
      const imageData = context.getImageData(0, 0, this.width, this.height)
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = imageData.data[i] ^ (Math.random() * 2 | 0)
      }
      context.putImageData(imageData, 0, 0)
    }
    return toDataURL.apply(this, arguments as any)
  }

  // AudioContext fingerprint
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (AudioContext) {
    const originalGetChannelData = AudioBuffer.prototype.getChannelData
    AudioBuffer.prototype.getChannelData = function(channel) {
      const data = originalGetChannelData.call(this, channel)
      if (data.length > 0) {
        // Add tiny noise
        data[0] += Math.random() * 0.0000001
      }
      return data
    }
  }

  // Prevent webdriver detection
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true
  })

  // Hide automation indicators
  delete (window as any).__selenium_unwrapped
  delete (window as any).__webdriver_evaluate
  delete (window as any).__driver_evaluate
  delete (window as any).__webdriver_unwrapped
  delete (window as any).__driver_unwrapped
  delete (window as any).__selenium_evaluate
  delete (window as any).__fxdriver_evaluate

  // Override navigator.plugins for fingerprint consistency
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' }
      ]
      const pluginArray = Object.create(PluginArray.prototype)
      plugins.forEach((p, i) => {
        Object.defineProperty(pluginArray, i, { value: p, enumerable: true })
      })
      Object.defineProperty(pluginArray, 'length', { value: plugins.length })
      return pluginArray
    },
    configurable: true
  })

  // Screen properties
  Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true })
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true })

  console.log('[Ai-analyzer] Stealth script injected')
})()
