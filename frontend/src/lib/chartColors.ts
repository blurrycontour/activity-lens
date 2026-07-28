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
 * the accent toward the muted text colour rather than toward transparency, so
 * the faint end stays visible on both the light and dark surfaces — and because
 * the whole ramp is one hue, it can never clash with whichever accent is set.
 *
 * Colours are resolved to concrete rgb() here rather than emitted as
 * `color-mix(var(--primary) …)`: these values end up on SVG `fill`/`stroke`
 * attributes, and resolving them keeps the output independent of how well a
 * given browser handles CSS colour functions there.
 */
export function recencyRamp(n: number): string[] {
  const accent = readVar('--primary', '#00e87a')
  const neutral = readVar('--text-3', '#6b7280')
  if (n <= 1) return [accent]
  // Hand-picked stops rather than a linear sweep: the drop from full accent has
  // to be large enough to read as a different bar at a glance.
  const weights = [1, 0.74, 0.53, 0.36, 0.23, 0.14]
  return Array.from({ length: n }, (_, i) => {
    const w = weights[Math.min(i, weights.length - 1)]
    return w >= 1 ? accent : blend(accent, neutral, w)
  })
}

/**
 * Fixed hues for unordered multi-series charts, assigned in order and never
 * cycled. These are design tokens, so they stay put when the accent changes.
 */
export const SERIES_COLORS = ['var(--blue)', 'var(--purple)', 'var(--hike)', 'var(--swim)', '#ec4899']

/** Neutral fill for tooltip/hover cursors that respects the active theme. */
export const HOVER_FILL = 'var(--bg-3)'

/** Shared axis tick styling — recessive, monospaced, theme-aware. */
export const AXIS_TICK = { fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' } as const

/** Shared grid styling. */
export const GRID_PROPS = { strokeDasharray: '2 4', stroke: 'var(--border)', vertical: false } as const
