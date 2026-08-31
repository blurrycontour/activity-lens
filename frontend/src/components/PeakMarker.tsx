/**
 * The min/max markers on a series chart: a small triangle pointing away from
 * the line — up at the maximum, down at the minimum — in the line's own colour.
 *
 * Passed to Recharts' `ReferenceDot` as its `shape`, so Recharts positions it
 * by injecting `cx`/`cy` from the axis scales; the triangle is drawn offset
 * from that point so it sits beside the peak rather than hiding it. A thin
 * surface-coloured outline keeps it legible where it overlaps the fill.
 */
export function PeakGlyph({ cx, cy, dir, color }: { cx?: number; cy?: number; dir: 'up' | 'down'; color: string }) {
  if (cx == null || cy == null) return null
  const half = 5
  const height = 8
  const gap = 3
  const points = dir === 'up'
    ? `${cx},${cy - gap - height} ${cx - half},${cy - gap} ${cx + half},${cy - gap}`
    : `${cx},${cy + gap + height} ${cx - half},${cy + gap} ${cx + half},${cy + gap}`
  return <polygon points={points} fill={color} stroke="var(--bg-2)" strokeWidth={1} strokeLinejoin="round" />
}
