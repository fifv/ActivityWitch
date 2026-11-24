/** Resolve a clock instant to the most recently started visit that covers it. */
export class VisitIndex {
  private readonly leaves: number
  private readonly last: Float64Array
  private readonly starts: Float64Array
  constructor(starts: Float64Array, ends: Float64Array) {
    this.starts = starts
    this.leaves = 2 ** Math.ceil(Math.log2(Math.max(1, starts.length)))
    this.last = new Float64Array(this.leaves * 2).fill(-Infinity)
    for (let i = 0; i < starts.length; i++) {
      // Intervals are half-open. Point events are observable at their timestamp.
      this.last[this.leaves + i] =
        starts[i] === ends[i] ? starts[i] : Math.ceil(ends[i]) - 1
    }
    for (let i = this.leaves - 1; i > 0; i--)
      this.last[i] = Math.max(this.last[i * 2], this.last[i * 2 + 1])
  }
  at(time: number): number {
    if (!Number.isFinite(time)) return -1
    const find = (node: number, first: number, size: number): number => {
      if (
        first >= this.starts.length ||
        this.starts[first] > time ||
        this.last[node] < time
      )
        return -1
      if (size === 1) return first
      const half = size / 2
      const right = find(node * 2 + 1, first + half, half)
      return right >= 0 ? right : find(node * 2, first, half)
    }
    return find(1, 0, this.leaves)
  }
}

export function lowerBound(values: ArrayLike<number>, target: number) {
  let lo = 0,
    hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}
