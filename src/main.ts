import { mountWorkspace } from './ui/workspace'
import { EntryPopup } from './ui/entry-popup'
import './styles.css'
import { discover, api } from './data/api'
import {
  bounds,
  color,
  dateKey,
  duration,
  intersects,
  kindNames,
  moveDate,
  periodBounds,
  recordedRange,
  summarize,
  time,
  weekStart,
  type Bucket,
  type Day,
  type Entry,
  type Range,
  type Kind,
} from './data/model'
import {
  loadPeriod,
  filterWeek,
  pageWeek,
  cancelReads,
} from './data/worker-client'
import { aggregateWeek, type WeekSummary } from './data/weekly'
import { WeekMap } from './ui/week-map'
import { TitleBoard } from './ui/title-board'
import type { TitleWeek } from './data/titles'
import './title-board.css'
import { cached, readSetting, remember, save } from './data/storage'
import { DayMap } from './ui/day-map'
import { EventList } from './ui/event-list'
import { byId, esc, icon } from './ui/icons'

const empty: Day = { entries: [], lanes: [], fetched: 0 }
const today = () => dateKey()
let date = readSetting('date', 'today')
if (date === 'today' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today()
let host = readSetting<string>('device', '')
let mode = readSetting<'recorded' | 'day'>('map-mode', 'recorded')
let tab = readSetting<'timeline' | 'events'>('tab', 'timeline')
let query = readSetting('search', '')
let source = readSetting<Kind | ''>('source', '')
let appFilter = ''
let period = readSetting<'week' | 'day'>('period', 'week')
let layout = readSetting<'titles' | 'overview'>('weekly-layout', 'titles')
let titleData: TitleWeek | undefined
const showingTitles = () =>
  period === 'week' && tab === 'timeline' && layout === 'titles'
let week: WeekSummary | undefined,
  workerContext = 0,
  filterSequence = 0
let weekLane = readSetting<string>('week-lane', '')
let day = empty,
  custom: Range | null = null,
  view: Range = bounds(date)
let info: { hostname: string; version: string } | undefined
let buckets: Bucket[] = [],
  controller: AbortController | undefined
let state: 'connecting' | 'online' | 'offline' = 'connecting',
  message = ''
let visible: Entry[] = []
const num = (n: number) => n.toLocaleString()
const key = () =>
  JSON.stringify([
    api,
    host,
    period,
    period === 'week' ? weekStart(date) : date,
  ])
mountWorkspace(byId('app'))
document.documentElement.style.setProperty('--presence-idle', color('Away'))
document.documentElement.style.setProperty('--presence-active', color('Active'))

const list = new EventList(byId('list'), inspect)
const map = new DayMap(byId('map'), (r) => setZoom(r), inspect)
const weekMap = new WeekMap(byId('week-map'), (d) => {
  period = 'day'
  save('period', period)
  changeDate(d)
})
const device = byId<HTMLSelectElement>('device'),
  search = byId<HTMLInputElement>('search'),
  src = byId<HTMLSelectElement>('source')
const popup = new EntryPopup(byId('entry-popup'))
const board = new TitleBoard(
  byId('title-board'),
  (v, anchor, pin) => {
    const fields = [
      ['Application', v.label.app],
      ['Start', new Date(v.start).toLocaleString()],
      ['End', new Date(v.end).toLocaleString()],
      ['Duration', duration(v.end - v.start)],
      ['Window records', num(v.records)],
    ]
    popup.show(
      anchor,
      pin,
      'Window visit',
      '<h3 class="copy-title">' +
        esc(v.label.title || 'Untitled window') +
        '</h3><dl>' +
        fields
          .map(
            ([k, value]) =>
              '<dt>' + esc(k) + '</dt><dd>' + esc(value) + '</dd>',
          )
          .join('') +
        '</dl>',
    )
  },
  (d) => {
    period = 'day'
    save('period', period)
    changeDate(d)
  },
)
search.value = query
src.value = source
function inspect(e: Entry, anchor: HTMLElement, pinned: boolean) {
  const rows = [
    ['Source', kindNames[e.kind]],
    ['Start', new Date(e.start).toLocaleString()],
    ['End', new Date(e.end).toLocaleString()],
    ['Duration', duration(e.end - e.start)],
    ['Bucket', e.lane],
  ]
  popup.show(
    anchor,
    pinned,
    'Event details',
    '<h3><i class="swatch" style="--swatch:' +
      color(e.label) +
      '"></i>' +
      esc(e.label) +
      '</h3><dl>' +
      rows
        .map(([k, v]) => '<dt>' + k + '</dt><dd>' + esc(v) + '</dd>')
        .join('') +
      '</dl><h4>Recorded data</h4><pre>' +
      esc(JSON.stringify(e.data, null, 2)) +
      '</pre>',
  )
}
function status() {
  byId('status').textContent =
    state === 'online'
      ? 'Connected'
      : state === 'connecting'
        ? 'Connecting'
        : 'Offline'
  byId('connection').dataset.state = state
  byId('notice').hidden = !message
  byId('notice').textContent = message
  byId('foot-server').textContent = info
    ? 'ActivityWatch ' + info.version
    : 'ActivityWatch'
  byId('reload').setAttribute('aria-busy', String(state === 'connecting'))
}
function dates() {
  const current = today(),
    t = date === current,
    dt = new Date(date + 'T12:00:00')
  const weekly = period === 'week',
    monday = weekStart(date),
    thisWeek = weekStart(current),
    sunday = moveDate(monday, 6)
  const short = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  const caption = byId<HTMLButtonElement>('date-caption')
  caption.disabled = weekly
  caption.title = weekly ? '' : 'Back to week'
  const captionText = weekly
    ? short(monday) + ' – ' + short(sunday) + ', ' + sunday.slice(0, 4)
    : dt.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
  const mapDate = byId<HTMLTimeElement>('map-date')
  mapDate.hidden = weekly
  if (!weekly) {
    mapDate.dateTime = date
    mapDate.textContent = dt.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    byId('day-map-back').setAttribute(
      'aria-label',
      'Day map, ' + captionText + ', return to week view',
    )
  }
  caption.innerHTML =
    '<span>' +
    esc(captionText) +
    '</span>' +
    (weekly
      ? ''
      : '<span class="week-return">' + icon('left', 12) + 'Back to week</span>')
  byId('date-label').textContent = weekly
    ? monday === thisWeek
      ? 'This week'
      : monday === moveDate(thisWeek, -7)
        ? 'Last week'
        : short(monday)
    : t
      ? 'Today'
      : date === moveDate(current, -1)
        ? 'Yesterday'
        : short(date)
  byId<HTMLButtonElement>('next').disabled = weekly
    ? monday >= thisWeek
    : date >= current
  byId('today').textContent = weekly ? 'This week' : 'Today'
  for (const p of ['week', 'day'])
    byId('period-' + p).setAttribute('aria-pressed', String(period === p))
  for (const [id, name] of [
    ['prev', 'Previous'],
    ['next', 'Next'],
  ]) {
    const b = byId(id)
    b.title = name + ' ' + period
    b.setAttribute('aria-label', b.title)
  }
  const picker = byId<HTMLInputElement>('date-input')
  picker.max = current
  picker.value = date
}
function setTab(next: typeof tab) {
  tab = next
  save('tab', tab)
  document.body.classList.toggle('log-mode', tab === 'events')
  byId('timeline-view').hidden = tab === 'events'
  for (const name of ['timeline', 'events'])
    byId('nav-' + name).setAttribute(
      'aria-current',
      tab === name ? 'page' : 'false',
    )
  byId('page-title').textContent =
    tab === 'timeline'
      ? period === 'week'
        ? 'Weekly timeline'
        : 'Activity timeline'
      : 'Event log'
  byId('stream-title').textContent =
    tab === 'timeline' ? 'Event stream' : 'Recorded events'
  document.title =
    'ActivityWitch · ' + (tab === 'timeline' ? 'Timeline' : 'Event log')
  render(false)
}
function setZoom(range: Range | null) {
  custom = range
  save('zoom', range ? { key: key(), range } : null)
  render(true)
}
function setMode(value: typeof mode) {
  mode = value
  save('map-mode', value)
  setZoom(null)
}
function sparks(entries: Entry[], range: Range) {
  // Each column measures the same slice of the selected time range.
  const bins = Array.from({ length: 22 }, () => ({
    active: 0,
    away: 0,
    apps: new Set<string>(),
    events: 0,
  }))
  const step = (range[1] - range[0]) / bins.length
  for (const e of entries) {
    const start = Math.max(e.start, range[0]),
      end = Math.min(e.end, range[1])
    const first = Math.min(21, Math.floor((start - range[0]) / step))
    bins[first].events++
    for (
      let i = first;
      i <= Math.min(21, Math.floor((end - range[0]) / step));
      i++
    ) {
      const amount =
        Math.min(end, range[0] + (i + 1) * step) -
        Math.max(start, range[0] + i * step)
      if (e.kind === 'presence' && e.label === 'Active')
        bins[i].active += amount
      if (e.kind === 'presence' && e.label === 'Away') bins[i].away += amount
      if (e.kind === 'app' && (amount > 0 || start === end))
        bins[i].apps.add(e.label)
    }
  }
  drawSparks(
    [0, 1, 2, 3].map((m) =>
      bins.map((b) => [b.active, b.away, b.apps.size, b.events][m]),
    ),
  )
}
function drawSparks(series: number[][]) {
  for (let m = 0; m < 4; m++) {
    const values = series[m],
      step = 82 / values.length
    const max = Math.max(1, ...values)
    byId('spark-' + m).innerHTML = values
      .map((v, i) => {
        const h = Math.max(2, (22 * v) / max)
        return (
          '<rect x="' +
          i * step +
          '" y="' +
          (24 - h) +
          '" width="' +
          step * 0.73 +
          '" height="' +
          h +
          '" rx="1" opacity="' +
          (v ? '.8' : '.24') +
          '"/>'
        )
      })
      .join('')
  }
}
function render(reset: boolean) {
  popup.close()
  const weekly = period === 'week',
    dateBounds = periodBounds(date, weekly)
  const titles = showingTitles()
  if (!titles) board.clearHover()
  document.body.classList.toggle('titles-mode', titles)
  const canChooseWeeklyLayout = weekly && tab === 'timeline'
  byId('weekly-layout').hidden = false
  byId('weekly-layout').classList.toggle('unavailable', !canChooseWeeklyLayout)
  byId('weekly-layout').title = canChooseWeeklyLayout
    ? 'Weekly layout'
    : 'Available in the weekly timeline'
  byId('title-board').hidden = !titles
  byId('timeline-view').hidden = titles || tab === 'events'
  byId('panels').hidden = titles
  for (const option of ['titles', 'overview']) {
    const button = byId<HTMLButtonElement>('layout-' + option)
    button.disabled = !canChooseWeeklyLayout
    button.setAttribute(
      'aria-pressed',
      String(canChooseWeeklyLayout && layout === option),
    )
  }
  if (titles) {
    filterSequence++
    byId('page-title').textContent = 'Weekly timeline'
    board.set(key(), weekStart(date), titleData, state === 'offline')
    byId('foot-range').textContent =
      (titleData?.fetched
        ? 'Updated ' + time(titleData.fetched, true) + '   ·   '
        : '') + Intl.DateTimeFormat().resolvedOptions().timeZone
    return
  }
  view = weekly
    ? dateBounds
    : custom ||
      (mode === 'day' ? dateBounds : recordedRange(day.entries, dateBounds))
  const range = tab === 'events' ? dateBounds : view
  visible = weekly ? [] : day.entries.filter((e) => intersects(e, range))
  byId('page-title').textContent =
    tab === 'events'
      ? 'Event log'
      : weekly
        ? 'Weekly timeline'
        : 'Activity timeline'
  if (tab === 'timeline') {
    const summary = weekly && week ? week.totals : summarize(visible, range)
    const presence = weekly
      ? week?.rows.some((r) => r.presence)
      : visible.some((e) => e.kind === 'presence')
    const vals = [
      presence ? duration(summary.active) : '—',
      presence ? duration(summary.away) : '—',
      day.fetched ? num(summary.apps.length) : '—',
      day.fetched ? num(summary.count) : '—',
    ]
    vals.forEach((v, i) => (byId('metric-' + i).textContent = v))
    byId('day-map-back').hidden = weekly
    byId('map-title').textContent = weekly ? 'Week map' : 'Day map'
    if (weekly)
      byId('map-title').insertAdjacentHTML(
        'beforeend',
        '<small class="resolution" title="Each block shows the activity with the longest recorded duration in 15 minutes. The thin strip below shows active and away time.">15 min blocks</small>',
      )
    byId('week-map').hidden = !weekly
    byId('map').hidden = weekly
    byId('day-modes').hidden = weekly
    byId('week-source-field').hidden = !weekly
    byId('map-hint').innerHTML = weekly
      ? icon('pointer', 13) + 'Select a day to inspect · Wheel to change week'
      : icon('zoom', 13) + 'Drag to zoom · Wheel to change day'
    let top = summary.apps.slice(0, 4).map(([name]) => name)
    if (weekly) {
      const data = week || aggregateWeek(empty, weekStart(date))
      const lanes = data.lanes,
        choice =
          lanes.find((l) => l.id === weekLane) ||
          lanes.find((l) => l.kind === 'app') ||
          lanes[0]
      const control = byId<HTMLSelectElement>('week-source')
      control.innerHTML = lanes.length
        ? lanes
            .map(
              (l) =>
                '<option value="' +
                esc(l.id) +
                '">' +
                esc(l.label) +
                '</option>',
            )
            .join('')
        : '<option>Applications</option>'
      if (choice) control.value = choice.id
      weekMap.update(data, choice, today())
      drawSparks(data.sparks)
      if (choice && choice.kind !== 'app') {
        const weights = new Map<string, number>()
        for (const r of data.rows)
          for (const label of r.lanes[choice.id] || [])
            if (label) weights.set(label, (weights.get(label) || 0) + 1)
        top = [...weights]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([label]) => label)
      }
    } else {
      sparks(visible, range)
      map.update(day, view)
    }
    byId('recorded').setAttribute(
      'aria-pressed',
      String(!custom && mode === 'recorded'),
    )
    byId('full-day').setAttribute(
      'aria-pressed',
      String(!custom && mode === 'day'),
    )
    byId('reset-range').hidden = weekly || !custom
    byId('legend').innerHTML = [
      ...new Set([...top, ...(presence ? ['Active', 'Away'] : [])]),
    ]
      .map(
        (name) =>
          '<span><i class="swatch" style="--swatch:' +
          color(name) +
          '"></i>' +
          esc(presence && name === 'Away' ? 'Idle' : name) +
          '</span>',
      )
      .join('')
    byId('apps-count').textContent = num(summary.apps.length)
    const total = summary.apps.reduce((n, [, v]) => n + v, 0)
    byId('ranking').innerHTML =
      summary.apps
        .map(([name, value]) => {
          const fraction = total ? value / total : 0
          return (
            '<button class="rank-row" data-app="' +
            esc(name) +
            '" aria-pressed="' +
            (appFilter === name) +
            '" title="Filter event stream to ' +
            esc(name) +
            '"><span class="rank-line"><span><i class="swatch" style="--swatch:' +
            color(name) +
            '"></i>' +
            esc(name) +
            '</span><b>' +
            duration(value) +
            '</b></span><span class="rank-bottom"><span class="bar"><i style="width:' +
            fraction * 100 +
            '%;background:' +
            color(name) +
            '"></i></span><small>' +
            Math.round(fraction * 100) +
            '%</small></span></button>'
          )
        })
        .join('') ||
      '<div class="empty">' +
        (day.fetched
          ? 'No window activity in this range.'
          : state === 'offline'
            ? 'ActivityWatch is offline.'
            : 'Loading activity…') +
        '</div>'
  }
  filter(reset)
  byId('foot-range').textContent =
    (day.fetched ? 'Updated ' + time(day.fetched, true) + '   ·   ' : '') +
    Intl.DateTimeFormat().resolvedOptions().timeZone
}
async function filter(reset: boolean) {
  const sequence = ++filterSequence
  const q = query.trim().toLowerCase()
  byId('clear-search').style.visibility = query ? 'visible' : 'hidden'
  byId('app-filter').hidden = !appFilter
  byId('app-filter').innerHTML = esc(appFilter) + icon('close', 12)
  byId('app-filter').title = 'Clear application filter'
  let count = 0
  if (period === 'week' && week && workerContext === 0) {
    list.set([], view, reset)
    byId('event-count').textContent = num(week.totals.count)
    byId('list-empty').hidden = false
    byId('list-empty').textContent =
      state === 'offline'
        ? 'Event details unavailable offline.'
        : 'Loading event details…'
    return
  } else if (period === 'week' && week) {
    const result = await filterWeek(workerContext, q, source, appFilter)
    if (sequence !== filterSequence) return
    count = result.count
    list.setPages(count, view, reset, (start, end) =>
      pageWeek(result.filter, start, end),
    )
  } else {
    const entries = visible
      .filter(
        (e) =>
          (!source || e.kind === source) &&
          (!appFilter || (e.kind === 'app' && e.label === appFilter)) &&
          (!q ||
            (e.label + ' ' + e.detail + ' ' + kindNames[e.kind])
              .toLowerCase()
              .includes(q)),
      )
      .reverse()
    count = entries.length
    list.set(entries, tab === 'events' ? bounds(date) : view, reset)
  }
  byId('event-count').textContent = num(count)
  byId('list-empty').hidden = count > 0
  byId('list-empty').textContent = count
    ? ''
    : !day.fetched
      ? state === 'offline'
        ? 'ActivityWatch is offline.'
        : 'Loading events…'
      : q || source || appFilter
        ? 'No events match these filters.'
        : 'No events in this time range.'
}
async function load(refresh = false) {
  controller?.abort()
  cancelReads()
  const active = new AbortController()
  controller = active
  const local = period === 'day' ? cached(key()) : refresh ? day : undefined
  if (!refresh) {
    week = undefined
    titleData = undefined
  }
  day = local || empty
  const saved = readSetting<{ key: string; range: Range } | null>('zoom', null)
  custom =
    saved?.key === key() && saved.range[1] > saved.range[0] ? saved.range : null
  dates()
  const selected = readSetting<{ key: string; name: string } | null>(
    'application-filter',
    null,
  )
  appFilter = selected?.key === key() ? selected.name : ''
  if (
    !refresh &&
    local &&
    state !== 'offline' &&
    Date.now() - local.fetched < (date === today() ? 20000 : 86400000)
  ) {
    state = 'online'
    message = ''
    status()
    render(true)
    return
  }
  state = info ? 'online' : 'connecting'
  message = ''
  status()
  render(!refresh)
  try {
    if (!info || refresh) {
      const result = await discover(active.signal)
      if (active.signal.aborted) return
      info = result.info
      buckets = result.buckets
      const hosts = [...new Set(buckets.map((b) => b.hostname))].sort()
      if (!hosts.includes(host))
        host = hosts.includes(info.hostname)
          ? info.hostname
          : hosts[0] || info.hostname
      device.innerHTML = (hosts.length ? hosts : [host])
        .map((h) => '<option value="' + esc(h) + '">' + esc(h) + '</option>')
        .join('')
      device.value = host
      appFilter = selected?.key === key() ? selected.name : ''
      const z = readSetting<{ key: string; range: Range } | null>('zoom', null)
      custom = z?.key === key() ? z.range : null
    }
    const result = await loadPeriod(
      {
        type: 'load',
        host,
        date,
        buckets: showingTitles()
          ? buckets.filter((b) => b.type === 'currentwindow')
          : buckets,
        weekly: period === 'week',
        titles: showingTitles(),
        refresh,
      },
      (overview) => {
        if (active.signal.aborted) return
        week = overview
        workerContext = 0
        day = { entries: [], fetched: week.fetched, lanes: week.lanes }
        render(false)
      },
    )
    if (active.signal.aborted) return
    workerContext = result.context
    titleData = result.titles
    week = result.week
    if (result.day) {
      day = result.day
      remember(key(), day)
    } else if (week)
      day = { lanes: week.lanes, fetched: week.fetched, entries: [] }
    state = 'online'
    message = ''
  } catch (err) {
    if (active.signal.aborted) return
    state = 'offline'
    message =
      (day.fetched ? 'Showing cached activity. ' : '') +
      'Could not read ActivityWatch. Check that the server is running and allows ' +
      location.origin +
      ' in its CORS settings, then refresh. ' +
      (err instanceof Error ? err.message : '')
  }
  status()
  render(!refresh)
  if (
    titleData &&
    showingTitles() &&
    !active.signal.aborted &&
    state === 'online'
  ) {
    const presenceBuckets = buckets.filter(
      (b) => b.hostname === host && b.type === 'afkstatus',
    )
    if (!presenceBuckets.length) {
      board.setPresence(undefined, 'No presence watcher')
      return
    }
    try {
      const data = await loadPeriod({
        type: 'load',
        host,
        date,
        buckets: presenceBuckets,
        weekly: true,
        presenceOnly: true,
        refresh,
      })
      if (!active.signal.aborted && showingTitles())
        board.setPresence(data.presence)
    } catch {
      if (!active.signal.aborted && showingTitles())
        board.setPresence(undefined, 'Presence unavailable')
    }
  }
}
function changeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today()) return
  date = value
  save('date', value === today() ? 'today' : value)
  appFilter = ''
  closeDate()
  void load()
}
function closeDate() {
  byId('date-pop').hidden = true
  byId('open-date').setAttribute('aria-expanded', 'false')
}
for (const name of ['timeline', 'events'] as const)
  byId('nav-' + name).onclick = () => {
    if (tab === name) return
    const wasTitles = showingTitles()
    setTab(name)
    if (wasTitles !== showingTitles()) void load()
  }
for (const option of ['titles', 'overview'] as const)
  byId('layout-' + option).onclick = () => {
    if (option === layout) return
    layout = option
    save('weekly-layout', layout)
    void load()
  }
function stepPeriod(direction: number) {
  if (direction > 0 && byId<HTMLButtonElement>('next').disabled) return
  const next = moveDate(date, direction * (period === 'week' ? 7 : 1))
  changeDate(next > today() ? today() : next)
}
byId('prev').onclick = () => stepPeriod(-1)
byId('next').onclick = () => stepPeriod(1)
const dateNavigator = byId('open-date').parentElement!
dateNavigator.title = 'Wheel up for the previous period, down for the next'
const chartPanel = byId('map').parentElement!
const titleBoard = byId('title-board')
for (const surface of [dateNavigator, chartPanel, titleBoard]) {
  let wheelDistance = 0,
    lastWheel = 0
  surface.addEventListener(
    'wheel',
    (e) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.buttons ||
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ||
        !e.deltaY ||
        !byId('date-pop').hidden
      )
        return
      const target = e.target as Element
      if (
        (surface === chartPanel && target.closest('.map-actions')) ||
        (surface === titleBoard && !target.closest('.col-head'))
      ) {
        wheelDistance = 0
        return
      }
      e.preventDefault()
      const dy = e.deltaY,
        now = performance.now()
      if (now - lastWheel > 180 || Math.sign(wheelDistance) !== Math.sign(dy))
        wheelDistance = 0
      lastWheel = now
      wheelDistance += e.deltaMode === 0 ? dy : Math.sign(dy) * 60
      if (Math.abs(wheelDistance) >= 60) {
        stepPeriod(Math.sign(wheelDistance))
        wheelDistance = 0
      }
    },
    { passive: false },
  )
  surface.addEventListener('pointerleave', () => {
    wheelDistance = 0
  })
}
function setPeriod(p: typeof period) {
  if (period === p) return
  period = p
  save('period', p)
  appFilter = ''
  void load()
}
for (const p of ['week', 'day'] as const)
  byId('period-' + p).onclick = () => setPeriod(p)
byId('date-caption').onclick = () => setPeriod('week')
byId('day-map-back').onclick = () => setPeriod('week')
byId<HTMLSelectElement>('week-source').onchange = (e) => {
  weekLane = (e.target as HTMLSelectElement).value
  save('week-lane', weekLane)
  render(false)
}
byId('today').onclick = () => changeDate(today())
byId('open-date').onclick = () => {
  const pop = byId('date-pop')
  pop.hidden = !pop.hidden
  byId('open-date').setAttribute('aria-expanded', String(!pop.hidden))
  if (!pop.hidden) byId('date-input').focus()
}
byId<HTMLInputElement>('date-input').onchange = (e) =>
  changeDate((e.target as HTMLInputElement).value)
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as Element).closest('.date-group')) closeDate()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !byId('date-pop').hidden) {
    closeDate()
    byId('open-date').focus()
  }
})
device.onchange = () => {
  host = device.value
  save('device', host)
  appFilter = ''
  void load()
}
byId('reload').onclick = () => void load(true)
byId('recorded').onclick = () => setMode('recorded')
byId('full-day').onclick = () => setMode('day')
byId('reset-range').onclick = () => setZoom(null)
byId('ranking').onclick = (e) => {
  const target = (e.target as Element).closest<HTMLElement>('[data-app]')
  if (target) {
    appFilter = appFilter === target.dataset.app ? '' : target.dataset.app!
    save('application-filter', { key: key(), name: appFilter })
    source = ''
    src.value = ''
    save('source', '')
    render(true)
  }
}
byId('app-filter').onclick = () => {
  appFilter = ''
  save('application-filter', null)
  render(true)
}
search.oninput = () => {
  query = search.value
  save('search', query)
  filter(true)
}
byId('clear-search').onclick = () => {
  query = search.value = ''
  save('search', '')
  filter(true)
  search.focus()
}
src.onchange = () => {
  source = src.value as Kind | ''
  save('source', source)
  if (source && source !== 'app') {
    appFilter = ''
    save('application-filter', null)
  }
  render(true)
}
byId('connection').onclick = () =>
  popup.show(
    byId('connection'),
    true,
    'Server connection',
    '<dl><dt>Status</dt><dd>' +
      esc(byId('status').textContent) +
      '</dd><dt>Server</dt><dd>' +
      esc(info?.hostname || 'ActivityWatch') +
      '</dd><dt>Version</dt><dd>' +
      esc(info?.version || 'Unavailable') +
      '</dd><dt>API route</dt><dd>' +
      esc(api) +
      '</dd><dt>Access</dt><dd>Read-only</dd></dl>',
  )
setTab(tab)
void load()
