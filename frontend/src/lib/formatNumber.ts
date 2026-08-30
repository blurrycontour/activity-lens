export function formatMeasuredNumber(value: number, maximumFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits })
}
