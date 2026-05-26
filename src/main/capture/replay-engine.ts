// Replay Engine - Replays recorded interactions
import { WebContents } from 'electron'
import { InteractionEvent } from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('replay-engine')

export class ReplayEngine {
  async replay(webContents: WebContents, events: InteractionEvent[], speed = 1): Promise<void> {
    logger.info('Replaying interactions', { count: events.length, speed })

    let lastTimestamp = events[0]?.timestamp || 0

    for (const event of events) {
      // Wait for timing difference
      const delay = (event.timestamp - lastTimestamp) / speed
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 5000)))
      }
      lastTimestamp = event.timestamp

      try {
        await this.executeAction(webContents, event)
      } catch (err) {
        logger.error('Replay action failed', { event: event.eventType, error: (err as Error).message })
      }
    }

    logger.info('Replay complete')
  }

  private async executeAction(webContents: WebContents, event: InteractionEvent): Promise<void> {
    const selector = this.sanitizeSelector(event.selector)

    switch (event.eventType) {
      case 'click':
        await webContents.executeJavaScript(`
          const el = document.querySelector('${selector}');
          if (el) { el.click(); }
        `)
        break

      case 'input':
        if (event.value) {
          await webContents.executeJavaScript(`
            const el = document.querySelector('${selector}');
            if (el) {
              el.value = ${JSON.stringify(event.value)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          `)
        }
        break

      case 'scroll':
        await webContents.executeJavaScript(`
          window.scrollTo(0, ${event.y || 0});
        `)
        break

      case 'keydown':
        await webContents.executeJavaScript(`
          const el = document.querySelector('${selector}') || document;
          el.dispatchEvent(new KeyboardEvent('keydown', { key: '${event.value}' }));
        `)
        break
    }
  }

  private sanitizeSelector(selector: string): string {
    return selector.replace(/'/g, "\\'").replace(/"/g, '\\"')
  }
}
