// Series colours for charts.
//
// The app's accent is user-selectable across six hues, so any fixed categorical
// palette risks colliding with whatever the user picked. Two rules keep charts
// legible under every accent:
//
//  1. Ordered series (years, recency buckets) use a SEQUENTIAL ramp derived from
//     the accent itself — one hue, strong to faint — so it can never clash with
//     the accent, and the order carries the meaning.
//  2. Unordered series use SERIES_COLORS, fixed hues that are part of the design
//     tokens and never repainted when the series count changes.

/** Reads a CSS custom property off the root element, with a fallback. */
function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

/** Blends two hex colours in sRGB; `t` is the weight of `a`. */
function blend(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  const c = (x: number, y: number) => Math.round(x * t + y * (1 - t))
  return `rgb(${c(ar, br)}, ${c(ag, bg)}, ${c(ab, bb)})`
}

/**
 * Sequential accent ramp for `n` ordered series, strongest first. Steps blend
 * the accent toward an ink token rather than toward transparency, so the faint
 * end stays visible on both the light and dark surfaces — and because the whole
 * ramp is one hue, it can never clash with whichever accent is set.
 *
 * Which ink, and why it matters, is the comment inside.
 *
 * Colours are resolved to concrete rgb() here rather than emitted as
 * `color-mix(var(--primary) …)`: these values end up on SVG `fill`/`stroke`
 * attributes, and resolving them keeps the output independent of how well a
 * given browser handles CSS colour functions there.
 */
export function recencyRamp(n: number): string[] {
  return rampFrom(
    readVar('--primary', '#00e87a'),
    [readVar('--text', '#e8eaed'), readVar('--text-2', '#9ca3af'), readVar('--text-3', '#6b7280')],
    n,
  )
}

/**
 * The ramp itself, given the colours rather than reading them off the document.
 *
 * Split out so it can be tested: whether adjacent steps are actually
 * distinguishable is the whole point of this function and the one thing that
 * fails silently, and asserting it should not need a DOM to set tokens in.
 *
 * @param inks the theme's ink tokens, in any order.
 */
export function rampFrom(accent: string, inks: string[], n: number): string[] {
  if (n <= 1) return [accent]
  /*
   * The far end of the ramp is whichever of the theme's three ink tokens sits
   * furthest from the accent in lightness.
   *
   * That choice is what makes this a sequential ramp rather than a set of
   * near-identical bars, and it is why the endpoint is chosen rather than
   * fixed. Fading toward a grey that happens to be as light as the accent
   * drains the chroma and leaves the lightness alone — and lightness is what
   * the eye separates first. Three weeks of the old ramp came out as #00e87a,
   * #1cc97c, #32b17d, which is the "very hard to read" this replaces.
   *
   * Picking by distance also settles it per theme and per accent without a
   * table: the dark theme's inks run light and the light theme's run dark, and
   * the six accents sit at very different lightnesses among them. A blue on
   * dark ends at near-white; a green on dark, already bright, ends at the
   * muted grey instead.
   */
  const far = inks.reduce((best, ink) =>
    Math.abs(lightness(ink) - lightness(accent)) > Math.abs(lightness(best) - lightness(accent)) ? ink : best)

  // Evenly spaced, and the last step is that ink exactly. The earlier version
  // approached it asymptotically, which spent most of the range on the first
  // step and crushed the tail together — so the more series there were the
  // worse the crowding, which is backwards.
  return Array.from({ length: n }, (_, i) => blend(accent, far, 1 - i / (n - 1)))
}

/** Rec. 709 relative lightness, 0–255. Only ever used to compare two colours. */
function lightness(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Fixed hues for unordered multi-series charts, assigned in order and never
 * cycled. These are design tokens, so they stay put when the accent changes.
 */
export const SERIES_COLORS = ['var(--blue)', 'var(--purple)', 'var(--hike)', 'var(--swim)', 'var(--strength)']

/** Neutral fill for tooltip/hover cursors that respects the active theme. */
export const HOVER_FILL = 'var(--bg-3)'

/** Shared axis tick styling — recessive, monospaced, theme-aware. */
export const AXIS_TICK = { fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' } as const

/** Shared grid styling. */
export const GRID_PROPS = { strokeDasharray: '2 4', stroke: 'var(--border)', vertical: false } as const

/**
 * A line the app calculated rather than measured — a moving average, a bucket
 * mean, a fitted slope.
 *
 * Dashed, so the difference is visible without reading a legend. Every chart
 * that draws one of these draws it over the data it came from, and solid-on-
 * solid leaves nothing to say which is the evidence and which is the reading of
 * it. The weather fit already did this by hand; the moving averages did not,
 * and were also the heavier of the two strokes, so on the Trends tab the line
 * the app invented was the most prominent thing on the chart while the workouts
 * it was derived from sat behind it at 40% opacity.
 *
 * Spread onto a Recharts `<Line>`, after the stroke colour and before any dot
 * configuration the caller wants to keep.
 */
export const TREND_LINE = { strokeDasharray: '5 4', strokeWidth: 2, dot: false } as const

/**
 * The measured series underneath a TREND_LINE.
 *
 * Slightly transparent so the trend stays legible on top of it, but no thinner:
 * the data is not the secondary thing on the chart.
 */
export const DATA_LINE = { strokeWidth: 2, opacity: 0.55 } as const
