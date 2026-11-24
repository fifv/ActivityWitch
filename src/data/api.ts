import {
  laneOf,
  normalize,
  type Bucket,
  type Day,
  type RawEvent,
  type Entry,
  type Range,
} from './model'
export const api = (
  import.meta.env.VITE_AW_API_BASE || 'http://127.0.0.1:5600/api/0'
).replace(/\/$/, '')
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(api + path, {
    method: 'GET',
    signal,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok)
    throw new Error('ActivityWatch returned HTTP ' + response.status)
  return response.json()
}
export async function discover(signal: AbortSignal) {
  const [info, buckets] = await Promise.all([
    read<{ hostname: string; version: string }>('/info', signal),
    read<Record<string, Bucket>>('/buckets/', signal),
  ])
  return { info, buckets: Object.values(buckets) }
}
export async function fetchPeriod(
  host: string,
  range: Range,
  buckets: Bucket[],
  signal: AbortSignal,
): Promise<Day> {
  const selected = buckets.filter(
    (b) =>
      b.hostname === host &&
      (!b.metadata?.start || Date.parse(b.metadata.start) < range[1]),
  )
  const order = ['app', 'web', 'editor', 'presence', 'other']
  const lanes = selected
    .map(laneOf)
    .sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        a.id.localeCompare(b.id),
    )
  for (const lane of lanes) {
    if (lanes.filter((l) => l.kind === lane.kind).length > 1)
      lane.label = selected
        .find((b) => b.id === lane.id)!
        .client.replace(/^aw-watcher-/, '')
  }
  const start = new Date(range[0]).toISOString(),
    end = new Date(range[1]).toISOString()
  const groups = await Promise.all(
    lanes.map(async (lane) => {
      const path = '/buckets/' + encodeURIComponent(lane.id) + '/events?'
      // Also request the immediately preceding event to capture midnight-spanning sessions.
      const [events, previous] = await Promise.all([
        read<RawEvent[]>(
          path + new URLSearchParams({ start, end, limit: '-1' }),
          signal,
        ),
        read<RawEvent[]>(
          path + new URLSearchParams({ end: start, limit: '1' }),
          signal,
        ),
      ])
      const values: Entry[] = []
      const ids = new Set<number>()
      for (const event of [...previous, ...events]) {
        if (ids.has(event.id)) continue
        ids.add(event.id)
        const entry = normalize(event, lane, range)
        if (entry) values.push(entry)
      }
      return values
    }),
  )
  return {
    entries: groups.flat().sort((a, b) => a.start - b.start || a.end - b.end),
    lanes,
    fetched: Date.now(),
  }
}
