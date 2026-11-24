import { bounds, color, duration, type Lane } from '../data/model'
import { slots, type WeekSummary } from '../data/weekly'
import { esc, icon } from './icons'
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const labelTime = (slot: number) =>
  String(Math.floor(slot / 4)).padStart(2, '0') +
  ':' +
  String((slot % 4) * 15).padStart(2, '0')

export class WeekMap {
  private data?: WeekSummary
  private lane?: Lane
  private tip = document.createElement('div')
  constructor(
    private root: HTMLElement,
    open: (d: string) => void,
  ) {
    this.tip.className = 'map-tip'
    this.tip.hidden = true
    new ResizeObserver(() => this.draw()).observe(root)
    root.onclick = (e) => {
      const row = (e.target as Element).closest<HTMLButtonElement>('[data-day]')
      if (row && !row.disabled) open(row.dataset.day!)
    }
    root.onpointerleave = () => {
      this.tip.hidden = true
    }
    root.onpointermove = (e) => {
      const c = (e.target as Element).closest('canvas')
      if (!c || !this.data) {
        this.tip.hidden = true
        return
      }
      const row = this.data.rows[Number(c.dataset.row)],
        rect = c.getBoundingClientRect()
      const slot = Math.max(
        0,
        Math.min(
          slots - 1,
          Math.floor(((e.clientX - rect.left) / rect.width) * slots),
        ),
      )
      const name = row.lanes[this.lane?.id ?? '']?.[slot]
      this.tip.textContent =
        labelTime(slot) +
        '–' +
        labelTime(slot + 1) +
        ' · ' +
        (name ?? 'No activity') +
        (row.activeMs[slot]
          ? ' · ' + duration(row.activeMs[slot]) + ' active'
          : '')
      this.tip.hidden = false
      const box = this.root.getBoundingClientRect()
      this.tip.style.left =
        Math.max(
          0,
          Math.min(
            this.root.clientWidth - this.tip.offsetWidth,
            e.clientX - box.left + 8,
          ),
        ) + 'px'
      this.tip.style.top = Math.max(0, e.clientY - box.top - 30) + 'px'
    }
  }
  update(data: WeekSummary, lane: Lane | undefined, today: string) {
    this.data = data
    this.lane = lane
    this.tip.hidden = true
    this.root.innerHTML =
      '<div class="week-axis"><span>Day</span><div>' +
      ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00']
        .map(
          (s, i) =>
            '<time style="left:' + (i / 6) * 100 + '%">' + s + '</time>',
        )
        .join('') +
      '</div><span>Active</span></div>' +
      data.rows
        .map((r, i) => {
          const d = new Date(bounds(r.date)[0])
          return (
            '<button class="week-row" aria-label="Open ' +
            r.date +
            ' day timeline" data-day="' +
            r.date +
            '" ' +
            (r.date > today ? 'disabled' : '') +
            '><span class="week-day ' +
            (r.date === today ? 'is-today' : '') +
            '"><b>' +
            weekday.format(d) +
            '</b><small>' +
            String(d.getDate()).padStart(2, '0') +
            '</small></span><canvas aria-hidden="true" data-row="' +
            i +
            '"></canvas><span class="week-total">' +
            (r.presence ? esc(duration(r.active)) : '—') +
            icon('right', 11) +
            '</span></button>'
          )
        })
        .join('')
    this.root.append(this.tip)
    this.draw()
  }
  private draw() {
    const data = this.data
    if (!data) return
    this.root.querySelectorAll('canvas').forEach((c, i) => {
      const w = c.clientWidth,
        h = c.clientHeight,
        dpr = devicePixelRatio || 1
      if (!w || !h) return
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      const ctx = c.getContext('2d')!,
        row = data.rows[i],
        cells = row.lanes[this.lane?.id ?? ''] || []
      ctx.scale(dpr, dpr)
      ctx.fillStyle = '#30384c'
      ctx.fillRect(0, 1, w, 15)
      ctx.fillStyle = '#2b3345'
      ctx.fillRect(0, 18, w, 3)
      const pos = (s: number) => Math.round((s * w) / slots)
      for (let s = 0; s < cells.length;) {
        const name = cells[s],
          start = s++
        while (s < cells.length && cells[s] === name) s++
        if (!name) continue
        const x = pos(start),
          width = pos(s) - x
        ctx.fillStyle = color(name)
        ctx.fillRect(x, 1, width, 15)
        ctx.font = '10px "Inter Variable",sans-serif'
        if (width > Math.max(40, ctx.measureText(name).width + 9)) {
          ctx.fillStyle = name === 'Away' ? '#fff' : '#192337'
          ctx.fillText(name, x + 4, 12)
        }
      }
      for (let s = 0; s < slots; s++) {
        const active = row.activeMs[s],
          away = row.awayMs[s]
        if (active + away === 0) continue
        const x = pos(s),
          width = pos(s + 1) - x
        ctx.fillStyle = color('Away')
        ctx.fillRect(x, 18, width, 3)
        ctx.fillStyle = color('Active')
        ctx.fillRect(x, 18, (width * active) / (active + away), 3)
      }
      ctx.fillStyle = 'rgba(211,222,244,.15)'
      for (let t = 0; t <= 6; t++)
        ctx.fillRect(Math.min(w - 1, Math.round((w * t) / 6)), 0, 1, h)
    })
  }
}
