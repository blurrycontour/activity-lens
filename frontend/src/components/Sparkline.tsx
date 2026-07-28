/**
 * Minimal inline trend line for stat cards — no axes, no labels, no tooltip.
 * Hand-rolled rather than a chart library: at this size the only job is to show
 * shape, and a full chart wrapper per card would cost far more than it returns.
 */
export default function Sparkline({ values, color = 'var(--primary)', width = 96, height = 24 }: {
  values: number[]
  color?: string
  width?: number
  height?: number
}) {
  if (values.length < 2 || values.every(v => v === 0)) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pad = 2
  const stepX = (width - pad * 2) / (values.length - 1)
  const yOf = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)

  const points = values.map((v, i) => `${pad + i * stepX},${yOf(v)}`)
  const line = `M${points.join(' L')}`
  const area = `${line} L${width - pad},${height} L${pad},${height} Z`
  const last = values[values.length - 1]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      <circle cx={pad + (values.length - 1) * stepX} cy={yOf(last)} r={2} fill={color} />
    </svg>
  )
}
