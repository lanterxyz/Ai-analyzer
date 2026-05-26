// Interaction Recorder - Records user browser interactions
import { WebContents } from 'electron'
import { InteractionEvent } from '@shared/types'
import { v4 as uuid } from 'uuid'
import { createLogger } from '../logger'

const logger = createLogger('interaction-recorder')

export class InteractionRecorder {
  private recording = false
  private sessionId: string | null = null
  private webContents: WebContents | null = null
  private events: InteractionEvent[] = []

  start(sessionId: string, webContents: WebContents): void {
    this.recording = true
    this.sessionId = sessionId
    this.webContents = webContents
    this.events = []

    // Inject interaction hook
    webContents.executeJavaScript(`
      (function() {
        if (window.__aiAnalyzerInteractionRecording) return;
        window.__aiAnalyzerInteractionRecording = true;

        document.addEventListener('click', (e) => {
          const selector = e.target.id ? '#' + e.target.id :
            e.target.className ? e.target.tagName + '.' + e.target.className.split(' ')[0] :
            e.target.tagName;
          window.__aiAnalyzerInteraction = window.__aiAnalyzerInteraction || [];
          window.__aiAnalyzerInteraction.push({
            eventType: 'click',
            selector,
            value: null,
            x: e.clientX,
            y: e.clientY,
            timestamp: Date.now()
          });
        }, true);

        document.addEventListener('input', (e) => {
          const selector = e.target.id ? '#' + e.target.id :
            e.target.className ? e.target.tagName + '.' + e.target.className.split(' ')[0] :
            e.target.tagName;
          window.__aiAnalyzerInteraction = window.__aiAnalyzerInteraction || [];
          window.__aiAnalyzerInteraction.push({
            eventType: 'input',
            selector,
            value: e.target.value,
            x: null,
            y: null,
            timestamp: Date.now()
          });
        }, true);

        document.addEventListener('scroll', () => {
          window.__aiAnalyzerInteraction = window.__aiAnalyzerInteraction || [];
          window.__aiAnalyzerInteraction.push({
            eventType: 'scroll',
            selector: 'window',
            value: null,
            x: null,
            y: window.scrollY,
            timestamp: Date.now()
          });
        }, true);
      })();
    `).catch(() => {})

    logger.info('Interaction recorder started', { sessionId })
  }

  stop(): InteractionEvent[] {
    this.recording = false
    const events = [...this.events]
    this.events = []
    this.webContents = null
    this.sessionId = null
    logger.info('Interaction recorder stopped', { eventCount: events.length })
    return events
  }

  isRecording(): boolean {
    return this.recording
  }

  async collectEvents(): Promise<InteractionEvent[]> {
    if (!this.webContents || !this.sessionId) return []

    try {
      const raw = await this.webContents.executeJavaScript(
        'window.__aiAnalyzerInteraction || []'
      )

      const events: InteractionEvent[] = raw.map((e: any) => ({
        id: uuid(),
        sessionId: this.sessionId!,
        eventType: e.eventType,
        selector: e.selector,
        value: e.value || null,
        x: e.x || null,
        y: e.y || null,
        timestamp: e.timestamp
      }))

      this.events.push(...events)
      return events
    } catch {
      return []
    }
  }
}
