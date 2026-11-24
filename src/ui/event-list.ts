import {
  color,
  duration,
  kindNames,
  time,
  type Entry,
  type Range,
} from '../data/model'
import { esc, icon } from './icons'
import { durationMeter } from './duration-meter'
import { bindEntryDetails } from './entry-popup'
const rowHeight = 44
const shortDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
})
export class EventList {
  private rows: Entry[] = []
  private total = 0
  private offset = 0
  private readPage?: (start: number, end: number) => Promise<Entry[]>
  private revision = 0
  private weekly = false
  private range: Range = [0, Infinity]
  private body = document.createElement('div')
  private last = ''
  constructor(
    private viewport: HTMLElement,
    inspect: (e: Entry, anchor: HTMLElement, pinned: boolean) => void,
  ) {
    this.body.className = 'virtual-body'
    viewport.append(this.body)
    viewport.onscroll = () => this.draw()
    new ResizeObserver(() => this.draw()).observe(viewport)
    bindEntryDetails(this.body, '[data-index]', (row, pin) => {
      const entry = this.rows[Number(row.dataset.index) - this.offset]
      if (entry) inspect(entry, row, pin)
    })
    this.body.onkeydown = async (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-index]',
      )
      if (!target || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key))
        return
      e.preventDefault()
      const i =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? this.total - 1
            : Math.min(
                this.total - 1,
                Math.max(
                  0,
                  Number(target.dataset.index) + (e.key === 'ArrowUp' ? -1 : 1),
                ),
              )
      if (i * rowHeight < viewport.scrollTop) viewport.scrollTop = i * rowHeight
      if ((i + 1) * rowHeight > viewport.scrollTop + viewport.clientHeight)
        viewport.scrollTop = (i + 1) * rowHeight - viewport.clientHeight
      await this.draw()
      this.body
        .querySelector<HTMLButtonElement>('[data-index="' + i + '"]')
        ?.focus({ preventScroll: true })
    }
  }
  set(entries: Entry[], range: Range, reset: boolean) {
    this.readPage = undefined
    this.offset = 0
    this.weekly = false
    this.rows = entries
    this.configure(entries.length, range, reset)
  }
  setPages(
    total: number,
    range: Range,
    reset: boolean,
    readPage: (start: number, end: number) => Promise<Entry[]>,
  ) {
    this.readPage = readPage
    this.rows = []
    this.offset = 0
    this.weekly = true
    this.configure(total, range, reset)
  }
  private configure(total: number, range: Range, reset: boolean) {
    this.total = total
    this.range = range
    if (reset) this.viewport.scrollTop = 0
    this.body.style.height = total * rowHeight + 'px'
    this.last = ''
    this.draw()
  }
  private async draw() {
    const start = Math.max(
      0,
      Math.floor(this.viewport.scrollTop / rowHeight) - 2,
    )
    const end = Math.min(
      this.total,
      Math.ceil(
        (this.viewport.scrollTop + this.viewport.clientHeight) / rowHeight,
      ) + 2,
    )
    const key = start + '/' + end
    if (key === this.last) return
    this.last = key
    const revision = ++this.revision
    if (this.readPage && end > start) {
      const entries = await this.readPage(start, end)
      if (revision !== this.revision) return
      this.rows = entries
      this.offset = start
    }
    this.body.innerHTML = this.rows
      .slice(start - this.offset, end - this.offset)
      .map(
        (e, n) =>
          '<button class="event-row" data-index="' +
          (n + start) +
          '" style="top:' +
          (n + start) * rowHeight +
          'px"><time>' +
          time(Math.max(e.start, this.range[0]), true) +
          (this.weekly
            ? '<small>' + shortDate.format(e.start) + '</small>'
            : '') +
          '</time><span class="event-main"><i class="swatch" style="--swatch:' +
          color(e.label) +
          '"></i><span><b>' +
          esc(e.label) +
          '</b><small>' +
          esc(e.detail || kindNames[e.kind]) +
          '</small></span></span><span class="source-cell">' +
          icon(e.kind, 13) +
          esc(kindNames[e.kind]) +
          '</span><span class="numeric">' +
          duration(
            Math.min(e.end, this.range[1]) - Math.max(e.start, this.range[0]),
          ) +
          durationMeter(
            Math.min(e.end, this.range[1]) - Math.max(e.start, this.range[0]),
          ) +
          '</span></button>',
      )
      .join('')
  }
}
