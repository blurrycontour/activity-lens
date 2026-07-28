/**
 * Axis tick that anchors its text inward at the two ends of the axis, so the
 * first and last labels can't be clipped by the edge of the plot area. Recharts
 * centres every tick by default, which pushes half of the final label outside
 * the chart. Pass as `<XAxis tick={<EdgeTick />} />`.
 */
export function EdgeTick(props: {
  x?: number
  y?: number
  index?: number
  visibleTicksCount?: number
  fontSize?: number
  payload?: { value: string | number }
}) {
  const { x = 0, y = 0, index = 0, visibleTicksCount = 1, fontSize = 10, payload } = props
  const anchor = index === 0 ? 'start' : index >= visibleTicksCount - 1 ? 'end' : 'middle'
  return (
    <text
      x={x} y={y} dy={10} textAnchor={anchor}
      fill="var(--text-3)" fontSize={fontSize} fontFamily="var(--font-mono)"
    >
      {payload?.value}
    </text>
  )
}
