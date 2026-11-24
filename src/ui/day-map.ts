import {
  color,
  duration,
  time,
  type Day,
  type Entry,
  type Range,
} from '../data/model'
import { esc, icon } from './icons'

const top = 27,
  row = 39
export class DayMap {
  private canvas = document.createElement('canvas')
  private labels = document.createElement('div')
  private tip = document.createElement('div')
  private data?: Day
  private range: Range = [0, 1]
  private tracks: Entry[][] = []
  private gesture: { x: number; current: number } | null = null
  private hover: number | null = null
  constructor(
    private root: HTMLElement,
    private zoom: (range: Range | null) => void,
    private inspect: (e: Entry, anchor: HTMLElement, pinned: boolean) => void,
  ) {
    this.labels.className = 'lane-labels'
    this.tip.className = 'map-tip'
    this.tip.hidden = true
    this.canvas.setAttribute(
      'aria-label',
      'Watcher activity timeline. Drag horizontally to zoom. Use the event stream to inspect individual records.',
    )
    root.append(this.labels, this.canvas, this.tip)
    new ResizeObserver(() => this.draw()).observe(this.canvas)
    const point = (e: PointerEvent) => {
      const b = this.canvas.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(b.width, e.clientX - b.left)),
        y: e.clientY - b.top,
      }
    }
    this.canvas.onpointerdown = (e) => {
      if (e.button !== 0) return
      const { x } = point(e)
      this.canvas.setPointerCapture(e.pointerId)
      this.gesture = { x, current: x }
      this.tip.hidden = true
    }
    this.canvas.onpointermove = (e) => {
      const { x, y } = point(e)
      this.hover = x
      if (this.gesture) this.gesture.current = x
      else {
        const entry = this.hit(x, y),
          t = this.at(x)
        this.tip.innerHTML =
          '<b>' +
          esc(time(t, true)) +
          '</b>' +
          (entry
            ? '<span>' +
              esc(
                entry.kind === 'presence' && entry.label === 'Away'
                  ? 'Idle'
                  : entry.label,
              ) +
              ' · ' +
              esc(duration(entry.end - entry.start)) +
              '</span>' +
              (entry.detail
                ? '<strong class="map-tip-title">' +
                  esc(entry.detail) +
                  '</strong>'
                : '')
            : '')
        this.tip.hidden = false
        this.tip.style.left =
          Math.max(
            0,
            Math.min(
              this.root.clientWidth - this.tip.offsetWidth,
              this.canvas.offsetLeft + x + 10,
            ),
          ) + 'px'
        this.tip.style.top = Math.max(0, y - this.tip.offsetHeight - 8) + 'px'
      }
      this.draw()
    }
    this.canvas.onpointerup = (e) => {
      if (!this.gesture) return
      const { x, y } = point(e),
        a = this.gesture.x
      this.gesture = null
      this.canvas.releasePointerCapture(e.pointerId)
      this.hover = null
      if (Math.abs(x - a) >= 5)
        this.zoom([this.at(Math.min(x, a)), this.at(Math.max(x, a))])
      else {
        const entry = this.hit(x, y)
        if (entry) {
          this.tip.hidden = true
          this.inspect(entry, this.canvas, true)
        }
      }
      this.draw()
    }
    this.canvas.onpointercancel = () => {
      this.gesture = null
      this.hover = null
      this.draw()
    }
    this.canvas.ondblclick = () => this.zoom(null)
    this.canvas.onpointerleave = () => {
      this.tip.hidden = true
      if (!this.gesture) {
        this.hover = null
        this.draw()
      }
    }
  }
  update(data: Day, range: Range) {
    if (data !== this.data) {
      this.data = data
      this.tracks = data.lanes.map((l) =>
        data.entries.filter((e) => e.lane === l.id),
      )
      this.labels.innerHTML = data.lanes
        .map(
          (l) =>
            '<div title="' +
            esc(l.id) +
            '">' +
            icon(l.kind, 15) +
            '<span>' +
            esc(l.label) +
            '</span></div>',
        )
        .join('')
    }
    this.range = range
    this.canvas.style.height = top + Math.max(1, data.lanes.length) * row + 'px'
    this.tip.hidden = true
    this.draw()
  }
  private at(x: number) {
    return (
      this.range[0] +
      (x / Math.max(1, this.canvas.clientWidth)) *
        (this.range[1] - this.range[0])
    )
  }
  private hit(x: number, y: number) {
    const line = this.tracks[Math.floor((y - top) / row)]
    if (!line) return
    const pos = this.at(x),
      tolerance =
        (this.range[1] - this.range[0]) / Math.max(1, this.canvas.clientWidth)
    let low = 0,
      high = line.length
    while (low < high) {
      const m = (low + high) >>> 1
      if (line[m].start <= pos) low = m + 1
      else high = m
    }
    const entry = line[low - 1]
    if (entry && Math.max(entry.end, entry.start + tolerance) >= pos)
      return entry
  }
  private draw() {
    const c = this.canvas,
      w = c.clientWidth,
      h = c.clientHeight,
      dpr = window.devicePixelRatio || 1
    if (!w || !h) return
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const [a, b] = this.range,
      span = b - a,
      xpos = (ms: number) => ((ms - a) / span) * w
    const trackY = (i: number) => top + i * row + 7
    const steps = [
      1000, 5000, 15000, 30000, 60000, 300000, 900000, 1800000, 3600000,
      7200000, 10800000, 21600000, 43200000,
    ]
    const step =
      steps.find((s) => s >= span / Math.max(2, Math.floor(w / 78))) ||
      steps.at(-1)!
    const anchor = new Date(a)
    anchor.setHours(0, 0, 0, 0)
    const ticks = [a]
    for (
      let t = +anchor + Math.ceil((a - +anchor) / step) * step;
      t < b;
      t += step
    )
      if (xpos(t) > 47 && w - xpos(t) > 47) ticks.push(t)
    ticks.push(b)
    ctx.font = '11px ui-monospace, Consolas, monospace'
    ticks.forEach((t, i) => {
      const x = xpos(t)
      ctx.fillStyle = '#aeb8cf'
      ctx.textAlign =
        i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center'
      ctx.fillText(time(t, span < 120000), x, 14)
      ctx.fillStyle = '#3a4258'
      ctx.fillRect(Math.min(w - 1, Math.round(x)), 22, 1, h - 22)
    })
    this.tracks.forEach((track, i) => {
      const y = trackY(i)
      for (const e of track) {
        if (e.start >= b) break
        if (e.end < a) continue
        const x = Math.max(0, xpos(e.start)),
          width = Math.max(1, Math.min(w, xpos(e.end)) - x)
        ctx.fillStyle = color(e.label)
        ctx.fillRect(x, y, width, 24)
        if (width > 65) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(x + 4, y, width - 8, 24)
          ctx.clip()
          ctx.font = '500 11px Inter Variable, sans-serif'
          ctx.fillStyle = '#182034'
          ctx.textAlign = 'left'
          ctx.fillText(
            e.kind === 'presence' && e.label === 'Away' ? 'Idle' : e.label,
            x + 7,
            y + 16,
          )
          ctx.restore()
        }
      }
    })
    if (this.gesture) {
      const x = Math.min(this.gesture.x, this.gesture.current),
        width = Math.abs(this.gesture.current - this.gesture.x)
      ctx.fillStyle = 'rgba(211,205,255,.23)'
      ctx.fillRect(x, 21, width, h - 21)
      ctx.strokeStyle = '#d4ccff'
      ctx.strokeRect(x, 21, width, h - 22)
    } else if (this.hover !== null) {
      ctx.fillStyle = '#e8e7ff'
      ctx.fillRect(this.hover, 20, 1, h - 20)
    }
  }
}
