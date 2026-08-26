/**
 * Radius of the invisible circle that catches the tap, in px.
 *
 * A scatter point is drawn at 4–9px because that is the size at which a
 * scatter is readable. It is not a size anything can be *hit* at: a fingertip
 * is around 44px across, so tapping a 9px dot to read its tooltip was a matter
 * of luck, and every miss looked like the tooltip was broken rather than
 * missed. 18 gives a 36px target without touching what is drawn.
 */
const HIT_RADIUS = 18

/** Fallback radius when there is no ZAxis sizing the point. */
const DEFAULT_RADIUS = 4.5

interface ScatterDotProps {
  cx?: number
  cy?: number
  /** Symbol *area* in px², which is what a ZAxis range is expressed in. */
  size?: number
  fill?: string
  opacity?: number
}

/**
 * One point of a scatter, with a hit area a finger can actually land on.
 *
 * Recharts sizes and colours the default symbol perfectly well; the only thing
 * wrong with it is that the shape you can see and the shape you can touch are
 * the same shape. This draws the visible dot unchanged and puts a transparent
 * circle behind it to be tapped.
 *
 * Neighbouring hit circles overlap on a dense chart, and the one on top wins.
 * That is the right trade: the alternative is a point that cannot be selected
 * at all, and the tooltip names the workout, so a wrong neighbour is a visible
 * mistake rather than a silent one.
 */
export default function ScatterDot({ cx, cy, size, fill, opacity }: ScatterDotProps) {
  if (cx == null || cy == null) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={HIT_RADIUS} fill="transparent" />
      <circle cx={cx} cy={cy} r={radiusFor(size)} fill={fill} opacity={opacity} />
    </g>
  )
}

/** The drawn radius, from the symbol area a ZAxis expresses its range in. */
function radiusFor(size?: number): number {
  return size && size > 0 ? Math.sqrt(size / Math.PI) : DEFAULT_RADIUS
}

/**
 * The point the tooltip is currently about.
 *
 * Every line chart in the app marks its selected point — that is Recharts'
 * `activeDot`, and it is on by default. A scatter has no such default, so a tap
 * raised a card describing "a workout" with nothing on the plot saying which of
 * forty dots it meant. On a phone, where the finger is over the chart and the
 * card is beside it, that is most of the answer missing.
 *
 * A ring around the dot rather than a larger dot: growing the symbol moves its
 * own edge, and on a crowded chart a point that changes size reads as a point
 * that moved. The ring takes the point's colour, so the mark says *which* point
 * and the tooltip says what it is.
 *
 * Deliberately inert to the pointer. It is drawn over the same place as the
 * hit circle underneath, and a shape that swallowed the pointer would end the
 * hover it exists to describe.
 */
export function ActiveScatterDot({ cx, cy, size, fill }: ScatterDotProps) {
  if (cx == null || cy == null) return null
  const r = radiusFor(size)
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={r + 4.5} fill="none" stroke={fill} strokeWidth={1.5} opacity={0.5} />
      <circle cx={cx} cy={cy} r={r} fill={fill} />
    </g>
  )
}
