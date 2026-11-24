import {
  bounds,
  moveDate,
  summarize,
  type Day,
  type Entry,
  type Lane,
} from './model.ts'
import { buildPresenceSpans, type PresenceSpan } from './presence.ts'
export const slots = 96
export const slotMs = 900000
export interface WeekRow {
  date: string
  active: number
  presence: boolean
  coverage: PresenceSpan[]
  coverageByLane?: Record<string, PresenceSpan[]>
  lanes: Record<string, (string | null)[]>
  details?: Record<string, (string | null)[]>
  activeMs: number[]
  awayMs: number[]
}
export interface WeekSummary {
  monday: string
  lanes: Lane[]
  rows: WeekRow[]
  totals: ReturnType<typeof summarize>
  fetched: number
  sparks: number[][]
}
export function aggregateWeek(data: Day, monday: string): WeekSummary {
  const rows: WeekRow[] = []
  const sparks: number[][] = [[], [], [], []]
  const totals = summarize(data.entries, [
    bounds(monday)[0],
    bounds(moveDate(monday, 7))[0],
  ])
  const days = Array.from({ length: 7 }, (_, i) => moveDate(monday, i))
  const sorted = data.entries
  let first = 0
  for (const date of days) {
    const range = bounds(date),
      [start, end] = range
    while (first < sorted.length && sorted[first].end < start) first++
    const records: Entry[] = []
    for (let i = first; i < sorted.length && sorted[i].start < end; i++) {
      const e = sorted[i]
      if (e.end > start || (e.start === e.end && e.start >= start))
        records.push(e)
    }
    const summary = summarize(records, range)
    const row: WeekRow = {
      date,
      active: summary.active,
      presence: records.some((e) => e.kind === 'presence'),
      coverage: buildPresenceSpans(records, range),
      lanes: Object.create(null),
      details: Object.create(null),
      activeMs: Array(slots).fill(0),
      awayMs: Array(slots).fill(0),
    }
    const weights = new Map<
      string,
      Map<string, { ms: number; longest: number; detail: string }>[]
    >()
    const presenceLanes = data.lanes.filter((l) => l.kind === 'presence')
    if (presenceLanes.length > 1)
      row.coverageByLane = Object.fromEntries(
        presenceLanes.map((l) => [
          l.id,
          buildPresenceSpans(
            records.filter((e) => e.lane === l.id),
            range,
          ),
        ]),
      )
    const presenceEnd = new Map<string, number>()
    const offset = new Date(start).getTimezoneOffset()
    const steady = offset === new Date(end - 1).getTimezoneOffset()
    for (const e of records) {
      let lane = weights.get(e.lane)
      if (!lane) {
        lane = Array.from({ length: slots }, () => new Map())
        weights.set(e.lane, lane)
      }
      let t = Math.max(e.start, start)
      const stop = Math.min(e.end, end)
      const prior = e.kind === 'presence' ? (presenceEnd.get(e.label) ?? t) : t
      if (e.kind === 'presence') presenceEnd.set(e.label, Math.max(stop, prior))
      // Work in elapsed time, translating each quarter-hour on DST transition days.
      while (t < stop) {
        const wall =
          t -
          start +
          (steady ? 0 : (offset - new Date(t).getTimezoneOffset()) * 60000)
        const slot = Math.floor(wall / slotMs)
        const n = Math.min(stop - t, slotMs - (wall % slotMs))
        if (slot >= 0 && slot < slots) {
          const cell = lane[slot]
          let weight = cell.get(e.label)
          if (!weight) {
            weight = { ms: 0, longest: 0, detail: '' }
            cell.set(e.label, weight)
          }
          weight.ms += n
          if (n > weight.longest) {
            weight.longest = n
            weight.detail = e.detail
          }
          const observed = Math.max(0, t + n - Math.max(t, prior))
          if (e.kind === 'presence' && e.label === 'Active')
            row.activeMs[slot] += observed
          if (e.kind === 'presence' && e.label === 'Away')
            row.awayMs[slot] += observed
        }
        t += n
      }
    }
    for (const [id, cells] of weights) {
      const details: (string | null)[] = []
      row.lanes[id] = cells.map((cell) => {
        let label: string | null = null,
          max = 0
        for (const [name, { ms }] of cell)
          if (ms > max) {
            label = name
            max = ms
          }
        details.push(label ? cell.get(label)!.detail || null : null)
        return label
      })
      if (details.some(Boolean)) row.details![id] = details
    }
    rows.push(row)
    ;[
      summary.active,
      summary.away,
      summary.apps.length,
      records.length,
    ].forEach((v, i) => sparks[i].push(v))
  }
  return {
    monday,
    lanes: data.lanes,
    rows,
    totals,
    fetched: data.fetched,
    sparks,
  }
}
