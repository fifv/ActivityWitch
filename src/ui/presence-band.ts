import { color } from '../data/model'
import type { PresenceSpan } from '../data/presence'

export function drawPresenceBand(
  ctx: CanvasRenderingContext2D,
  spans: PresenceSpan[],
  width: number,
  y: number,
  height: number,
) {
  for (const span of spans) {
    ctx.fillStyle = color(span.idle ? 'Away' : 'Active')
    ctx.fillRect(
      (width * span.from) / 1440,
      y,
      (width * (span.until - span.from)) / 1440,
      height,
    )
  }
}
