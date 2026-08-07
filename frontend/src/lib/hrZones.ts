/**
 * The five-zone heart-rate model, shared by the charts and the map.
 *
 * Zones are percentages of the user's maximum heart rate — the conventional
 * 60/70/80/90 split — and everything here derives from that one rule, so the
 * donut, the histogram, the shaded track and the gradient under the HR line
 * cannot drift apart.
 */

/**
 * The zone palette. Literal colours, every one of them, and that is a
 * requirement rather than a style choice.
 *
 * These are handed to MapLibre as a `line-color` paint value when the track is
 * shaded by heart rate, and MapLibre parses colours itself — it has no DOM to
 * resolve a CSS custom property against. Zone 4 was `var(--danger)`, which the
 * charts and the SVG fallback resolved happily while the map silently drew that
 * zone black. See the test in hrZones.test.ts.
 *
 * Fixed across light and dark, like the other four: a zone is a fact about the
 * effort, not an outcome the theme should restate. `#ef4444` is the dark-theme
 * `--danger` it used to borrow.
 */
export const HR_ZONE_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#ef4444', '#a855f7']
export const HR_ZONE_LABELS = ['Zone 1 (<60%)', 'Zone 2 (60-70%)', 'Zone 3 (70-80%)', 'Zone 4 (80-90%)', 'Zone 5 (90-100%)']
export const HR_ZONE_SHORT = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']

/** Maps a heart rate (bpm) to its zone colour, given the user's max HR. */
export function hrZoneColor(hr: number, maxHR: number): string {
  if (maxHR <= 0) return HR_ZONE_COLORS[0]
  const pct = (hr / maxHR) * 100
  const idx = pct < 60 ? 0 : pct < 70 ? 1 : pct < 80 ? 2 : pct < 90 ? 3 : 4
  return HR_ZONE_COLORS[idx]
}

/** Builds vertical gradient stops (top→bottom) that colour an HR line by zone,
 * mapping bpm values within [yMin, yMax] to the 5-zone palette. */
export function hrZoneStops(yMin: number, yMax: number, maxHR: number): { offset: number; color: string }[] | null {
  if (maxHR <= 0 || yMax <= yMin) return null
  const offAt = (v: number) => Math.min(1, Math.max(0, (yMax - v) / (yMax - yMin)))
  const stops: { offset: number; color: string }[] = [{ offset: 0, color: hrZoneColor(yMax, maxHR) }]
  for (const f of [0.9, 0.8, 0.7, 0.6]) {
    const b = f * maxHR
    if (b > yMin && b < yMax) {
      const off = offAt(b)
      stops.push({ offset: off, color: hrZoneColor(b + 0.01, maxHR) })
      stops.push({ offset: off, color: hrZoneColor(b - 0.01, maxHR) })
    }
  }
  stops.push({ offset: 1, color: hrZoneColor(yMin, maxHR) })
  return stops
}

export function hrZoneBuckets(hrTimeline: { t: number; hr: number }[], maxHR: number, totalForPct?: number) {
  if (hrTimeline.length === 0 || maxHR <= 0) return []
  const counts = [0, 0, 0, 0, 0]
  for (let i = 0; i < hrTimeline.length; i++) {
    const pct = (hrTimeline[i].hr / maxHR) * 100
    const idx = pct < 60 ? 0 : pct < 70 ? 1 : pct < 80 ? 2 : pct < 90 ? 3 : 4
    counts[idx]++
  }
  const counted = counts.reduce((a, b) => a + b, 0)
  // Denominator is the whole activity when one is given, so a partially played
  // chart shows its share of the total rather than of what has played.
  const total = totalForPct ?? counted
  if (total === 0) return []
  // Every zone is returned, including empty ones: the histogram wants the gaps
  // to be visible. The donut filters them out at render time instead.
  return counts.map((c, i) => ({
    name: HR_ZONE_LABELS[i], short: HR_ZONE_SHORT[i],
    value: c, pct: Math.round((c / total) * 100), color: HR_ZONE_COLORS[i],
  }))
}

/**
 * Zone counts up to any point in time, in constant time.
 *
 * Playback asks "how much of each zone has been played" on every frame, and
 * answering it by filtering the samples and recounting is two passes over the
 * whole activity each time. The shape of the question does not change though —
 * only the cut point moves, forwards — so the counts are accumulated once and
 * every later answer is a lookup.
 *
 * Returns a function rather than the table itself, so the caller cannot get the
 * binary search subtly wrong in three places.
 */
export function hrZoneCounter(hrTimeline: { t: number; hr: number }[], maxHR: number) {
  const total = hrTimeline.length
  // prefix[z][i] is how many samples of zone z fall in the first i samples.
  const prefix = [0, 1, 2, 3, 4].map(() => new Int32Array(total + 1))
  for (let i = 0; i < total; i++) {
    const pct = maxHR > 0 ? (hrTimeline[i].hr / maxHR) * 100 : 0
    const zone = pct < 60 ? 0 : pct < 70 ? 1 : pct < 80 ? 2 : pct < 90 ? 3 : 4
    for (let z = 0; z < 5; z++) prefix[z][i + 1] = prefix[z][i] + (z === zone ? 1 : 0)
  }

  return (t: number) => {
    if (total === 0 || maxHR <= 0) return []
    // Samples are in time order, so the cut point is a binary search.
    let lo = 0
    let hi = total
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (hrTimeline[mid].t <= t) lo = mid + 1
      else hi = mid
    }
    // Denominator is the whole activity, so the bars grow rather than
    // rearranging themselves as early samples swing the shares about.
    return [0, 1, 2, 3, 4].map(z => ({
      name: HR_ZONE_LABELS[z], short: HR_ZONE_SHORT[z],
      value: prefix[z][lo], pct: Math.round((prefix[z][lo] / total) * 100), color: HR_ZONE_COLORS[z],
    }))
  }
}
