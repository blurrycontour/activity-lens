/**
 * A placeholder for a value that has not arrived yet.
 *
 * The point is not the shimmer, it is the size: a dialog that renders its rows
 * only once the fetch lands grows under the reader's cursor, and one opened
 * over a slow connection is a small empty box that becomes a large full one.
 * Standing in for the value at roughly its width keeps the dialog the shape it
 * will end up.
 *
 * `.skeleton` carries the sweep, and stops it under prefers-reduced-motion.
 */
export default function Skeleton({ width, height = '1em', radius = 4 }: {
  /** Roughly what the real value measures. A number is px. */
  width: number | string
  height?: number | string
  radius?: number
}) {
  return (
    <span
      className="skeleton"
      aria-hidden
      style={{ display: 'inline-block', width, height, borderRadius: radius, verticalAlign: 'middle' }}
    />
  )
}
