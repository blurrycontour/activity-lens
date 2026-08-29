import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Clock, Gauge, Heart, Navigation, type LucideIcon } from 'lucide-react'
import { fmtDist, fmtDuration, fmtPace, TYPE_COLOR, TYPE_ICON, type Workout } from '../data/workouts'
import { PULSE_PATH } from '../components/Logo'
import { FINISH_ANCHOR, FINISH_BOX, FINISH_FLAG_D, FINISH_POLE_D } from './mapMarkers'

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
 *
 * Icons are the one thing that does go through SVG, because they carry no text:
 * the same lucide components the app renders are serialised and rasterised, so
 * the card cannot drift from the sport marks used everywhere else.
 */

/** Portrait, which is what messaging apps and stories show without cropping. */
export const CARD_W = 1080
/**
 * The full card: route, four figures, footer.
 *
 * Not the only height any more — see cardHeight. Kept as the number it always
 * was so a card with everything on it is pixel-identical to the ones people
 * have already sent.
 */
export const CARD_H = 1350

const PAD = 72
/** Title block above the route: sport mark, title, date and time. */
const HEAD_H = 172
/** One stat tile. Two rows of two sit under the route. */
const STAT_H = 152
const STAT_GAP = 24
/**
 * One row of the list layout, used when there are too few figures to grid.
 *
 * Deliberately shorter than a tile and tighter between rows: three rows have to
 * come out *shorter* than the 2×2 grid they replace, or hiding a figure would
 * make the card taller, which is the opposite of what switching it off is for.
 * A row is one line — label left, value right — so it needs no tile's height.
 */
const LIST_H = 84
const LIST_GAP = 18
/** Attribution strip at the foot. */
const FOOT_H = 96
/** Between the route and the first row of tiles. */
const GAP = 36

const MAP_Y = PAD + HEAD_H
const MAP_H = CARD_H - PAD - FOOT_H - (STAT_H * 2 + STAT_GAP) - GAP - MAP_Y

/**
 * How the figures are laid out, and how tall that makes them.
 *
 * Four fill a 2×2 grid, which is what the card was built around. Fewer than
 * four cannot: three in a grid leaves a hole, and a hole reads as something
 * that failed to draw. They become full-width rows instead — label on the left,
 * value on the right — which is both honest about there being three of them and
 * shorter, which is the point of hiding something in the first place.
 */
export function statsLayout(count: number): 'grid' | 'list' {
  return count >= 4 ? 'grid' : 'list'
}

/** The height the block of figures needs. */
function statsHeight(count: number): number {
  if (count === 0) return 0
  if (statsLayout(count) === 'grid') {
    const rows = Math.ceil(count / 2)
    return rows * STAT_H + (rows - 1) * STAT_GAP
  }
  return count * LIST_H + (count - 1) * LIST_GAP
}

/**
 * How tall this card comes out.
 *
 * The card grows and shrinks with what is on it, so the preview has to ask
 * rather than assume: a card with no route and three figures is nearly half the
 * height of the full one, and a fixed aspect ratio would letterbox it.
 */
export function cardHeight(workout: Workout, options: CardOptions = {}): number {
  const map = options.showRoute === false ? 0 : MAP_H + GAP
  return MAP_Y + map + statsHeight(cardStats(workout, options).length) + FOOT_H + PAD
}

export interface CardTheme {
  bg: string
  panel: string
  text: string
  muted: string
  accent: string
  border: string
  /** The finish flag, which is the app's danger red on the workout map too. */
  danger: string
}

/** Whether the headline is the workout's name or simply the sport. */
export type CardTitleMode = 'type' | 'name'

export interface CardOptions {
  /** Defaults to the sport, which is the version that needs no explaining. */
  titleMode?: CardTitleMode
  /**
   * Draw the route panel. Off for a workout with no GPS, where the panel is a
   * large box saying so, and for anyone who would rather not publish where
   * they run — a track outside a front door is the most identifying thing on
   * the card. Omitting it shortens the card by the panel's height.
   */
  showRoute?: boolean
  /** Include the average heart rate among the figures. */
  showHR?: boolean
}

/**
 * Resolves a CSS custom property to the literal colour behind it.
 *
 * Canvas parses colours itself and has no element to resolve a variable
 * against, so `fillStyle = 'var(--run)'` is not an error — it is ignored, and
 * the shape is painted in whatever colour was set last. Every entry in
 * TYPE_COLOR is a variable, so the sport mark and its pill both depend on this.
 * The same trap draws black lines on MapLibre; see MapPage's literalColor.
 */
function literalColor(value: string, fallback: string): string {
  const name = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  if (!name) return value
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
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
    danger: v('--danger', '#ef4444'),
  }
}

export interface CardStat {
  label: string
  value: string
  icon: LucideIcon
  /** Fixed hue for the icon and label, so the four figures read apart at a
   *  glance. Literal because canvas cannot resolve a CSS variable, and vetted
   *  against both card themes — these are the heart-rate zone palette. */
  color: string
}

/**
 * The four figures on the card, in reading order: the two that every workout
 * has first, the two that depend on the sport and the device second.
 */
export function cardStats(w: Workout, options: CardOptions = {}): CardStat[] {
  const stats: CardStat[] = [
    { label: 'Time', value: w.duration > 0 ? fmtDuration(w.duration) : '—', icon: Clock, color: '#60a5fa' },
    { label: 'Distance', value: w.distance > 0 ? fmtDist(w.distance) : '—', icon: Navigation, color: '#34d399' },
    { label: 'Avg HR', value: w.avgHR > 0 ? `${w.avgHR} bpm` : '—', icon: Heart, color: '#ef4444' },
    // Pace is meaningless without distance, and "0:00 /km" reads as a number
    // rather than as an absence.
    { label: 'Avg Pace', value: w.avgPace > 0 ? `${fmtPace(w.avgPace)} /km` : '—', icon: Gauge, color: '#a855f7' },
  ]
  // Dropped, not blanked. A tile reading "Avg HR —" is the fact the sender
  // chose to leave out, printed anyway.
  return options.showHR === false ? stats.filter(s => s.label !== 'Avg HR') : stats
}

/** "Saturday, 12 July 2025", or the raw value if it will not parse. */
export function cardDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * The date, with the time of day appended when the server sent one.
 *
 * Older servers omit `startTime` entirely, and a workout entered by hand may
 * have no meaningful time on it, so the time is additive: its absence shortens
 * the line rather than leaving "00:00" on the card.
 */
export function cardWhen(w: Workout): string {
  const day = cardDate(w.date)
  if (!w.startTime) return day
  const t = new Date(w.startTime)
  if (isNaN(t.getTime())) return day
  return `${day} · ${t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
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

/**
 * Serialises a lucide icon to a standalone SVG document.
 *
 * Rendered with the same React that draws the rest of the app, into a detached
 * div, and read back out. Two alternatives were weighed and rejected: importing
 * lucide's per-icon module for its raw `__iconNode` is reaching past the
 * package's public surface and breaks the first time it reorganises its files,
 * and `react-dom/server`'s renderToStaticMarkup pulls a 60 kB server renderer
 * into the bundle for four icons on one dialog.
 *
 * Safe to call from an effect only because `drawShareCard` has already awaited
 * the fonts by this point — `flushSync` during React's own render would warn.
 */
function iconSvg(icon: LucideIcon, color: string, px: number): string | null {
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    flushSync(() => root.render(createElement(icon, { size: px, color, strokeWidth: 2 })))
    const svg = host.firstElementChild
    if (!svg) return null
    // React renders SVG without the namespace declaration, which is implied
    // inside an HTML document and required in a standalone one.
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    return new XMLSerializer().serializeToString(svg)
  } catch {
    return null
  } finally {
    root.unmount()
  }
}

/**
 * Rasterises a lucide icon at a literal colour.
 *
 * Nothing external is referenced — lucide icons are stroked paths — so the
 * canvas is never tainted and the export still works.
 *
 * Returns null rather than throwing: an icon that will not load should cost the
 * card an icon, not the whole image.
 */
async function iconImage(icon: LucideIcon, color: string, px: number): Promise<HTMLImageElement | null> {
  try {
    const svg = iconSvg(icon, color, px)
    if (!svg) return null
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    return await new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image()
      // A data URI decodes without a network round trip, but a timeout means a
      // browser that never fires either event cannot hang the dialog open on a
      // spinner forever.
      const done = setTimeout(() => resolve(null), 3000)
      img.onload = () => { clearTimeout(done); resolve(img) }
      img.onerror = () => { clearTimeout(done); resolve(null) }
      img.src = src
    })
  } catch {
    return null
  }
}

/**
 * The finish flag, planted with its pole's foot on the last fix.
 *
 * The same geometry the workout map hands MapLibre, so the card ends the route
 * the way the app does. A second dot in a different colour was the first
 * version and it read as a waypoint rather than as the end.
 */
function drawFinishFlag(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
  const k = size / FINISH_BOX
  ctx.save()
  ctx.translate(x - FINISH_ANCHOR[0] * k, y - FINISH_ANCHOR[1] * k)
  ctx.scale(k, k)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // White throughout, as on the map: the card's route can pass under the flag,
  // and an outline is what keeps it legible when it does.
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2.5
  ctx.stroke(new Path2D(FINISH_POLE_D))
  const flag = new Path2D(FINISH_FLAG_D)
  ctx.fillStyle = fill
  ctx.fill(flag)
  ctx.lineWidth = 1.5
  ctx.stroke(flag)
  ctx.restore()
}

/** Strokes the app's mark. Geometry comes from Logo.tsx, which owns it. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 512, size / 512)
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.save()
  ctx.translate(256, 256)
  ctx.rotate((135 * Math.PI) / 180)
  ctx.translate(-256, -256)
  ctx.setLineDash([895, 300])
  ctx.lineWidth = 40
  ctx.beginPath()
  ctx.arc(256, 256, 190, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  ctx.setLineDash([])
  ctx.lineWidth = 32
  ctx.stroke(new Path2D(PULSE_PATH))
  ctx.restore()
}

const SANS = "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif"
const MONO = "'DM Mono', ui-monospace, monospace"

/**
 * Draws the card onto a canvas the caller owns.
 *
 * Takes the element rather than creating one, so React can render it and this
 * only paints. Returning a detached canvas for the caller to splice into the
 * DOM was the first design, and it crashed the page: the element it replaced
 * belonged to React, which then tried to remove a node that was no longer its
 * child. Anything that owns DOM React also renders will find that eventually.
 */
export async function drawShareCard(
  canvas: HTMLCanvasElement,
  workout: Workout,
  theme: CardTheme,
  options: CardOptions = {},
): Promise<void> {
  await ready()
  // Height follows the content: no route and one fewer figure is a shorter
  // card, not the same card with a gap in it.
  const cardH = cardHeight(workout, options)
  canvas.width = CARD_W
  canvas.height = cardH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw the card')
  ctx.clearRect(0, 0, CARD_W, cardH)

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, CARD_W, cardH)

  const sport = workout.type
  const sportColor = literalColor(TYPE_COLOR[sport] ?? 'var(--primary)', theme.accent)
  const stats = cardStats(workout, options)
  const withRoute = options.showRoute !== false

  // Every icon up front: the layout below is a straight sequence of draws, and
  // awaiting in the middle of it would leave the card half-painted on screen.
  const [sportIcon, ...statIcons] = await Promise.all([
    iconImage(TYPE_ICON[sport], sportColor, 64),
    ...stats.map(s => iconImage(s.icon, s.color, 34)),
  ])

  // ── Header ─────────────────────────────────────────────────────────────────
  // The sport leads, because it is the one thing a stranger needs to read the
  // rest: 5 km means something different under a bike than under a pair of legs.
  const markSize = 64
  const markX = PAD
  const markY = PAD + 4
  if (sportIcon) {
    ctx.drawImage(sportIcon, markX, markY, markSize, markSize)
  } else {
    // No icon is a worse card, not a broken one — a dot in the sport's colour
    // keeps the title from starting against the edge of nothing.
    ctx.fillStyle = sportColor
    ctx.beginPath()
    ctx.arc(markX + markSize / 2, markY + markSize / 2, 18, 0, Math.PI * 2)
    ctx.fill()
  }

  const textX = markX + markSize + 26
  const title = options.titleMode === 'name' ? (workout.name || sport) : sport
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.text
  ctx.font = `700 52px ${SANS}`
  ctx.fillText(ellipsize(ctx, title, CARD_W - PAD - textX), textX, markY + 44)

  ctx.fillStyle = theme.muted
  ctx.font = `400 27px ${SANS}`
  ctx.fillText(ellipsize(ctx, cardWhen(workout), CARD_W - PAD - textX), textX, markY + 92)

  // ── The route ──────────────────────────────────────────────────────────────
  // Skipped entirely rather than drawn empty: the panel is most of the card,
  // and a sender who turned it off wants the height back, not a blank box.
  const mapBox = { x: PAD, y: MAP_Y, w: CARD_W - PAD * 2, h: MAP_H }
  if (withRoute) {
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
    const start = pts[0]
    ctx.beginPath()
    ctx.arc(start[0], start[1], 13, 0, Math.PI * 2)
    ctx.fillStyle = theme.accent
    ctx.fill()
    ctx.lineWidth = 5
    ctx.strokeStyle = theme.panel
    ctx.stroke()

    const end = pts[pts.length - 1]
    drawFinishFlag(ctx, end[0], end[1], 54, theme.danger)
  } else {
    // No GPS: say so rather than leaving an empty panel that reads as a
    // rendering failure.
    ctx.fillStyle = theme.muted
    ctx.font = `500 34px ${SANS}`
    ctx.textAlign = 'center'
    ctx.fillText('No route recorded', mapBox.x + mapBox.w / 2, mapBox.y + mapBox.h / 2)
  }
  ctx.restore()
  }

  // ── Stats, two by two ──────────────────────────────────────────────────────
  // A grid rather than four columns across one line: four values on one row
  // gives each of them a quarter of the width, which is where "1:23:45" started
  // being trimmed. Two per row is also the shape people expect on a phone.
  const list = statsLayout(stats.length) === 'list'
  const tileW = list ? CARD_W - PAD * 2 : (CARD_W - PAD * 2 - STAT_GAP) / 2
  const rowH = list ? LIST_H : STAT_H
  const rowGap = list ? LIST_GAP : STAT_GAP
  const gridY = MAP_Y + (withRoute ? MAP_H + GAP : 0)
  stats.forEach((s, i) => {
    const x = list ? PAD : PAD + (i % 2) * (tileW + STAT_GAP)
    const y = gridY + (list ? i : Math.floor(i / 2)) * (rowH + rowGap)

    roundRect(ctx, x, y, tileW, rowH, 26)
    ctx.fillStyle = theme.panel
    ctx.fill()
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 2
    ctx.stroke()

    const inner = x + 32
    const icon = statIcons[i]

    if (list) {
      // Label and value on one line, the value against the right edge. A row
      // this wide with the value under the label would be mostly empty panel.
      if (icon) ctx.drawImage(icon, inner, y + rowH / 2 - 16, 32, 32)
      ctx.textAlign = 'left'
      ctx.fillStyle = s.color
      ctx.font = `500 26px ${SANS}`
      ctx.fillText(s.label.toUpperCase(), inner + (icon ? 46 : 0), y + rowH / 2 + 9)

      ctx.textAlign = 'right'
      ctx.fillStyle = theme.text
      ctx.font = `500 42px ${MONO}`
      ctx.fillText(ellipsize(ctx, s.value, tileW / 2), x + tileW - 32, y + rowH / 2 + 15)
      ctx.textAlign = 'left'
      return
    }

    if (icon) ctx.drawImage(icon, inner, y + 30, 34, 34)

    ctx.textAlign = 'left'
    ctx.fillStyle = s.color
    ctx.font = `500 23px ${SANS}`
    ctx.fillText(s.label.toUpperCase(), inner + (icon ? 46 : 0), y + 55)

    ctx.fillStyle = theme.text
    ctx.font = `500 46px ${MONO}`
    ctx.fillText(ellipsize(ctx, s.value, tileW - 64), inner, y + 118)
  })

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footY = cardH - PAD + 4
  drawLogo(ctx, PAD, footY - 36, 40, theme.muted)
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.muted
  ctx.font = `500 24px ${SANS}`
  ctx.fillText('Activity Lens', PAD + 54, footY - 6)
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
