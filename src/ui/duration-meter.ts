const stops = [0, 10000, 60000, 600000, 3600000, 86400000]
/** Equal-width bands preserve detail for both brief switches and long sessions. */
export function durationPercent(ms: number) {
  if (ms <= 0) return 0
  for (let i = 1; i < stops.length; i++) {
    if (ms <= stops[i])
      return 20 * (i - 1 + (ms - stops[i - 1]) / (stops[i] - stops[i - 1]))
  }
  return 100
}
export function durationMeter(ms: number) {
  return (
    '<span aria-hidden="true" class="duration-meter' +
    (ms === 0 ? ' moment' : '') +
    '"><i style="width:' +
    durationPercent(ms).toFixed(3) +
    '%"></i></span>'
  )
}
export const durationKey =
  '<div class="duration-key" title="Each tick marks the next duration threshold. A hollow dot represents a zero-duration visit."><span>Visit length</span><div><b>10s</b><b>1m</b><b>10m</b><b>1h</b><b>24h</b></div></div>'
