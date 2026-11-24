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

const monday = '2026-11-16'
const [start] = bounds(monday)
const minute = 60000
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
