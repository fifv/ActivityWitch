import { dateKey, type Day } from './model'
import type { WeekSummary } from './weekly'
interface RecordValue {
  key: string
  date: string
  written: number
  data: Day
}
let database: Promise<IDBDatabase | null> | undefined
function open() {
  return (database ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open('activitywitch-days-v1', 2)
      request.onupgradeneeded = () => {
        for (const name of ['days', 'weeks'])
          if (!request.result.objectStoreNames.contains(name)) {
            const store = request.result.createObjectStore(name, {
              keyPath: 'key',
            })
            store.createIndex('written', 'written')
          }
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          database = undefined
        }
        resolve(request.result)
      }
      request.onerror = request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  }))
}
export async function getDays(prefix: string, dates: string[]) {
  const db = await open()
  if (!db) return dates.map(() => undefined)
  const store = db.transaction('days').objectStore('days')
  return Promise.all(
    dates.map(
      (date) =>
        new Promise<Day | undefined>((resolve) => {
          const req = store.get(prefix + date)
          req.onsuccess = () => {
            const r = req.result as RecordValue | undefined
            const ttl = date === dateKey() ? 30000 : 86400000
            // A record written during that day may lack its last few minutes after midnight.
            resolve(
              r &&
                Date.now() - r.written < ttl &&
                (date === dateKey() || dateKey(new Date(r.written)) > date)
                ? r.data
                : undefined,
            )
          }
          req.onerror = () => resolve(undefined)
        }),
    ),
  )
}
export async function putDays(prefix: string, days: Map<string, Day>) {
  return writeBounded(
    'days',
    21,
    [...days].map(([date, data]) => ({
      key: prefix + date,
      date,
      data,
      written: Date.now(),
    })),
  )
}
export async function getOverview(
  key: string,
): Promise<WeekSummary | undefined> {
  const db = await open()
  if (!db) return
  return new Promise((resolve) => {
    const request = db.transaction('weeks').objectStore('weeks').get(key)
    request.onsuccess = () => resolve(request.result?.data)
    request.onerror = () => resolve(undefined)
  })
}
export async function putOverview(key: string, data: WeekSummary) {
  return writeBounded('weeks', 6, [{ key, data, written: Date.now() }])
}
async function writeBounded(
  name: string,
  limit: number,
  records: { key: string; data: Day | WeekSummary; written: number }[],
) {
  const db = await open()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(name, 'readwrite'),
      store = tx.objectStore(name)
    tx.oncomplete = tx.onabort = tx.onerror = () => resolve()
    for (const record of records) store.put(record)
    const count = store.count()
    count.onsuccess = () => {
      let excess = count.result - limit
      if (excess <= 0) return
      const cursor = store.index('written').openCursor()
      cursor.onsuccess = () => {
        const c = cursor.result
        if (c && excess-- > 0) {
          c.delete()
          c.continue()
        }
      }
    }
  })
}
