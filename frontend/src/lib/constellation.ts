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
export const FIELD_H = 200

/** How the trajectory leaves and arrives, picked per workout from its id. */
export const VARIANTS = ['ascent', 'swing', 'loop', 'orbit'] as const
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
 * The control points for each variant, as fractions of the field.
 *
 * The two anchors are fixed — every journey starts at the lower left and ends
 * at the upper right — because that reading direction is the one thing that
 * must not vary: it is what makes the drawing legible as "start" and "finish"
 * without a label. Only the middle changes.
 */
const SHAPES: Record<Variant, [number, number, number, number]> = {
  // A steady climb, bowing gently upward.
  ascent: [0.24, 0.42, 0.62, 0.26],
  // Dips before it climbs, so the middle of the session sits low.
  swing: [0.30, 0.96, 0.58, 0.44],
  // Control points cross, which folds the path back over itself.
  loop: [0.86, 0.74, 0.16, 0.30],
  // Overshoots to the right, then sweeps back up and in.
  orbit: [1.02, 0.30, 0.40, 0.04],
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
 */
export function buildConstellation(seed: string, samples: number[], count = 110): Constellation {
  const h = hash(seed)
  const random = rng(h)
  const variant = VARIANTS[h % VARIANTS.length]
  const [c1x, c1y, c2x, c2y] = SHAPES[variant]

  // Launch and destination, inset so the glyphs at either end are not clipped.
  // The destination is short of the top-right corner rather than in it: the
  // maximise button sits there, and a finish glyph underneath a button is a
  // finish nobody can see. It still reads as "far away and up and to the
  // right", which is the only thing the position has to say.
  const x0 = FIELD_W * 0.10, y0 = FIELD_H * 0.86
  const x1 = FIELD_W * 0.86, y1 = FIELD_H * 0.27

  // A per-workout nudge to the middle of the curve, so two workouts sharing a
  // variant still differ. Small enough that the variant still reads.
  const jitterX = (random() - 0.5) * FIELD_W * 0.10
  const jitterY = (random() - 0.5) * FIELD_H * 0.14

  const p1x = FIELD_W * c1x + jitterX, p1y = FIELD_H * c1y + jitterY
  const p2x = FIELD_W * c2x + jitterX, p2y = FIELD_H * c2y + jitterY

  // How hard the effort pushes the path off its curve. Perpendicular to the
  // direction of travel, so a spike reads as a swerve rather than as height —
  // height is already spoken for by the recession into the distance.
  const swerve = FIELD_H * 0.17

  const points: PathPoint[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const bx = bezier(x0, p1x, p2x, x1, t)
    const by = bezier(y0, p1y, p2y, y1, t)

    // The tangent, from a short step along the curve, to get a normal.
    const e = Math.min(t + 0.004, 1)
    const nx = bezier(y0, p1y, p2y, y1, e) - by
    const ny = -(bezier(x0, p1x, p2x, x1, e) - bx)
    const len = Math.hypot(nx, ny) || 1

    // Centred on the middle of the range so an average stretch sits on the
    // curve and only the extremes leave it.
    const value = sampleAt(samples, t)
    const push = (value - 0.5) * 2 * swerve

    // Clamped into the field. A hard spike near the top of an already-rising
    // curve pushes the path off the viewBox, where it is simply clipped — and a
    // trajectory that vanishes at the edge and reappears reads as a rendering
    // fault rather than as a hard interval. Grazing the edge instead is honest
    // enough: the swerve is qualitative, and nothing here is read off an axis.
    points.push({
      x: clamp(bx + (nx / len) * push, MARGIN, FIELD_W - MARGIN),
      y: clamp(by + (ny / len) * push, MARGIN, FIELD_H - MARGIN),
      depth: t,
      t,
    })
  }

  // The field of stars, thinner toward the lower left where the path launches
  // from and the ground haze sits.
  const stars: Star[] = []
  for (let i = 0; i < 46; i++) {
    const x = random() * FIELD_W
    const y = random() * FIELD_H
    const nearGround = y / FIELD_H
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
      y: FIELD_H * (0.10 + random() * 0.18),
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
