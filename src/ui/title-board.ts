import {
  bounds,
  color,
  dateKey,
  duration,
  moveDate,
  time,
  type Range,
} from '../data/model'
import { readSetting, save } from '../data/storage'
import { VisitIndex, lowerBound } from '../data/visit-index'
import { presenceAt, type PresenceWeek } from '../data/presence'
import { drawPresenceBand } from './presence-band'
import type { TitleWeek, WindowLabel } from '../data/titles'
import { esc, icon } from './icons'
import { durationKey, durationMeter } from './duration-meter'
import { bindEntryDetails } from './entry-popup'

const rowHeight = 64
const dividerHeight = 20
const weekdays = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
const dateLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})
const clock = (minute: number) =>
  String(Math.floor(minute / 60)).padStart(2, '0') +
  ':' +
  String(minute % 60).padStart(2, '0')
const options = (first: number, last: number) =>
  Array.from(
    { length: last - first + 1 },
    (_, i) =>
      '<option value="' +
      (i + first) * 15 +
      '">' +
      clock((i + first) * 15) +
      '</option>',
  ).join('')
interface Column {
  node: HTMLElement
  viewport: HTMLElement
  canvas: HTMLCanvasElement
  content: HTMLElement
  hour: HTMLElement
  count: HTMLElement
  blank: HTMLElement
  indices: number[]
  tops: number[]
  start: number
  end: number
  timeIndex?: VisitIndex
}
export interface Visit {
  label: WindowLabel
  start: number
  end: number
  records: number
}
function clockIntervals(date: string, range: Range): Range[] {
  const [start, end] = bounds(date)
  // Walk actual quarter hours so repeated local hours are both searchable on DST days.
  const intervals: Range[] = []
  for (let t = start; t < end; t += 900000) {
    const local = new Date(t),
      minute = local.getHours() * 60 + local.getMinutes()
    if (minute < range[0] || minute >= range[1]) continue
    const previous = intervals.at(-1)
    if (previous && previous[1] === t) previous[1] = Math.min(t + 900000, end)
    else intervals.push([t, Math.min(t + 900000, end)])
  }
  return intervals
}
export class TitleBoard {
  private columns: Column[] = []
  private data?: TitleWeek
  private key = ''
  private monday = ''
  private grid: HTMLElement
  private search: HTMLInputElement
  private range: Range = readSetting('title-hours', [0, 1440])
  private query = readSetting('title-search', '')
  private terms: string[] = []
  private selected: { day: number; visit: number } | null = null
  private resize: ResizeObserver
  private saveTimer?: ReturnType<typeof setTimeout>
  private gesture: {
    day: number
    x: number
    minute: number
    current: number
  } | null = null
  private rangeMenu: HTMLElement
  private offsets: number[] = []
  private follow = readSetting('title-follow-hover', true)
  private hover: {
    day: number
    visit: number
    offset: number
    minute: number
    keyboardVisit?: number
  } | null = null
  private tip = document.createElement('div')
  private marker = document.createElement('i')
  private presence?: PresenceWeek
  private frame = 0
  constructor(
    private root: HTMLElement,
    private openVisit: (v: Visit, anchor: HTMLElement, pinned: boolean) => void,
    private openDay: (date: string) => void,
  ) {
    root.innerHTML = `<div class="board-tools"><div class="board-filters"><div class="search field title-search">${icon('search', 15)}<input aria-label="Search window titles or applications" placeholder="Search titles or apps…" type="text"><button class="icon-button" data-clear aria-label="Clear title search" title="Clear title search">${icon('close', 13)}</button></div>
    <div class="board-time"><button class="hours-trigger" aria-expanded="false">${icon('clock', 14)}<span></span>${icon('down', 12)}</button>
    <div class="hours-menu popover" hidden><label>From<select data-from>${options(0, 95)}</select></label><label>Until<select data-to>${options(1, 96)}</select></label><button class="soft" data-all>All hours</button></div></div><label class="follow-hover" title="Temporarily scroll the hovered day to its matching window visit"><input type="checkbox" data-follow>Follow hover</label></div>
    <div class="board-stats">${durationKey}<span class="presence-key"></span><div class="board-summary" aria-live="polite"></div></div></div><div class="board-grid" aria-label="Window visits by day"></div>`
    const find = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
    this.search = find('input')
    this.search.value = this.query
    this.grid = find('.board-grid')
    this.grid.style.setProperty('--visit-height', rowHeight + 'px')
    const follow = find<HTMLInputElement>('[data-follow]')
    follow.checked = this.follow
    follow.onchange = () => {
      this.clearHover()
      this.follow = follow.checked
      save('title-follow-hover', this.follow)
    }
    this.tip.className = 'visit-tip'
    this.tip.id = 'visit-tip'
    this.tip.setAttribute('role', 'tooltip')
    this.tip.hidden = true
    root.append(this.tip)
    this.marker.className = 'strip-marker'
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.clearHover()
    })
    window.addEventListener('blur', () => this.clearHover())
    this.rangeMenu = find('.hours-menu')
    this.search.oninput = () => {
      this.query = this.search.value
      save('title-search', this.query)
      this.filter()
    }
    find('[data-clear]').onclick = () => {
      this.search.value = ''
      this.search.dispatchEvent(new Event('input'))
      this.search.focus()
    }
    const toggle = find('.hours-trigger')
    const close = () => {
      this.rangeMenu.hidden = true
      toggle.setAttribute('aria-expanded', 'false')
    }
    toggle.onclick = () => {
      this.rangeMenu.hidden = !this.rangeMenu.hidden
      toggle.setAttribute('aria-expanded', String(!this.rangeMenu.hidden))
    }
    document.addEventListener('pointerdown', (e) => {
      if (!(e.target as Element).closest('.board-time')) close()
    })
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.rangeMenu.hidden) {
        close()
        toggle.focus()
      }
    })
    find('[data-all]').onclick = () => {
      this.setRange([0, 1440])
      close()
      toggle.focus()
    }
    find<HTMLSelectElement>('[data-from]').onchange = (e) => {
      const a = +(e.target as HTMLSelectElement).value
      this.setRange([a, Math.max(a + 15, this.range[1])])
    }
    find<HTMLSelectElement>('[data-to]').onchange = (e) => {
      const b = +(e.target as HTMLSelectElement).value
      this.setRange([Math.min(b - 15, this.range[0]), b])
    }
    this.resize = new ResizeObserver(() =>
      this.columns.forEach((_, i) => {
        this.draw(i)
        this.paint(i, true)
      }),
    )
    this.resize.observe(this.grid)
    this.grid.addEventListener('click', (e) => {
      const el = e.target as HTMLElement,
        col = el.closest<HTMLElement>('.title-col')
      if (!col) return
      const i = Number(col.dataset.day)
      if (el.closest('.day-name')) {
        this.openDay(moveDate(this.monday, i))
        return
      }
    })
    bindEntryDetails(this.grid, '.visit', (row, pin) => {
      if (!this.data) return
      const i = Number(row.closest<HTMLElement>('.title-col')!.dataset.day)
      const day = this.data.days[i],
        n = Number(row.dataset.visit)
      if (pin) {
        this.grid
          .querySelector('.visit[aria-pressed="true"]')
          ?.setAttribute('aria-pressed', 'false')
        this.selected = { day: i, visit: n }
        row.setAttribute('aria-pressed', 'true')
      }
      this.openVisit(
        {
          label: this.data.labels[day.label[n]],
          start: day.start[n],
          end: day.end[n],
          records: day.records[n],
        },
        row,
        pin,
      )
    })
    window.addEventListener('pagehide', () => this.persist())
    this.controls()
  }
  private controls() {
    const find = <T extends HTMLElement>(s: string) =>
      this.root.querySelector<T>(s)!
    find('[data-clear]').style.visibility = this.query ? 'visible' : 'hidden'
    find('.hours-trigger span').textContent =
      this.range[0] === 0 && this.range[1] === 1440
        ? 'All hours'
        : clock(this.range[0]) + ' – ' + clock(this.range[1])
    find<HTMLSelectElement>('[data-from]').value = String(this.range[0])
    find<HTMLSelectElement>('[data-to]').value = String(this.range[1])
  }
  private setRange(range: Range) {
    this.range = range
    save('title-hours', range)
    this.filter()
  }
  private persist() {
    if (!this.key || !this.data || this.root.hidden) return
    save('title-position', {
      key: this.key,
      query: this.query,
      range: this.range.join(),
      offsets: this.columns.map((c, i) =>
        this.hover?.day === i ? this.hover.offset : c.viewport.scrollTop,
      ),
      left: this.grid.scrollLeft,
    })
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.persist(), 160)
  }
  set(
    key: string,
    monday: string,
    data: TitleWeek | undefined,
    error: boolean,
  ) {
    const changed = key !== this.key
    if (changed || this.data !== data) {
      this.clearHover()
      for (const c of this.columns) c.timeIndex = undefined
      this.setPresence(undefined, '')
    }
    if (changed) {
      this.persist()
      clearTimeout(this.saveTimer)
      this.key = key
      this.monday = monday
      this.selected = null
      this.data = undefined
      const previous = readSetting<{
        key: string
        query: string
        range: string
        offsets: number[]
        left: number
      } | null>('title-position', null)
      const restore =
        previous?.key === key &&
        previous.query === this.query &&
        previous.range === this.range.join()
      this.offsets = restore ? previous.offsets : []
      this.mountColumns()
      this.grid.scrollLeft = restore ? previous.left : 0
    }
    if (!changed && this.data === data && !error) return
    this.data = data
    this.terms =
      data?.labels.map((l) => (l.title + ' ' + l.app).toLowerCase()) ?? []
    this.filter(
      changed || this.offsets.length > 0
        ? this.offsets
        : this.columns.map((c) => c.viewport.scrollTop),
      error,
    )
    if (data) this.offsets = []
  }
  private mountColumns() {
    const today = dateKey()
    const days = Array.from({ length: 7 }, (_, i) => moveDate(this.monday, i))
    this.grid.style.gridTemplateColumns = days
      .map((d) =>
        d > today
          ? 'minmax(var(--future-width),.4fr)'
          : 'minmax(var(--day-width),1fr)',
      )
      .join(' ')
    this.grid.innerHTML = days
      .map((date, i) => {
        const d = new Date(date + 'T12:00:00'),
          future = date > today
        return `<section class="title-col${future ? ' future' : ''}${date === today ? ' current' : ''}" data-day="${i}" aria-label="${weekdays.format(d)} ${dateLabel.format(d)}">
      <header class="col-head"><button class="day-name" ${future ? 'disabled' : ''} title="Open ${date} day timeline" aria-label="${weekdays.format(d)} ${dateLabel.format(d)}"></button><div class="day-heading" aria-hidden="true"><strong>${weekdays.format(d)}</strong><span>${dateLabel.format(d)}</span></div><div class="col-count"></div>
      <div class="strip-track"><canvas class="day-strip" tabindex="${future ? -1 : 0}" aria-label="Navigate ${weekdays.format(d)} by time. Hover to preview, click to jump, or drag to filter all days. Double-click or press Escape to clear selection. Arrow keys jump by hour. Wheel to change week."></canvas></div>
      <div class="strip-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></header>
      <div class="hour-marker"></div><div class="visit-scroll"><div class="visit-content"></div><div class="col-blank"></div></div></section>`
      })
      .join('')
    this.columns = Array.from(this.grid.children, (el, i) => {
      const node = el as HTMLElement,
        find = <T extends HTMLElement>(selector: string) =>
          node.querySelector<T>(selector)!
      const c: Column = {
        node,
        viewport: find('.visit-scroll'),
        canvas: find('canvas'),
        content: find('.visit-content'),
        hour: find('.hour-marker'),
        count: find('.col-count'),
        blank: find('.col-blank'),
        indices: [],
        tops: [],
        start: -1,
        end: -1,
      }
      c.viewport.onscroll = () => {
        this.paint(i)
        this.scheduleSave()
      }
      c.viewport.onkeydown = (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.visit')
        if (!row || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key))
          return
        e.preventDefault()
        const index = Number(row.dataset.position)
        const pos =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? c.indices.length - 1
              : index + (e.key === 'ArrowUp' ? -1 : 1)
        this.go(i, Math.max(0, Math.min(c.indices.length - 1, pos)), true)
      }
      this.bindStrip(c, i)
      return c
    })
    this.grid.onscroll = () => this.scheduleSave()
  }
  private filter(offsets: number[] = [], error = false) {
    this.clearHover()
    this.controls()
    const q = this.query.trim().toLowerCase(),
      labels = q ? this.terms.map((t) => t.includes(q)) : undefined
    let matched = 0,
      total = 0,
      windowMs = 0
    const apps = new Set<string>()
    this.columns.forEach((c, i) => {
      const d = this.data?.days[i],
        future = moveDate(this.monday, i) > dateKey()
      const hours = this.range[0] !== 0 || this.range[1] !== 1440
      const ranges = d && hours ? clockIntervals(d.date, this.range) : undefined
      c.indices = []
      c.tops = []
      let height = 0,
        previousHour = -1,
        columnMs = 0
      if (d) {
        total += d.start.length
        for (let j = 0; j < d.start.length; j++) {
          if (labels && !labels[d.label[j]]) continue
          if (
            ranges &&
            !ranges.some(
              ([a, b]) =>
                d.start[j] < b &&
                (d.end[j] > a || (d.start[j] === d.end[j] && d.start[j] >= a)),
            )
          )
            continue
          if (q || ranges) {
            apps.add(this.data!.labels[d.label[j]].app)
            columnMs += ranges
              ? ranges.reduce(
                  (sum, [a, b]) =>
                    sum +
                    Math.max(
                      0,
                      Math.min(b, d.end[j]) - Math.max(a, d.start[j]),
                    ),
                  0,
                )
              : d.end[j] - d.start[j]
          }
          const hour = new Date(d.start[j]).getHours()
          if (c.indices.length && hour !== previousHour) height += dividerHeight
          c.tops.push(height)
          height += rowHeight
          previousHour = hour
          c.indices.push(j)
        }
        if (!q && !ranges) columnMs = d.windowMs
      }
      matched += c.indices.length
      windowMs += columnMs
      c.count.textContent = future
        ? 'Upcoming'
        : !d
          ? '—'
          : duration(columnMs) + ' window time'
      c.content.style.height = height + 'px'
      c.viewport.scrollTop = offsets[i] ?? 0
      c.blank.textContent = future
        ? ''
        : error && !d
          ? 'Data unavailable'
          : !d
            ? 'Loading titles…'
            : d.start.length
              ? 'No matching visits'
              : 'No window records'
      c.blank.hidden = !!c.indices.length || future
      this.draw(i)
      this.paint(i, true)
    })
    const summary = this.root.querySelector<HTMLElement>('.board-summary')!
    const appCount =
      q || this.range[0] !== 0 || this.range[1] !== 1440
        ? apps.size
        : (this.data?.apps.length ?? 0)
    summary.textContent = this.data
      ? (matched === total
          ? total.toLocaleString()
          : matched.toLocaleString() + ' of ' + total.toLocaleString()) +
        ' visits  ·  ' +
        duration(windowMs) +
        ' window time  ·  ' +
        appCount +
        ' apps'
      : ''
  }
  private firstAt(c: Column, y: number) {
    let lo = 0,
      hi = c.tops.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (c.tops[mid] + rowHeight <= y) lo = mid + 1
      else hi = mid
    }
    return Math.min(lo, c.tops.length - 1)
  }
  private paint(i: number, force = false) {
    const c = this.columns[i],
      day = this.data?.days[i]
    if (!c) return
    const first = this.firstAt(c, c.viewport.scrollTop)
    const start = Math.max(0, first - 3),
      end = Math.min(
        c.indices.length,
        first + Math.ceil(c.viewport.clientHeight / rowHeight) + 5,
      )
    c.hour.textContent =
      day && first >= 0
        ? time(day.start[c.indices[first]]).slice(0, 2) + ':00'
        : ''
    if (!force && start === c.start && end === c.end) return
    c.start = start
    c.end = end
    if (!day || !this.data) {
      c.content.replaceChildren()
      return
    }
    const labels = this.data.labels
    c.content.innerHTML = c.indices
      .slice(start, end)
      .map((n, j) => {
        const pos = start + j,
          label = labels[day.label[n]],
          title = label.title || 'Untitled window'
        const ms = day.end[n] - day.start[n]
        const divider =
          pos > 0 && c.tops[pos] > c.tops[pos - 1] + rowHeight
            ? '<div class="visit-divider" style="top:' +
              (c.tops[pos] - dividerHeight) +
              'px">' +
              time(day.start[n]).slice(0, 2) +
              ':00</div>'
            : ''
        return (
          divider +
          `<button class="visit" data-position="${pos}" data-visit="${n}" ${this.hover?.day === i && this.hover.visit === n ? 'data-preview' : ''} aria-pressed="${this.selected?.day === i && this.selected.visit === n}" style="top:${c.tops[pos]}px"><time>${time(day.start[n])}</time><span class="visit-text"><strong>${esc(title)}</strong><small><i class="swatch" style="--swatch:${color(label.app)}"></i><span>${esc(label.app)}</span><span class="visit-duration">${ms > 0 && ms < 1000 ? '&lt;1s' : duration(ms)}</span></small></span>${durationMeter(ms)}</button>`
        )
      })
      .join('')
  }
  private draw(i: number) {
    const c = this.columns[i]
    if (!c) return
    const { canvas } = c,
      w = canvas.clientWidth,
      h = canvas.clientHeight
    if (!w || !h) return
    const scale = devicePixelRatio || 1
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    const band = h - 6
    const day = this.data?.days[i]
    if (day && this.data)
      for (let j = 0; j < 96; j++) {
        const app = day.strip[j]
        if (app) {
          ctx.fillStyle = color(this.data.apps[app - 1][0])
          ctx.fillRect(
            Math.round((w * j) / 96),
            0,
            Math.round((w * (j + 1)) / 96) - Math.round((w * j) / 96),
            band,
          )
        }
      }
    drawPresenceBand(ctx, this.presence?.[i] ?? [], w, band + 2, 4)
    const gesture = this.gesture
    const range =
      gesture && Math.abs(gesture.minute - gesture.current) > 1
        ? [
            Math.min(gesture.minute, gesture.current),
            Math.max(gesture.minute, gesture.current),
          ]
        : this.range
    ctx.fillStyle = '#11182bb8'
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillRect(0, 0, (w * range[0]) / 1440, h)
    ctx.fillRect((w * range[1]) / 1440, 0, (w * (1440 - range[1])) / 1440, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#d0d9f050'
    for (let n = 1; n < 4; n++) ctx.fillRect(Math.round((n * w) / 4), 0, 1, h)
  }
  setPresence(presence: PresenceWeek | undefined, status = '') {
    this.presence = presence
    const legend = this.root.querySelector<HTMLElement>('.presence-key')!
    legend.innerHTML = presence?.some((spans) => spans.length)
      ? '<i class="active-key"></i>Active <i class="idle-key"></i>Idle'
      : esc(status || (presence ? 'No presence recorded' : ''))
    legend.title =
      'Presence watcher coverage in the lower band. Gaps have no recorded status.'
    this.columns.forEach((_, i) => this.draw(i))
    if (this.hover)
      this.showHover(
        this.hover.day,
        this.hover.minute,
        this.hover.keyboardVisit,
      )
  }
  private clearSelection() {
    this.clearHover()
    this.selected = null
    if (this.range[0] !== 0 || this.range[1] !== 1440) this.setRange([0, 1440])
    else this.columns.forEach((_, i) => this.paint(i, true))
  }
  clearHover() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    const preview = this.hover
    if (!preview) return
    this.hover = null
    this.tip.hidden = true
    this.marker.remove()
    const c = this.columns[preview.day]
    c.canvas.removeAttribute('aria-describedby')
    c.content.querySelector('[data-preview]')?.removeAttribute('data-preview')
    if (c.viewport.scrollTop !== preview.offset) {
      c.viewport.scrollTop = preview.offset
      this.paint(preview.day)
    }
  }
  private instant(day: number, minute: number) {
    const wall = new Date(this.data!.days[day].date + 'T00:00:00')
    const ms = Math.min(86399999, Math.max(0, Math.round(minute * 60000)))
    wall.setHours(0, 0, 0, ms)
    // A skipped clock hour has no corresponding instant on a spring-forward day.
    return wall.getHours() === Math.floor(ms / 3600000) ? wall.getTime() : NaN
  }
  private lookup(day: number, t: number) {
    const d = this.data!.days[day],
      c = this.columns[day]
    c.timeIndex ??= new VisitIndex(d.start, d.end)
    return c.timeIndex.at(t)
  }
  private showHover(i: number, minute: number, keyboardVisit?: number) {
    if (!this.data || this.root.hidden || this.gesture) return
    const d = this.data.days[i],
      c = this.columns[i]
    if (d.date > dateKey()) return
    const t =
      keyboardVisit === undefined
        ? this.instant(i, minute)
        : d.start[keyboardVisit]
    const visit = keyboardVisit ?? this.lookup(i, t)
    if (this.hover?.day !== i) {
      this.clearHover()
      this.hover = { day: i, visit: -1, offset: c.viewport.scrollTop, minute }
      c.canvas.parentElement!.append(this.marker)
      c.canvas.setAttribute('aria-describedby', this.tip.id)
    }
    const preview = this.hover!
    preview.minute = minute
    preview.keyboardVisit = keyboardVisit
    const pos = lowerBound(c.indices, visit)
    const visible =
      visit >= 0 &&
      c.indices[pos] === visit &&
      minute >= this.range[0] &&
      minute < this.range[1]
    const next = visible ? visit : -1
    if (preview.visit !== next) {
      c.content.querySelector('[data-preview]')?.removeAttribute('data-preview')
      preview.visit = next
      if (visible) {
        const y = c.tops[pos],
          v = c.viewport
        if (
          this.follow &&
          keyboardVisit === undefined &&
          (y < v.scrollTop || y + rowHeight > v.scrollTop + v.clientHeight)
        ) {
          v.scrollTop = Math.max(0, y - (v.clientHeight - rowHeight) / 2)
          this.paint(i)
        }
        c.content
          .querySelector('[data-visit="' + visit + '"]')
          ?.setAttribute('data-preview', '')
      }
    }
    const label = visit < 0 ? undefined : this.data.labels[d.label[visit]]
    const at = Number.isFinite(t) ? time(t, true) : clock(Math.floor(minute))
    const span = presenceAt(this.presence?.[i] ?? [], t)
    const status = span
      ? span.idle
        ? 'Idle'
        : 'Active'
      : this.presence
        ? 'No presence data'
        : ''
    this.tip.innerHTML =
      '<small>' +
      esc(at) +
      (label ? ' · ' + esc(label.app) : '') +
      (status
        ? ' · <span class="' +
          (span?.idle ? 'idle-text' : '') +
          '">' +
          status +
          '</span>'
        : '') +
      '</small><strong>' +
      esc(
        label
          ? label.title || 'Untitled window'
          : Number.isFinite(t)
            ? 'No recorded window'
            : 'Clock time skipped',
      ) +
      '</strong>' +
      (label
        ? '<small>' +
          esc(time(d.start[visit], true)) +
          ' – ' +
          esc(time(d.end[visit], true)) +
          ' · ' +
          esc(duration(d.end[visit] - d.start[visit])) +
          (visible ? '' : ' · Outside list filters') +
          '</small>'
        : '')
    const rect = c.canvas.getBoundingClientRect(),
      x = rect.left + (rect.width * minute) / 1440
    this.marker.style.left = (minute / 1440) * 100 + '%'
    this.tip.hidden = false
    this.tip.style.left =
      Math.max(6, Math.min(x + 8, innerWidth - this.tip.offsetWidth - 6)) + 'px'
    const above = rect.top - this.tip.offsetHeight - 6
    this.tip.style.top =
      (above >= 6
        ? above
        : Math.max(
            6,
            Math.min(rect.bottom + 6, innerHeight - this.tip.offsetHeight - 6),
          )) + 'px'
  }
  private bindStrip(c: Column, i: number) {
    let beforePress = 0,
      beforeFirstClick = 0
    c.canvas.onclick = (e) => {
      if (e.detail === 1) beforeFirstClick = beforePress
    }
    c.canvas.ondblclick = (e) => {
      e.preventDefault()
      const fullDay = this.range[0] === 0 && this.range[1] === 1440
      this.clearSelection()
      if (fullDay) {
        c.viewport.scrollTop = beforeFirstClick
        this.paint(i)
      }
    }
    const minute = (x: number) =>
      Math.min(
        1440 - 1 / 60000,
        Math.max(
          0,
          ((x - c.canvas.getBoundingClientRect().left) / c.canvas.clientWidth) *
            1440,
        ),
      )
    const preview = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.buttons || this.gesture) return
      const x = e.clientX
      cancelAnimationFrame(this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        this.showHover(i, minute(x))
      })
    }
    c.canvas.onpointerenter = preview
    c.canvas.onpointerleave = () => this.clearHover()
    c.canvas.onpointerdown = (e) => {
      if (e.button !== 0 || !this.data || this.data.days[i].date > dateKey())
        return
      const m = minute(e.clientX)
      beforePress =
        this.hover?.day === i ? this.hover.offset : c.viewport.scrollTop
      this.clearHover()
      this.gesture = { day: i, x: e.clientX, minute: m, current: m }
      c.canvas.setPointerCapture(e.pointerId)
    }
    c.canvas.onpointermove = (e) => {
      if (this.gesture?.day === i) {
        this.gesture.current = minute(e.clientX)
        this.columns.forEach((_, j) => this.draw(j))
      } else preview(e)
    }
    c.canvas.onpointercancel = () => {
      this.clearHover()
      this.gesture = null
      this.columns.forEach((_, j) => this.draw(j))
    }
    c.canvas.onpointerup = (e) => {
      const g = this.gesture
      if (!g || g.day !== i) return
      this.gesture = null
      c.canvas.releasePointerCapture(e.pointerId)
      const m = minute(e.clientX)
      if (Math.abs(e.clientX - g.x) > 4)
        this.setRange([
          Math.floor(Math.min(m, g.minute) / 15) * 15,
          Math.min(1440, (Math.floor(Math.max(m, g.minute) / 15) + 1) * 15),
        ])
      else {
        this.jump(i, m)
        this.columns.forEach((_, j) => this.draw(j))
      }
    }
    const keyboardTip = () => {
      const d = this.data?.days[i]
      if (!d || !c.indices.length) return
      const visit =
        this.selected?.day === i &&
        c.indices[lowerBound(c.indices, this.selected.visit)] ===
          this.selected.visit
          ? this.selected.visit
          : c.indices[this.firstAt(c, c.viewport.scrollTop)]
      const wall = new Date(d.start[visit])
      this.showHover(
        i,
        wall.getHours() * 60 + wall.getMinutes() + wall.getSeconds() / 60,
        visit,
      )
    }
    c.canvas.onfocus = () => {
      if (c.canvas.matches(':focus-visible')) keyboardTip()
    }
    c.canvas.onblur = () => this.clearHover()
    c.canvas.onkeydown = (e) => {
      if (e.key === 'Escape') {
        this.clearSelection()
        return
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      this.clearHover()
      const d = this.data?.days[i]
      if (!d || !c.indices.length) return
      const index =
        this.selected?.day === i
          ? this.selected.visit
          : c.indices[this.firstAt(c, c.viewport.scrollTop)]
      const current = new Date(d.start[index])
      const step = e.shiftKey ? 15 : e.altKey ? 300 : 60
      const m =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? 1439
            : current.getHours() * 60 +
              current.getMinutes() +
              (e.key === 'ArrowRight' ? step : -step)
      this.jump(i, Math.max(0, Math.min(1439, m)))
      keyboardTip()
    }
  }
  private jump(i: number, minute: number) {
    const c = this.columns[i],
      d = this.data?.days[i]
    if (!d || !c.indices.length) return
    const t = this.instant(i, minute)
    if (!Number.isFinite(t)) return
    const visit = this.lookup(i, t)
    let p = lowerBound(c.indices, visit)
    if (visit < 0 || c.indices[p] !== visit)
      p = Math.min(
        c.indices.length - 1,
        lowerBound(c.indices, lowerBound(d.start, t)),
      )
    this.go(i, p, false)
  }
  private go(i: number, pos: number, focus: boolean) {
    const c = this.columns[i],
      previous = this.selected
    this.selected = { day: i, visit: c.indices[pos] }
    c.viewport.scrollTop = Math.max(
      0,
      c.tops[pos] - (c.viewport.clientHeight - rowHeight) / 2,
    )
    if (previous && previous.day !== i) this.paint(previous.day, true)
    this.paint(i, true)
    if (focus)
      c.content
        .querySelector<HTMLButtonElement>('[data-position="' + pos + '"]')
        ?.focus({ preventScroll: true })
  }
}
