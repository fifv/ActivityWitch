import type { Bucket, Day, Entry } from './model'
import type { WeekSummary } from './weekly'
export type Request =
  | {
      type: 'load'
      host: string
      date: string
      buckets: Bucket[]
      weekly: boolean
      refresh: boolean
    }
  | {
      type: 'filter'
      search: string
      source: string
      app: string
      context: number
    }
  | { type: 'page'; start: number; end: number; filter: number }
  | { type: 'cancel' }
export interface Loaded {
  day?: Day
  week?: WeekSummary
  context: number
}
let worker: Worker | undefined,
  sequence = 0
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    preview?: (summary: WeekSummary) => void
  }
>()
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id)
      if (!task) return
      if (data.preview) {
        task.preview?.(data.preview)
        return
      }
      pending.delete(data.id)
      if (data.error) task.reject(new Error(data.error))
      else task.resolve(data.result)
    }
    worker.onerror = (e) => {
      for (const task of pending.values()) task.reject(new Error(e.message))
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  return worker
}
function request<T>(msg: Request, preview?: (summary: WeekSummary) => void) {
  const w = getWorker(),
    id = ++sequence
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject, preview })
    w.postMessage({ id, msg })
  })
}
export const loadPeriod = (
  msg: Extract<Request, { type: 'load' }>,
  preview?: (summary: WeekSummary) => void,
) => request<Loaded>(msg, preview)
export const filterWeek = (
  context: number,
  search: string,
  source: string,
  app: string,
) =>
  request<{ count: number; filter: number }>({
    type: 'filter',
    context,
    search,
    source,
    app,
  })
export const pageWeek = (filter: number, start: number, end: number) =>
  request<Entry[]>({ type: 'page', filter, start, end })
export const cancelReads = () => {
  if (worker) worker.postMessage({ id: 0, msg: { type: 'cancel' } })
}
