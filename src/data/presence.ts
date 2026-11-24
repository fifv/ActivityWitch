import type { Day, Entry, Range } from './model'
export interface PresenceSpan {
  start: number
  end: number
  from: number
  until: number
  idle: boolean
}
export type PresenceWeek = PresenceSpan[][]

/** Combine watcher coverage. A positive active observation takes precedence over idle. */
export function buildPresenceWeek(days: (Day | undefined)[]): PresenceWeek {
  return Array.from({ length: 7 }, (_, i) =>
    buildPresenceSpans(days[i]?.entries ?? []),
  )
}
export function buildPresenceSpans(
  entries: Entry[],
  range?: Range,
): PresenceSpan[] {
  const changes: { t: number; active: number; idle: number }[] = []
  for (const e of entries) {
    if (
      e.kind !== 'presence' ||
      e.end <= e.start ||
      !['Active', 'Away'].includes(e.label)
    )
      continue
    const idle = Number(e.label === 'Away'),
      active = 1 - idle
    const start = range ? Math.max(e.start, range[0]) : e.start,
      end = range ? Math.min(e.end, range[1]) : e.end
    if (start >= end) continue
    changes.push(
      { t: start, active, idle },
      { t: end, active: -active, idle: -idle },
    )
  }
  changes.sort((a, b) => a.t - b.t)
  const spans: PresenceSpan[] = []
  function add(start: number, end: number, idle: boolean) {
    const d = new Date(start)
    const offset = d.getTimezoneOffset()
    if (offset !== new Date(Math.ceil(end) - 1).getTimezoneOffset()) {
      let lo = start,
        hi = Math.ceil(end) - 1
      while (hi - lo > 1) {
        const m = Math.floor((lo + hi) / 2)
        if (new Date(m).getTimezoneOffset() === offset) lo = m
        else hi = m
      }
      add(start, hi, idle)
      add(hi, end, idle)
      return
    }
    const from =
      d.getHours() * 60 +
      d.getMinutes() +
      (d.getSeconds() + d.getMilliseconds() / 1000) / 60
    const until = from + (end - start) / 60000
    const prev = spans.at(-1)
    if (
      prev &&
      prev.idle === idle &&
      prev.end === start &&
      Math.abs(prev.until - from) < 0.0001
    ) {
      prev.end = end
      prev.until = until
    } else spans.push({ start, end, from, until, idle })
  }
  let active = 0,
    idle = 0,
    previous = 0
  for (const change of changes) {
    if (change.t > previous && (active || idle))
      add(previous, change.t, active === 0)
    active += change.active
    idle += change.idle
    previous = change.t
  }
  return spans
}

export function presenceAt(spans: PresenceSpan[], t: number) {
  let lo = 0,
    hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (spans[mid].end <= t) lo = mid + 1
    else hi = mid
  }
  return spans[lo]?.start <= t ? spans[lo] : undefined
}
