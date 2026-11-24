import type { Day } from './model'
export function readSetting<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem('awitch.' + key) ?? 'null') ?? fallback
    )
  } catch {
    return fallback
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem('awitch.' + key, JSON.stringify(value))
  } catch {
    /* Private browsing may disable persistence. */
  }
}
const recent = new Map<string, Day>()
export function cached(key: string) {
  return recent.get(key)
}
export function remember(key: string, day: Day) {
  recent.delete(key)
  recent.set(key, day)
  if (recent.size > 8) recent.delete(recent.keys().next().value!)
}
