import { api, fetchPeriod } from './api'
import {
  bounds,
  dateKey,
  kindNames,
  moveDate,
  sliceDay,
  weekStart,
  type Day,
  type Entry,
} from './model'
import { getDays, putDays, getOverview, putOverview } from './day-cache'
import { aggregateWeek } from './weekly'
import { buildTitleWeek, titleBuffers } from './titles'
import { buildPresenceWeek } from './presence'
import type { Request } from './worker-client'
let controller: AbortController | undefined
let context = 0,
  filter = 0,
  current: Entry[] = [],
  matches: Entry[] = []
let lastWeek:
  | { key: string; data: Day; overview: ReturnType<typeof aggregateWeek> }
  | undefined
async function load(msg: Extract<Request, { type: 'load' }>, id: number) {
  controller?.abort()
  const active = new AbortController()
  controller = active
  const first = msg.weekly ? weekStart(msg.date) : msg.date
  const today = dateKey()
  const dates = Array.from({ length: msg.weekly ? 7 : 1 }, (_, i) =>
    moveDate(first, i),
  ).filter((d) => d <= today)
  const signature = msg.buckets
    .filter((b) => b.hostname === msg.host)
    .map((b) => [b.id, b.type])
    .sort()
  const prefix = JSON.stringify([
    api,
    msg.host,
    signature,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ])
  const weekKey = prefix + weekStart(first)
  if (
    !msg.titles &&
    !msg.presenceOnly &&
    !msg.refresh &&
    lastWeek?.key === weekKey &&
    Date.now() - lastWeek.data.fetched < 30000
  ) {
    context = id
    current = lastWeek.data.entries
    matches = []
    return msg.weekly
      ? { week: lastWeek.overview, context }
      : { day: sliceDay(lastWeek.data, bounds(first)), context }
  }
  if (msg.weekly && !msg.titles && !msg.presenceOnly && !msg.refresh) {
    const cached = await getOverview(weekKey)
    if (
      cached?.rows.every((row) => Array.isArray(row.coverage)) &&
      !active.signal.aborted
    )
      self.postMessage({ id, preview: cached })
  }
  const days = msg.refresh
    ? dates.map(() => undefined)
    : await getDays(prefix, dates)
  const fresh = new Map<string, Day>()
  for (let i = 0; i < dates.length;) {
    active.signal.throwIfAborted()
    if (days[i]) {
      i++
      continue
    }
    const a = i
    while (i < dates.length && !days[i]) i++
    const fetched = await fetchPeriod(
      msg.host,
      [bounds(dates[a])[0], bounds(dates[i - 1])[1]],
      msg.buckets,
      active.signal,
    )
    for (let j = a; j < i; j++) {
      const day = sliceDay(fetched, bounds(dates[j]))
      days[j] = day
      fresh.set(dates[j], day)
    }
  }
  active.signal.throwIfAborted()
  if (fresh.size) void putDays(prefix, fresh).catch(() => {})
  if (msg.presenceOnly) return { presence: buildPresenceWeek(days), context }
  context = id
  matches = []
  if (msg.titles) {
    current = []
    return { titles: buildTitleWeek(first, days), context }
  }
  if (!msg.weekly) {
    current = []
    if (msg.refresh) lastWeek = undefined
    return { day: days[0], context }
  }
  // A session spanning midnight is present in both day caches. Rejoin its fragments.
  const byId = new Map<string, Entry>(),
    lanes = new Map<string, Day['lanes'][number]>()
  for (const day of days) {
    if (!day) continue
    for (const l of day.lanes) lanes.set(l.id, l)
    for (const e of day.entries) {
      const previous = byId.get(e.id)
      if (previous)
        byId.set(e.id, {
          ...previous,
          start: Math.min(previous.start, e.start),
          end: Math.max(previous.end, e.end),
        })
      else byId.set(e.id, e)
    }
  }
  current = [...byId.values()].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )
  const data: Day = {
    entries: current,
    lanes: [...lanes.values()],
    fetched: Math.max(0, ...days.map((d) => d?.fetched ?? 0)),
  }
  const overview = aggregateWeek(data, first)
  void putOverview(weekKey, overview).catch(() => {})
  lastWeek = { key: weekKey, data, overview }
  return { week: overview, context }
}
self.onmessage = async ({ data }: { data: { id: number; msg: Request } }) => {
  const { id, msg } = data
  try {
    let result: unknown
    if (msg.type === 'cancel') {
      controller?.abort()
      return
    }
    if (msg.type === 'load') {
      const loaded = await load(msg, id)
      if (loaded.titles) {
        self.postMessage(
          { id, result: loaded },
          { transfer: titleBuffers(loaded.titles) },
        )
        return
      }
      result = loaded
    }
    if (msg.type === 'filter') {
      const terms = msg.search.trim().toLowerCase()
      if (msg.context !== context) matches = []
      else if (!msg.source && !msg.app && !terms) matches = current
      else
        matches = current.filter(
          (e) =>
            (!msg.source || e.kind === msg.source) &&
            (!msg.app || (e.kind === 'app' && e.label === msg.app)) &&
            (!terms ||
              (e.label + ' ' + e.detail + ' ' + kindNames[e.kind])
                .toLowerCase()
                .includes(terms)),
        )
      filter = id
      result = { filter, count: matches.length }
    }
    if (msg.type === 'page')
      result =
        msg.filter !== filter
          ? []
          : matches
              .slice(
                Math.max(0, matches.length - msg.end),
                matches.length - msg.start,
              )
              .reverse()
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
