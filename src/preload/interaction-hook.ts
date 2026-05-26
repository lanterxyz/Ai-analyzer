// Interaction hook - Records click, input, scroll, and keydown events
// Injected into target pages via the target-preload

(function() {
  'use strict'

  // Only set up if recording is active
  if (window.__aiAnalyzerInteractionRecording) return
  window.__aiAnalyzerInteractionRecording = true
  window.__aiAnalyzerInteraction = []

  // Generate a CSS selector for an element
  function getSelector(el: Element): string {
    if (el.id) return '#' + el.id
    if (el.className && typeof el.className === 'string') {
      return el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/)[0]
    }
    return el.tagName.toLowerCase()
  }

  // Click events
  document.addEventListener('click', function(e: MouseEvent) {
    const target = e.target as Element
    if (!target) return

    window.__aiAnalyzerInteraction.push({
      eventType: 'click',
      selector: getSelector(target),
      value: null,
      x: e.clientX,
      y: e.clientY,
      timestamp: Date.now()
    })
  }, true)

  // Input events
  document.addEventListener('input', function(e: Event) {
    const target = e.target as Element
    if (!target) return

    window.__aiAnalyzerInteraction.push({
      eventType: 'input',
      selector: getSelector(target),
      value: (target as HTMLInputElement).value || null,
      x: null,
      y: null,
      timestamp: Date.now()
    })
  }, true)

  // Scroll events (throttled)
  let scrollTimeout: number | null = null
  window.addEventListener('scroll', function() {
    if (scrollTimeout) return
    scrollTimeout = window.setTimeout(function() {
      scrollTimeout = null
      window.__aiAnalyzerInteraction.push({
        eventType: 'scroll',
        selector: 'window',
        value: null,
        x: null,
        y: window.scrollY,
        timestamp: Date.now()
      })
    }, 500)
  }, true)

  // Keydown events
  document.addEventListener('keydown', function(e: KeyboardEvent) {
    const target = e.target as Element
    if (!target) return

    window.__aiAnalyzerInteraction.push({
      eventType: 'keydown',
      selector: getSelector(target),
      value: e.key,
      x: null,
      y: null,
      timestamp: Date.now()
    })
  }, true)

  // Focus events
  document.addEventListener('focus', function(e: FocusEvent) {
    const target = e.target as Element
    if (!target) return

    window.__aiAnalyzerInteraction.push({
      eventType: 'focus',
      selector: getSelector(target),
      value: null,
      x: null,
      y: null,
      timestamp: Date.now()
    })
  }, true)

  // Blur events
  document.addEventListener('blur', function(e: FocusEvent) {
    const target = e.target as Element
    if (!target) return

    window.__aiAnalyzerInteraction.push({
      eventType: 'blur',
      selector: getSelector(target),
      value: null,
      x: null,
      y: null,
      timestamp: Date.now()
    })
  }, true)
})()
