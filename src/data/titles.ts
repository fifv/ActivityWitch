import { moveDate, type Day } from './model.ts'

export interface WindowLabel {
  title: string
  app: string
}
export interface TitleDay {
  date: string
  start: Float64Array
  end: Float64Array
  label: Uint32Array
  records: Uint32Array
  // Index in the application dictionary, plus one. Zero is unobserved.
  strip: Uint32Array
  windowMs: number
}
export interface TitleWeek {
  monday: string
  labels: WindowLabel[]
  apps: [string, number][]
  days: TitleDay[]
  fetched: number
}

const quarter = 900000
export function buildTitleWeek(
  monday: string,
  snapshots: (Day | undefined)[],
): TitleWeek {
  const labels: WindowLabel[] = [],
    apps: [string, number][] = []
  const dictionaries = new Map<string, Map<string, number>>()
  const appIds = new Map<string, number>()
  const days = Array.from({ length: 7 }, (_, dayIndex) => {
    const date = moveDate(monday, dayIndex)
    const snapshot = snapshots[dayIndex]
    const starts: number[] = [],
      ends: number[] = [],
      ids: number[] = [],
      counts: number[] = []
    const weights = Array.from({ length: 96 }, () => new Map<number, number>())
    let lastLane = '',
      lastProcess = '',
      total = 0
    for (const entry of snapshot?.entries ?? []) {
      if (entry.kind !== 'app') continue
      const { label: app, detail: title, start, end, lane } = entry
      // Form visits before applying search or time filters. A → B → A stays distinct.
      const process = typeof entry.data.app === 'string' ? entry.data.app : app
      let dict = dictionaries.get(app)
      if (!dict) {
        dict = new Map()
        dictionaries.set(app, dict)
      }
      let label = dict.get(title)
      if (label === undefined) {
        label = labels.length
        labels.push({ title, app })
        dict.set(title, label)
      }
      let appId = appIds.get(app)
      if (appId === undefined) {
        appId = apps.length
        appIds.set(app, appId)
        apps.push([app, 0])
      }
      const i = starts.length - 1
      const merge =
        i >= 0 &&
        ids[i] === label &&
        lastLane === lane &&
        lastProcess === process &&
        start <= ends[i]
      const observedStart = merge ? Math.max(start, ends[i]) : start
      if (merge) {
        ends[i] = Math.max(end, ends[i])
        counts[i]++
      } else {
        starts.push(start)
        ends.push(end)
        ids.push(label)
        counts.push(1)
      }
      lastLane = lane
      lastProcess = process
      const length = Math.max(0, end - observedStart)
      total += length
      apps[appId][1] += length
      for (let t = observedStart; t < end;) {
        const clock = new Date(t)
        const slot = clock.getHours() * 4 + Math.floor(clock.getMinutes() / 15)
        const part = Math.min(
          end - t,
          quarter -
            ((clock.getMinutes() % 15) * 60000 +
              clock.getSeconds() * 1000 +
              clock.getMilliseconds()),
        )
        const cell = weights[slot]
        cell.set(appId, (cell.get(appId) || 0) + part)
        t += part
      }
    }
    const strip = Uint32Array.from(weights, (cell) => {
      let winner = 0,
        max = 0
      for (const [id, ms] of cell)
        if (ms > max) {
          winner = id + 1
          max = ms
        }
      return winner
    })
    return {
      date,
      start: Float64Array.from(starts),
      end: Float64Array.from(ends),
      label: Uint32Array.from(ids),
      records: Uint32Array.from(counts),
      strip,
      windowMs: total,
    }
  })
  return {
    monday,
    labels,
    apps,
    days,
    fetched: Math.max(0, ...snapshots.map((d) => d?.fetched ?? 0)),
  }
}
export function titleBuffers(data: TitleWeek): ArrayBuffer[] {
  return data.days.flatMap((d) =>
    [d.start, d.end, d.label, d.records, d.strip].map(
      (array) => array.buffer as ArrayBuffer,
    ),
  )
}
