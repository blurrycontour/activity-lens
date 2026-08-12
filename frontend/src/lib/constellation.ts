/**
 * A workout with no route, drawn as a journey through space.
 *
 * The effort band this replaces was honest and dull: a horizontal strip of zone
 * colour, which is the same information the heart-rate chart and the zone donut
 * already carry, laid out the same way. A treadmill run deserves better than a
 * third view of one number.
 *
 * So the session becomes a flight path — launching from the lower left,
 * receding into the distance toward the upper right, bending with the effort as
 * it goes. It is not a chart and does not pretend to be one: nothing here can
 * be read off an axis. What it does carry truthfully is the *shape* of the
 * session — where the hard parts were, how many, how long the quiet stretch in
 * the middle ran — and it carries the same colour scale the map's track does,
 * so the vocabulary is one the app already taught.
 *
 * Everything is deterministic in the workout's id. Two people looking at the
 * same workout see the same sky, and one workout's path never changes under it,
 * but no two workouts look alike.
 */

/** The coordinate space the path is built in. Rendered at any size. */
export const FIELD_W = 400
/* Close to the panel's own proportions, so the drawing very nearly fills it
   rather than sitting in a letterbox of sky. */
export const FIELD_H = 250

/** How the trajectory leaves and arrives, picked per workout from its id. */
export const VARIANTS = ['ascent', 'late', 'early', 'step'] as const
export type Variant = (typeof VARIANTS)[number]

export interface PathPoint {
  x: number
  y: number
  /** 0 at the launch, 1 at the destination. Drives width and opacity. */
  depth: number
  /** Fraction of the workout, for looking the colour up. */
  t: number
}

export interface Star {
  x: number
  y: number
  r: number
  /** Opacity, 0–1. */
  o: number
}

export interface Constellation {
  variant: Variant
  points: PathPoint[]
  stars: Star[]
  /** A distant body, or null. Present on roughly half of workouts. */
  planet: { x: number; y: number; r: number; ringed: boolean } | null
}

/** FNV-1a, so the seed depends on every character of the id. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, and good enough for scattering stars. */
function rng(state: number): () => number {
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Room kept around the path, so the widest launch stroke is not clipped. */
const MARGIN = 8

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function bezier(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

/**
 * The control points for each variant.
 *
 * `[c1x, c1v, c2x, c2v]`, where x is a fraction of the way from the launch to
 * the destination and v is a height within the band the curve is allowed to
 * occupy — 0 at the bottom of it, 1 at the top.
 *
 * Two properties hold for every variant, and both are load-bearing:
 *
 * **x only ever increases.** Both control x's lie between the anchors and in
 * order, which for a cubic is enough to make the curve monotonic in x. The old
 * `loop` crossed its control points and `orbit` overshot the right edge, so the
 * path doubled back over itself: the same column of the drawing carried two
 * different moments of the session, and the stretch running right-to-left read
 * as a knot rather than as travel. Nothing that folds can resemble the chart
 * beside it, whatever the metric does.
 *
 * **v stays within 0–1**, so the curve stays inside its band and the swerve
 * always has its full room either side. That is what removed the flat plateaus
 * where a hard interval used to press against the edge of the field.
 *
 * The two anchors are fixed — every journey starts at the lower left and ends
 * at the upper right — because that reading direction is the one thing that
 * must not vary: it is what makes the drawing legible as "start" and "finish"
 * without a label. Only the middle changes.
 */
const SHAPES: Record<Variant, [number, number, number, number]> = {
  // A steady climb, bowing gently.
  ascent: [0.30, 0.30, 0.68, 0.62],
  // Holds low and lifts at the end, so the distance is covered late.
  late: [0.38, 0.04, 0.60, 0.42],
  // Climbs away early and then flattens out into the distance.
  early: [0.20, 0.66, 0.58, 1.0],
  // Rises through the middle: low, a lift, then level again.
  step: [0.46, 0.06, 0.54, 0.94],
}

/**
 * Builds one workout's path and sky.
 *
 * @param seed    the workout's id: same workout, same drawing, forever.
 * @param samples the metric to bend the path with, normalised to 0–1 and
 *                sampled evenly across the workout. Empty leaves the path
 *                unmodulated, which is the right answer for a workout that
 *                recorded nothing but a duration — a straight arc is honest.
 * @param count   points along the path. The default is smooth at any size the
 *                card reaches and cheap enough to build on every render.
 * @param fieldH  the height of the coordinate space, so the drawing can be
 *                built to the shape of the panel it will be shown in rather
 *                than sitting in a letterbox inside it. Every position here is
 *                a fraction of the field, so this simply re-proportions the
 *                whole picture — see the note on the viewBox in SessionProfile.
 */
export function buildConstellation(seed: string, samples: number[], count = 110, fieldH = FIELD_H): Constellation {
  const h = hash(seed)
  const random = rng(h)
  const variant = VARIANTS[h % VARIANTS.length]
  const [c1x, c1y, c2x, c2y] = SHAPES[variant]

  /*
   * The band the whole drawing lives in, and the room reserved inside it for
   * the effort to move the line.
   *
   * Working these out up front is what lets the swerve be applied without
   * clamping: the curve is confined to `[lo, hi]`, and there is exactly
   * `swerve` of clear field above and below that, so no reading — however
   * extreme — can reach the edge. Clamping was the old approach and it flatted
   * a hard interval into a plateau pressed against the top of the panel, which
   * looked like a rendering fault rather than like a hard interval.
   *
   * Everything scales with the field's height, including the margin: the panel
   * is anywhere from about 60 units tall on a wide desktop card to 900 in the
   * expanded view on a phone, and a fixed 8 is a comfortable inset at one end
   * and a sixth of the drawing at the other.
   */
  const marginY = Math.min(MARGIN, fieldH * 0.08)
  const swerve = Math.min(fieldH * 0.22, (fieldH - 2 * marginY) * 0.3)
  const hi = fieldH - marginY - swerve
  const lo = marginY + swerve
  const span = hi - lo

  // Launch and destination, inset so the glyphs at either end are not clipped.
  // The destination is short of the top-right corner rather than in it: the
  // maximise button sits there, and a finish glyph underneath a button is a
  // finish nobody can see. It still reads as "far away and up and to the
  // right", which is the only thing the position has to say.
  const x0 = FIELD_W * 0.10, x1 = FIELD_W * 0.86
  const height = (v: number) => hi - clamp(v, 0, 1) * span

  // A per-workout nudge to the middle of the curve, so two workouts sharing a
  // variant still differ. Small enough that the variant still reads, and
  // applied equally to both control points so their order — and with it the
  // monotonic x that keeps the path from folding — survives it.
  const jitterX = (random() - 0.5) * 0.10
  const jitterV = (random() - 0.5) * 0.16

  const at = (f: number) => x0 + (x1 - x0) * clamp(f + jitterX, 0.05, 0.95)
  const p1x = at(c1x), p1y = height(c1y + jitterV)
  const p2x = at(c2x), p2y = height(c2y + jitterV)
  const y0 = height(0), y1 = height(0.82)

  const points: PathPoint[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)

    /*
     * The effort moves the line straight up and down, and nothing else does.
     *
     * It used to be pushed along the curve's own normal, which sounds more
     * elegant and was the source of most of what was wrong with this drawing.
     * A normal rotates with the path, so on a steep stretch the push went
     * sideways instead of up — displacing the line by as much as half the width
     * of the field, out of time with itself, which is what the crazy bends
     * were. It also had to be re-derived at every point from a finite step
     * along the curve, and that step is what put a kick at the finish line.
     *
     * Vertical is both simpler and more honest: it is the axis the heart-rate
     * chart uses, so a session that ramps up reads as a line that rises, and
     * the curve underneath is left to do the one job it is good at, which is
     * making the whole thing look like travel into the distance. Centred on
     * the middle of the range, so an average stretch sits on the curve.
     */
    const value = sampleAt(samples, t)
    const y = bezier(y0, p1y, p2y, y1, t) - (value - 0.5) * 2 * swerve

    points.push({
      x: bezier(x0, p1x, p2x, x1, t),
      // Cannot bind by construction; kept as a cheap guard so a future change
      // to the band arithmetic cannot put the path off the viewBox unnoticed.
      y: clamp(y, 1, fieldH - 1),
      depth: t,
      t,
    })
  }

  // The field of stars, thinner toward the lower left where the path launches
  // from and the ground haze sits.
  const stars: Star[] = []
  for (let i = 0; i < 46; i++) {
    const x = random() * FIELD_W
    const y = random() * fieldH
    const nearGround = y / fieldH
    if (random() < nearGround * 0.55) continue
    stars.push({
      x,
      y,
      r: 0.5 + random() * 1.3,
      o: 0.18 + random() * 0.5,
    })
  }

  // Roughly half of workouts get a distant body, up in the empty quarter above
  // the launch where it cannot sit under the path.
  const planet = random() < 0.5
    ? {
      x: FIELD_W * (0.12 + random() * 0.22),
      y: fieldH * (0.10 + random() * 0.18),
      r: 9 + random() * 9,
      ringed: random() < 0.45,
    }
    : null

  return { variant, points, stars, planet }
}

/** Linear read of an evenly spaced series at a fraction of its length. */
function sampleAt(samples: number[], t: number): number {
  if (samples.length === 0) return 0.5
  if (samples.length === 1) return samples[0]
  const at = t * (samples.length - 1)
  const i = Math.min(Math.floor(at), samples.length - 2)
  const f = at - i
  return samples[i] * (1 - f) + samples[i + 1] * f
}

/**
 * Evenly spaced, normalised readings of a timeline, for bending the path with.
 *
 * Normalised against the workout's own range rather than an absolute scale:
 * the drawing is about the shape of this session, and a steady effort should
 * look steady whether it was steady at 120 bpm or at 165.
 */
export function normalise<T>(
  series: T[],
  duration: number,
  timeOf: (p: T) => number,
  valueOf: (p: T) => number,
  count = 110,
): number[] {
  if (series.length === 0 || duration <= 0) return []
  const values = series.map(valueOf)
  const min = Math.min(...values)
  const span = Math.max(Math.max(...values) - min, 1e-6)

  const out: number[] = []
  let cursor = 0
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * duration
    while (cursor < series.length - 1 && Math.abs(timeOf(series[cursor + 1]) - t) <= Math.abs(timeOf(series[cursor]) - t)) cursor++
    out.push((values[cursor] - min) / span)
  }
  return smooth(out)
}

/**
 * A moving average, because the raw signal makes the path scribble.
 *
 * Heart rate wanders a few beats either side from one second to the next, and
 * sampling it at 110 points turned every one of those into a kink. The drawing
 * is about the shape of the session — where the hard parts were and how long
 * they ran — and at that scale beat-to-beat noise is not shape, it is texture
 * on top of it.
 *
 * A window of nine, about eight per cent of the session: wide enough that a
 * minute of wobble flattens, narrow enough that a four-minute interval still
 * pushes the path out. The window shrinks at the ends rather than the series
 * being padded, so a workout that starts hard still starts hard — padding with
 * the first value would drag the opening toward the middle.
 */
export function smooth(values: number[], window = 9): number[] {
  // A series no longer than the window is left alone: averaging every point
  // against every other one does not smooth a shape, it erases it.
  if (values.length <= window || window < 3) return values
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const from = Math.max(0, i - half)
    const to = Math.min(values.length - 1, i + half)
    let sum = 0
    for (let j = from; j <= to; j++) sum += values[j]
    return sum / (to - from + 1)
  })
}

/**
 * The point at a fraction of the way along the path, interpolated.
 *
 * The playhead used to snap to the nearest of the 110 stored points, which at
 * a quarter of a second per step is visible stepping — next to the map's marker,
 * which moves continuously, it looked broken. Reading between them costs one
 * lerp and makes the two panels behave alike.
 */
export function pointAt(points: PathPoint[], at: number): PathPoint | null {
  if (points.length === 0) return null
  const pos = clamp(at, 0, 1) * (points.length - 1)
  const i = Math.min(Math.floor(pos), points.length - 2)
  if (i < 0) return points[0]
  const f = pos - i
  const a = points[i]
  const b = points[i + 1]
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    depth: a.depth + (b.depth - a.depth) * f,
    t: a.t + (b.t - a.t) * f,
  }
}
