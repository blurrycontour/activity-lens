import { fmtDist, fmtDuration, fmtPace, TYPE_COLOR, type Workout } from '../data/workouts'

/**
 * Draws a workout as a shareable image.
 *
 * Canvas rather than rendering a DOM node to an image. The usual approach —
 * html2canvas and friends — reimplements CSS layout in JavaScript, gets it
 * subtly wrong for anything it has not been taught, and is a dependency this
 * project does not otherwise need. A card is a route, four numbers and a title;
 * drawing it directly is less code than configuring a library to draw it, and
 * it is the only version that is exactly the same on every device.
 *
 * The other reason is fonts. An SVG rasterised through an <img> cannot see the
 * page's webfonts and silently falls back to a system face; a canvas draws with
 * whatever the document has loaded, which is why `ready()` waits for them.
 */

/** Portrait, which is what messaging apps and stories show without cropping. */
export const CARD_W = 1080
export const CARD_H = 1350

/** How much of the card the route occupies, top-aligned. */
const MAP_H = 760
const PAD = 72

export interface CardTheme {
  bg: string
  panel: string
  text: string
  muted: string
  accent: string
  border: string
}

/**
 * The card follows the app: same accent, same light or dark.
 *
 * Read from the document rather than hardcoded, because the accent is one of
 * six and the theme is the user's — a card that always came out dark green
 * would not look like the app the sender is describing.
 */
export function themeFromDocument(el: HTMLElement = document.documentElement): CardTheme {
  const s = getComputedStyle(el)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--bg-2', '#14161a'),
    panel: v('--bg-3', '#1b1e24'),
    text: v('--text', '#f2f4f8'),
    muted: v('--text-3', '#8b93a1'),
    accent: v('--primary', '#00e87a'),
    border: v('--border', '#272b33'),
  }
}

/** The four figures on the card, in reading order. */
export function cardStats(w: Workout): { label: string; value: string }[] {
  return [
    { label: 'Distance', value: w.distance > 0 ? fmtDist(w.distance) : '—' },
    { label: 'Time', value: w.duration > 0 ? fmtDuration(w.duration) : '—' },
    // Pace is meaningless without distance, and "0:00 /km" reads as a number
    // rather than as an absence.
    { label: 'Avg Pace', value: w.avgPace > 0 ? `${fmtPace(w.avgPace)} /km` : '—' },
    { label: 'Avg HR', value: w.avgHR > 0 ? `${w.avgHR} bpm` : '—' },
  ]
}

/** "Saturday, 12 July 2025", or the raw value if it will not parse. */
export function cardDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Fits a route to a box, preserving its shape.
 *
 * Longitude degrees shrink towards the poles, so scaling both axes by the same
 * factor would stretch every route east–west by 1/cos(latitude) — about 1.5×
 * in northern Europe, enough to make a familiar loop unrecognisable.
 *
 * Exported for its own test: this is arithmetic with a wrong answer that still
 * draws a plausible-looking line.
 */
export function projectRoute(
  route: Array<[number, number]>,
  box: { x: number; y: number; w: number; h: number },
): Array<[number, number]> {
  if (route.length === 0) return []
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const [lat, lon] of route) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  const midLat = (minLat + maxLat) / 2
  const kx = Math.cos((midLat * Math.PI) / 180)
  // A treadmill lap or a single fix has no extent; a zero span would divide by
  // zero and put every point at NaN.
  const spanX = Math.max((maxLon - minLon) * kx, 1e-9)
  const spanY = Math.max(maxLat - minLat, 1e-9)
  const scale = Math.min(box.w / spanX, box.h / spanY)
  const offX = box.x + (box.w - spanX * scale) / 2
  const offY = box.y + (box.h - spanY * scale) / 2
  return route.map(([lat, lon]) => [
    offX + (lon - minLon) * kx * scale,
    // Canvas y grows downwards, latitude grows northwards.
    offY + (maxLat - lat) * scale,
  ])
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Trims a string to fit `max` pixels, ellipsis included. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}

/** Waits for the page's webfonts, so the card is not drawn in a fallback face. */
async function ready() {
  try {
    await document.fonts.ready
  } catch {
    // Not available in every environment; a system face is a worse card, not a
    // broken one.
  }
}

const SANS = "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif"
const MONO = "'DM Mono', ui-monospace, monospace"

/**
 * Draws the card. Returns the canvas so the caller can preview it and encode it
 * in whichever format they want.
 */
export async function drawShareCard(workout: Workout, theme: CardTheme): Promise<HTMLCanvasElement> {
  await ready()
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw the card')

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // ── The route ──────────────────────────────────────────────────────────────
  const mapBox = { x: PAD, y: PAD, w: CARD_W - PAD * 2, h: MAP_H }
  ctx.save()
  roundRect(ctx, mapBox.x, mapBox.y, mapBox.w, mapBox.h, 32)
  ctx.fillStyle = theme.panel
  ctx.fill()
  ctx.clip()

  const route = workout.route ?? []
  if (route.length > 1) {
    const pts = projectRoute(route, { x: mapBox.x + 56, y: mapBox.y + 56, w: mapBox.w - 112, h: mapBox.h - 112 })
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // A wider, dimmer pass under the line so the track reads against the panel
    // at thumbnail size, where a 6px stroke is barely two pixels.
    ctx.strokeStyle = theme.accent
    ctx.globalAlpha = 0.22
    ctx.lineWidth = 20
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.lineWidth = 7
    ctx.stroke()

    // Start and finish, so the direction of a loop is readable.
    const dot = (p: [number, number], fill: string) => {
      ctx.beginPath()
      ctx.arc(p[0], p[1], 13, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 5
      ctx.strokeStyle = theme.panel
      ctx.stroke()
    }
    dot(pts[0], theme.accent)
    dot(pts[pts.length - 1], theme.text)
  } else {
    // No GPS: say so rather than leaving an empty panel that reads as a
    // rendering failure.
    ctx.fillStyle = theme.muted
    ctx.font = `500 34px ${SANS}`
    ctx.textAlign = 'center'
    ctx.fillText('No route recorded', mapBox.x + mapBox.w / 2, mapBox.y + mapBox.h / 2)
  }
  ctx.restore()

  // ── Title ──────────────────────────────────────────────────────────────────
  let y = mapBox.y + mapBox.h + 78
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.text
  ctx.font = `700 54px ${SANS}`
  ctx.fillText(ellipsize(ctx, workout.name || 'Workout', CARD_W - PAD * 2 - 200), PAD, y)

  // The sport, as a pill in its own colour — the one piece of the card that is
  // not the accent, because it means something specific.
  const sport = workout.type
  ctx.font = `600 26px ${SANS}`
  const pillW = ctx.measureText(sport).width + 44
  const pillX = CARD_W - PAD - pillW
  roundRect(ctx, pillX, y - 40, pillW, 52, 26)
  ctx.fillStyle = TYPE_COLOR[sport] ?? theme.accent
  ctx.globalAlpha = 0.18
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = TYPE_COLOR[sport] ?? theme.accent
  ctx.textAlign = 'center'
  ctx.fillText(sport, pillX + pillW / 2, y - 4)

  ctx.textAlign = 'left'
  y += 46
  ctx.fillStyle = theme.muted
  ctx.font = `400 28px ${SANS}`
  ctx.fillText(cardDate(workout.date), PAD, y)

  // ── Stats ──────────────────────────────────────────────────────────────────
  y += 52
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, y)
  ctx.lineTo(CARD_W - PAD, y)
  ctx.stroke()

  const stats = cardStats(workout)
  const colW = (CARD_W - PAD * 2) / stats.length
  stats.forEach((s, i) => {
    const cx = PAD + colW * i
    ctx.fillStyle = theme.muted
    ctx.font = `500 22px ${SANS}`
    ctx.fillText(s.label.toUpperCase(), cx, y + 62)
    ctx.fillStyle = theme.text
    ctx.font = `500 40px ${MONO}`
    ctx.fillText(ellipsize(ctx, s.value, colW - 16), cx, y + 116)
  })

  // ── Footer ─────────────────────────────────────────────────────────────────
  ctx.fillStyle = theme.muted
  ctx.font = `500 22px ${SANS}`
  ctx.fillText('Activity Lens', PAD, CARD_H - 48)

  return canvas
}

export type CardFormat = 'png' | 'jpeg'

/** Encodes a drawn card. JPEG for messaging apps that balk at large PNGs. */
export function encodeCard(canvas: HTMLCanvasElement, format: CardFormat): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Could not encode the image'))),
      format === 'jpeg' ? 'image/jpeg' : 'image/png',
      format === 'jpeg' ? 0.92 : undefined,
    )
  })
}

/** A filename someone can find again in their downloads. */
export function cardFilename(workout: Workout, format: CardFormat): string {
  const slug = (workout.name || 'workout')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'workout'
  return `${workout.date}-${slug}.${format}`
}
