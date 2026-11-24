export interface Bucket {
  id: string
  type: string
  hostname: string
  client: string
  metadata?: { start?: string; end?: string }
}
export interface RawEvent {
  id: number
  timestamp: string
  duration: number
  data: Record<string, unknown>
}
export type Kind = 'app' | 'web' | 'editor' | 'presence' | 'other'
export interface Lane {
  id: string
  kind: Kind
  label: string
}
export interface Entry {
  id: string
  lane: string
  kind: Kind
  label: string
  detail: string
  start: number
  end: number
  data: Record<string, unknown>
}
export interface Day {
  entries: Entry[]
  lanes: Lane[]
  fetched: number
}
export type Range = [number, number]
const hour = 3600000
export const palette = [
  '#8879f2',
  '#56bca7',
  '#eca26b',
  '#689fde',
  '#c67db5',
  '#b4b961',
  '#79b7cb',
  '#b596dc',
  '#d5a456',
  '#8e9fc1',
]
const colorMap: Record<string, string> = {
  Active: '#54c5a4',
  Away: '#999999',
  Firefox: '#f19a65',
  Chrome: '#72b99a',
  'VS Code': '#69a9e4',
  Codex: '#a198ed',
}
export function color(label: string) {
  let hash = 0
  for (let i = 0; i < label.length; i++)
    hash = (Math.imul(31, hash) + label.charCodeAt(i)) | 0
  return Object.hasOwn(colorMap, label)
    ? colorMap[label]
    : palette[(hash >>> 0) % palette.length]
}
export function dateKey(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export function bounds(date: string): Range {
  const start = new Date(date + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [+start, +end]
}
export function moveDate(date: string, delta: number) {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return dateKey(d)
}
export function weekStart(date: string) {
  const weekday = new Date(date + 'T12:00:00').getDay()
  return moveDate(date, -((weekday + 6) % 7))
}
export function periodBounds(date: string, weekly: boolean): Range {
  if (!weekly) return bounds(date)
  const monday = weekStart(date)
  return [bounds(monday)[0], bounds(moveDate(monday, 7))[0]]
}
export function sliceDay(data: Day, range: Range): Day {
  return {
    ...data,
    entries: data.entries
      .filter((entry) => intersects(entry, range))
      .map((entry) =>
        entry.start < range[0] || entry.end > range[1]
          ? {
              ...entry,
              start: Math.max(entry.start, range[0]),
              end: Math.min(entry.end, range[1]),
            }
          : entry,
      ),
  }
}
const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const precise = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
export function time(ms: number, seconds = false) {
  return (seconds ? precise : clock).format(ms)
}
export function duration(ms: number) {
  const sec = Math.round(ms / 1000),
    min = Math.floor(sec / 60),
    h = Math.floor(min / 60)
  if (h) return h + 'h ' + (min % 60) + 'm'
  if (min)
    return min + 'm' + (min < 10 && sec % 60 ? ' ' + (sec % 60) + 's' : '')
  return sec + 's'
}
const names: Record<string, string> = {
  firefox: 'Firefox',
  chrome: 'Chrome',
  msedge: 'Edge',
  code: 'VS Code',
  'code - insiders': 'VS Code Insiders',
  explorer: 'File Explorer',
  windowsterminal: 'Windows Terminal',
  codex: 'Codex',
  applicationframehost: 'Windows apps',
  discord: 'Discord',
  obs64: 'OBS Studio',
  powershell: 'PowerShell',
  devenv: 'Visual Studio',
}
export function appName(value: string) {
  const key = (value.split(/[\\/]/).pop() || value).replace(/\.exe$/i, '')
  return Object.hasOwn(names, key.toLowerCase())
    ? names[key.toLowerCase()]
    : key || 'Unknown application'
}
const types: Record<string, [Kind, string]> = {
  currentwindow: ['app', 'Applications'],
  'web.tab.current': ['web', 'Browser'],
  'app.editor.activity': ['editor', 'Editor'],
  afkstatus: ['presence', 'Presence'],
}
export function laneOf(b: Bucket): Lane {
  const [kind, label] = Object.hasOwn(types, b.type)
    ? types[b.type]
    : ['other' as Kind, b.client || b.type]
  return { id: b.id, kind, label }
}
export const kindNames: Record<Kind, string> = {
  app: 'Application',
  web: 'Browser',
  editor: 'Editor',
  presence: 'Presence',
  other: 'Watcher',
}
export function normalize(
  raw: RawEvent,
  lane: Lane,
  range: Range,
): Entry | undefined {
  const start = Date.parse(raw.timestamp),
    end = start + raw.duration * 1000
  if (
    !Number.isFinite(start + end) ||
    end < start ||
    start >= range[1] ||
    end < range[0] ||
    (end === range[0] && start < end)
  )
    return
  const d = raw.data || {}
  const field = (key: string) =>
    typeof d[key] === 'string' ? (d[key] as string) : ''
  let label = lane.label,
    detail = ''
  if (lane.kind === 'app') {
    label = appName(field('app'))
    detail = field('title')
  } else if (lane.kind === 'presence') {
    label =
      field('status') === 'not-afk'
        ? 'Active'
        : field('status') === 'afk'
          ? 'Away'
          : field('status') || 'Unknown'
  } else if (lane.kind === 'web') {
    try {
      const u = new URL(field('url'))
      label = u.hostname.replace(/^www\./, '') || u.protocol
    } catch {
      label = field('url') || 'Browser'
    }
    detail = field('title') || field('url')
  } else if (lane.kind === 'editor') {
    label = field('project') || field('language') || 'Editor'
    detail = field('file') || field('title')
  } else {
    label = field('label') || field('title') || field('activity') || lane.label
    detail = Object.values(d)
      .filter((v) => typeof v === 'string')
      .join(' · ')
  }
  return {
    id: lane.id + '/' + raw.id,
    lane: lane.id,
    kind: lane.kind,
    label,
    detail,
    start: Math.max(start, range[0]),
    end: Math.min(end, range[1]),
    data: d,
  }
}
export function recordedRange(entries: Entry[], day: Range): Range {
  if (!entries.length) return day
  const start = entries[0].start,
    end = entries.reduce((v, e) => Math.max(v, e.end), start)
  return [
    Math.max(day[0], day[0] + Math.floor((start - day[0]) / hour) * hour),
    Math.min(day[1], day[0] + (Math.floor((end - day[0]) / hour) + 1) * hour),
  ]
}
export function intersects(e: Entry, [start, end]: Range) {
  return (
    e.start < end && (e.end > start || (e.end === e.start && e.start >= start))
  )
}
export function summarize(entries: Entry[], range: Range) {
  const apps = new Map<string, number>()
  const presenceEnds = new Map<string, number>()
  let active = 0,
    away = 0,
    count = 0
  for (const e of entries) {
    if (!intersects(e, range)) continue
    const start = Math.max(range[0], e.start),
      end = Math.min(range[1], e.end)
    count++
    if (e.kind === 'app')
      apps.set(e.label, (apps.get(e.label) || 0) + end - start)
    if (e.kind !== 'presence') continue
    const previous = presenceEnds.get(e.label) ?? start
    const length = Math.max(0, end - Math.max(start, previous))
    if (e.label === 'Active') active += length
    if (e.label === 'Away') away += length
    presenceEnds.set(e.label, Math.max(end, previous))
  }
  return {
    active,
    away,
    count,
    apps: [...apps].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  }
}
