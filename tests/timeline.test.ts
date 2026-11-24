import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bounds,
  laneOf,
  normalize,
  periodBounds,
  sliceDay,
  summarize,
  weekStart,
  type Day,
  type Entry,
} from '../src/data/model.ts'
import { aggregateWeek } from '../src/data/weekly.ts'
import { buildTitleWeek } from '../src/data/titles.ts'
import { buildPresenceWeek, presenceAt } from '../src/data/presence.ts'
import { VisitIndex } from '../src/data/visit-index.ts'
import { durationPercent } from '../src/ui/duration-meter.ts'
test('visit duration bars share the same thresholds across all days', () => {
  assert.deepEqual(
    [0, 10000, 60000, 600000, 3600000, 86400000, 90000000].map(durationPercent),
    [0, 20, 40, 60, 80, 100, 100],
  )
  assert.equal(durationPercent(6000), 12)
  assert.ok(durationPercent(50000) > durationPercent(6000))
})

const monday = '2026-11-16'
const [start] = bounds(monday)
const minute = 60000
test('weekly presence keeps gaps within a quarter-hour and clips midnight spans', () => {
  const records = [
    entry('1', 'Away', -2, 2),
    entry('2', 'Active', 7, 9),
    entry('3', 'Away', 10, 11),
  ].map((e) => ({ ...e, kind: 'presence' as const }))
  const week = aggregateWeek(
    { entries: records, lanes: [], fetched: 1 },
    monday,
  )
  assert.deepEqual(
    week.rows[0].coverage.map((s) => [s.from, s.until, s.idle]),
    [
      [0, 2, true],
      [7, 9, false],
      [10, 11, true],
    ],
  )
  assert.deepEqual(week.rows[1].coverage, [])
})
test('hover resolves exact, overlapping and point visits without filling gaps', () => {
  const index = new VisitIndex(
    Float64Array.of(1, 3, 6, 6, 12),
    Float64Array.of(10, 4, 6, 8, 12),
  )
  assert.deepEqual(
    [0, 1, 3, 4, 6, 8, 10, 11, 12, 13].map((t) => index.at(t)),
    [-1, 0, 1, 0, 3, 0, -1, -1, 4, -1],
  )
})
test('presence bands distinguish recorded idle, active and missing coverage', () => {
  const entries = [
    entry('1', 'Away', 3, 15),
    entry('2', 'Active', 5, 10),
    entry('3', 'Away', 15, 16),
  ].map((e) => ({ ...e, kind: 'presence' as const }))
  const [spans] = buildPresenceWeek([{ lanes: [], entries, fetched: 1 }])
  assert.deepEqual(
    spans.map((s) => [s.from, s.until, s.idle]),
    [
      [3, 5, true],
      [5, 10, false],
      [10, 16, true],
    ],
  )
  assert.equal(presenceAt(spans, start + minute), undefined)
  assert.equal(presenceAt(spans, start + 5 * minute)?.idle, false)
  assert.equal(presenceAt(spans, start + 16 * minute), undefined)
})
test('title visits retain returns, gaps and point events and merge contiguous exact titles', () => {
  const values = [
    ['A', 0, 4],
    ['A', 3, 5],
    ['B', 5, 5],
    ['A', 5, 8],
    ['A', 10, 15],
  ] as const
  const events = values.map(([detail, a, b], i) => ({
    ...entry(String(i), 'Editor', a, b),
    detail,
  }))
  const week = buildTitleWeek(monday, [
    { entries: events, lanes: [], fetched: 1 },
  ])
  const mondayVisits = week.days[0]
  assert.deepEqual(Array.from(mondayVisits.records), [2, 1, 1, 1])
  assert.deepEqual(
    Array.from(mondayVisits.label, (i) => week.labels[i].title),
    ['A', 'B', 'A', 'A'],
  )
  assert.equal(mondayVisits.windowMs, 13 * minute)
  assert.equal(week.apps[0][1], 13 * minute)
  assert.equal(mondayVisits.strip[0], 1)
  assert.equal(mondayVisits.strip[1], 0)
  assert.equal(week.days[6].start.length, 0)
})
const lane = laneOf({
  id: 'window',
  hostname: 'local',
  client: 'watcher',
  type: 'currentwindow',
})
function entry(id: string, label: string, from: number, to: number): Entry {
  return {
    id,
    label,
    detail: '',
    lane: lane.id,
    kind: lane.kind,
    start: start + from * minute,
    end: start + to * minute,
    data: {},
  }
}
test('calendar weeks include Sunday and can cross a year boundary', () => {
  assert.equal(weekStart('2027-01-03'), '2026-12-28')
  assert.deepEqual(periodBounds('2027-01-03', true), [
    bounds('2026-12-28')[0],
    bounds('2027-01-04')[0],
  ])
})
test('half-open ranges clip crossing events and include a point only once', () => {
  const raw = {
    id: 1,
    timestamp: new Date(start - 10 * minute).toISOString(),
    duration: 20 * 60,
    data: { app: 'code.exe', title: 'A' },
  }
  const e = normalize(raw, lane, bounds(monday))!
  assert.equal(e.label, 'VS Code')
  assert.equal(e.start, start)
  assert.equal(e.end, start + 10 * minute)
  const data: Day = {
    entries: [entry('a', 'A', 1435, 1445), entry('b', 'B', 1440, 1440)],
    lanes: [lane],
    fetched: 1,
  }
  assert.equal(sliceDay(data, bounds(monday)).entries.length, 1)
  const next = sliceDay(data, bounds('2026-11-17'))
  assert.equal(next.entries.length, 2)
  assert.equal(next.entries[0].start, bounds('2026-11-17')[0])
})
test('week bins use total duration per label, leave gaps and preserve exact event counts', () => {
  const events = [
    entry('1', 'A', 0, 5),
    entry('2', 'B', 5, 12),
    entry('3', 'A', 12, 15),
    entry('4', 'B', 45, 45),
    entry('5', 'B', 1435, 1445),
  ]
  const week = aggregateWeek(
    { entries: events, lanes: [lane], fetched: 1 },
    monday,
  )
  assert.equal(week.rows.length, 7)
  assert.deepEqual(week.rows[0].lanes.window.slice(0, 4), [
    'A',
    null,
    null,
    null,
  ])
  assert.equal(week.rows[0].lanes.window[95], 'B')
  assert.equal(week.rows[1].lanes.window[0], 'B')
  assert.equal(week.totals.count, 5)
  assert.deepEqual(week.totals.apps, [
    ['B', 17 * minute],
    ['A', 8 * minute],
  ])
})
test('presence totals merge overlapping intervals of the same status', () => {
  const events = [
    entry('1', 'Active', 0, 15),
    entry('2', 'Active', 10, 20),
    entry('3', 'Away', 30, 35),
  ].map((e) => ({ ...e, kind: 'presence' as const }))
  const summary = summarize(events, [start + 5 * minute, start + 32 * minute])
  assert.equal(summary.active, 15 * minute)
  assert.equal(summary.away, 2 * minute)
})
test('spring and fall clock changes land in the corresponding local quarter hours', () => {
  const tz = process.env.TZ
  try {
    process.env.TZ = 'America/New_York'
    for (const [day, mondayOfWeek, hours] of [
      ['2026-03-08', '2026-03-02', 23],
      ['2026-11-01', '2026-10-26', 25],
    ] as const) {
      const [a, b] = bounds(day)
      assert.equal((b - a) / 3600000, hours)
      const e = { ...entry('time', 'A', 0, 1), start: a, end: b }
      const result = aggregateWeek(
        { entries: [e], lanes: [lane], fetched: 1 },
        mondayOfWeek,
      )
      assert.equal(
        result.rows[6].lanes.window.filter(Boolean).length,
        hours === 23 ? 92 : 96,
      )
      assert.equal(result.totals.apps[0][1], hours * 3600000)
    }
  } finally {
    if (tz) process.env.TZ = tz
    else delete process.env.TZ
  }
})
