import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
// NOTE: maplibre-gl.css is imported in main.tsx, not here — see the comment
// there. It has to load before index.css, which overrides several of its rules.
// The worker is a separate module MapLibre fetches at runtime, by a URL it
// builds from a variable — which Vite cannot follow, so without an import here
// the file is never emitted, the request falls through to the SPA handler, and
// the browser refuses the index.html it gets back:
//
//   Failed to load module script: ... non-JavaScript MIME type "text/html"
//
// `?worker&url` and not `?url`: the plain asset form copies the worker file
// byte-for-byte, and it opens with `import "./maplibre-gl-shared.mjs"` — a
// sibling Vite never emits, so the worker booted and immediately 404'd on it.
// `?worker` builds it as its own entry with that dependency rolled in.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Activity, Gauge, Heart, Layers, Mountain, Route } from 'lucide-react'
import Dropdown from './Dropdown'
import { hrZoneColor } from '../lib/hrZones'
import { fmtDist, fmtDuration, fmtPace, type Workout } from '../data/workouts'
import type { Playhead } from '../lib/playhead'
import { cachedURL, installTileCache } from '../lib/tileCache'
import { FINISH_FLAG_D, FINISH_POLE_D } from '../lib/mapMarkers'

maplibregl.setWorkerUrl(maplibreWorkerUrl)
// Registered alongside the worker, before any map is built, because the style
// URLs below are already addressed to it.
installTileCache()

function nearestRouteIndex(route: Array<[number, number]>, lat: number, lng: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < route.length; i++) {
    const dLat = route[i][0] - lat
    const dLng = route[i][1] - lng
    const dist = dLat * dLat + dLng * dLng
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

export type MapLayerId = 'street' | 'topo' | 'satellite'

export const MAP_LAYER_KEY = 'al_map_layer'
/** Start and finish pins, as plain elements for a MapLibre marker. */
function pinElement(html: string, cls = 'route-pin'): HTMLElement {
  const el = document.createElement('div')
  el.className = cls
  el.innerHTML = html
  return el
}

const START_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-label="Start"><circle cx="12" cy="12" r="7" fill="var(--success)" stroke="#fff" stroke-width="2.5"/></svg>'
const FINISH_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-label="Finish"><path d="${FINISH_POLE_D}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="${FINISH_FLAG_D}" fill="var(--danger)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`


/**
 * A raster style wrapping a plain XYZ tile service, so imagery can sit beside
 * the vector style in the same switcher. MapLibre has no {s} subdomain token,
 * so a server that wants them gets one entry per host and MapLibre spreads
 * requests over them itself.
 */
function rasterStyle(tiles: string[], attribution: string, maxzoom: number): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: tiles.map(cachedURL), tileSize: 256, maxzoom, attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

/**
 * What the layer switcher offers.
 *
 * Street is OpenFreeMap's Liberty, which is vector: the tiles carry geometry
 * rather than pictures of geometry, so the GPU draws them and panning and
 * zooming are continuous instead of a staircase of raster levels. The other two
 * stay raster because there is no vector equivalent — aerial imagery is
 * photographs, and OpenTopoMap's relief shading is baked into its tiles.
 */
export const MAP_LAYERS: Record<MapLayerId, { label: string; style: string | maplibregl.StyleSpecification; maxZoom: number }> = {
  street: {
    label: 'Street',
    style: cachedURL('https://tiles.openfreemap.org/styles/liberty'),
    maxZoom: 20,
  },
  topo: {
    label: 'Topographic',
    style: rasterStyle(
      ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
      'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      17,
    ),
    maxZoom: 17,
  },
  satellite: {
    label: 'Satellite',
    style: rasterStyle(
      ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      19,
    ),
    maxZoom: 19,
  },
}

export function LayerSwitcher({ layer, onChange, offsetRight = 46 }: {
  layer: MapLayerId
  onChange: (l: MapLayerId) => void
  /** Distance from the right edge, so this sits beside the maximize button when
   *  there is one and in its place when there is not. */
  offsetRight?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div
      className="options-menu-wrap"
      ref={ref}
      // Inline, and not a class: .options-menu-wrap sets `position: relative`
      // further down the stylesheet, so a class here loses to it and the
      // switcher drops back into the flow and out of sight.
      style={{ position: 'absolute', top: 10, right: offsetRight, zIndex: 500 }}
    >
      <button
        className="btn-icon"
        onClick={() => setOpen(o => !o)}
        title="Map layer"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
      >
        <Layers size={14} />
      </button>
      {open && (
        <div className="options-menu" style={{ animation: 'fadeIn 0.12s ease' }}>
          {(Object.keys(MAP_LAYERS) as MapLayerId[]).map(id => (
            <button
              key={id}
              className={`options-menu-item${layer === id ? ' active' : ''}`}
              onClick={() => { setOpen(false); onChange(id) }}
            >
              {MAP_LAYERS[id].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type Shading = 'accent' | 'hr' | 'pace' | 'elevation' | 'cadence'

/**
 * Whether this browser can give MapLibre the GL context it needs.
 *
 * Checked before constructing a map rather than after: MapLibre throws on
 * construction when WebGL is missing, and that took the whole page down with a
 * blank screen and "failed to initialize WebGL" in the console. Browsers with
 * hardware acceleration switched off, some remote desktops and a few Linux
 * setups without a working GPU stack all land here.
 *
 * Computed once. Nothing about the answer changes within a session, and
 * creating a throwaway context per render is not free.
 */
let webglAnswer: boolean | null = null
export function hasWebGL(): boolean {
  if (webglAnswer !== null) return webglAnswer
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    // Released explicitly: some drivers cap the number of live contexts, and
    // the map is about to want one of its own.
    const lose = (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')
    lose?.loseContext()
    webglAnswer = Boolean(gl)
  } catch {
    webglAnswer = false
  }
  return webglAnswer
}

/**
 * The route without a map behind it, for browsers that cannot run MapLibre.
 *
 * There is no basemap to draw — every tile renderer worth using needs a GPU —
 * but the route's shape, its shading, and where playback has reached are the
 * parts this page is actually about, and all three are plain SVG. Clicking
 * still scrubs, so the chart cursors and the transport keep working together.
 */
function RouteShapeFallback({ route, segments, current, onScrub, duration, avatar, color }: {
  route: Array<[number, number]>
  segments: Array<{ positions: Array<[number, number]>; color: string }>
  current: [number, number]
  onScrub: (t: number) => void
  duration: number
  avatar?: string
  color: string
}) {
  const box = useMemo(() => {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const [lat, lng] of route) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    // Longitude degrees are shorter than latitude degrees away from the
    // equator, so they are scaled by cos(lat) — without it a north-south route
    // comes out stretched sideways.
    const midLat = (minLat + maxLat) / 2
    const kx = Math.cos((midLat * Math.PI) / 180)
    const w = Math.max((maxLng - minLng) * kx, 1e-9)
    const h = Math.max(maxLat - minLat, 1e-9)
    return { minLat, maxLat, minLng, kx, w, h }
  }, [route])

  // Into a 100x100 viewBox, keeping the aspect ratio and leaving a margin so
  // the stroke and the end markers are not clipped.
  const project = ([lat, lng]: [number, number]): [number, number] => {
    const scale = 92 / Math.max(box.w, box.h)
    const x = 4 + ((lng - box.minLng) * box.kx) * scale + (92 - box.w * scale) / 2
    const y = 4 + (box.maxLat - lat) * scale + (92 - box.h * scale) / 2
    return [x, y]
  }

  const [cx, cy] = project(current)
  const [sx, sy] = project(route[0])
  const [ex, ey] = project(route[route.length - 1])

  return (
    // Sized by the map frame, exactly as the WebGL canvas is. Laying it out in
    // flow with height:100% instead made it grow to whatever it liked whenever
    // the frame's own height was not a resolved length.
    <div className="route-map-canvas" style={{ background: 'var(--bg-3)', display: 'flex', flexDirection: 'column' }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        style={{ flex: 1, minHeight: 0, width: '100%', cursor: 'crosshair' }}
        onClick={e => {
          if (route.length < 2 || duration <= 0) return
          const r = (e.target as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
          const rect = r.getBoundingClientRect()
          // Back out of the viewBox using the rendered box, then pick the
          // nearest point in projected space.
          const side = Math.min(rect.width, rect.height)
          const px = ((e.clientX - rect.left) - (rect.width - side) / 2) / side * 100
          const py = ((e.clientY - rect.top) - (rect.height - side) / 2) / side * 100
          let best = 0, bestD = Infinity
          for (let i = 0; i < route.length; i++) {
            const [x, y] = project(route[i])
            const d = (x - px) ** 2 + (y - py) ** 2
            if (d < bestD) { bestD = d; best = i }
          }
          onScrub((best / (route.length - 1)) * duration)
        }}
      >
        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg.positions.map(p => project(p).join(',')).join(' ')}
            fill="none"
            stroke={seg.color}
            strokeWidth={1.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <circle cx={sx} cy={sy} r={1.7} fill="var(--success)" stroke="#fff" strokeWidth={0.6} />
        <circle cx={ex} cy={ey} r={1.7} fill="var(--danger)" stroke="#fff" strokeWidth={0.6} />
        {/* The same avatar the map marker uses, so playback reads as "you"
            here too rather than as an anonymous dot. Drawn in the viewBox
            rather than layered over it in HTML, because the SVG is letterboxed
            to keep its aspect ratio and only its own coordinate space knows
            where that put the route. */}
        {avatar
          ? (
            <>
              <clipPath id="route-avatar-clip"><circle cx={cx} cy={cy} r={4} /></clipPath>
              <image
                href={avatar}
                x={cx - 4} y={cy - 4} width={8} height={8}
                preserveAspectRatio="xMidYMid slice"
                clipPath="url(#route-avatar-clip)"
              />
              <circle cx={cx} cy={cy} r={4} fill="none" stroke={color} strokeWidth={0.9} />
            </>
          )
          : <circle cx={cx} cy={cy} r={2.2} fill={color} stroke="#fff" strokeWidth={0.8} />}
      </svg>
    </div>
  )
}

/**
 * Where playback has reached along the route, as a fraction of the whole.
 *
 * Interpolated between two fixes rather than snapped to the nearer one. The
 * clock advances every animation frame, so the stepping the marker used to show
 * was entirely this rounding: a 600-point track played over 15 seconds changes
 * its nearest fix 40 times a second and the marker jumped between them.
 *
 * Straight-line between neighbours is enough — GPS fixes on a recorded track
 * are metres apart, so the chord and the true path differ by less than the
 * marker is wide.
 *
 * Holds up with an empty route, which is the state the page is in while the
 * workout loads and before the early return that would otherwise cover it.
 */
function positionAt(route: Array<[number, number]>, fraction: number): [number, number] {
  if (route.length === 0) return [0, 0]
  const exact = fraction * (route.length - 1)
  const i0 = Math.min(Math.floor(exact), route.length - 1)
  const i1 = Math.min(i0 + 1, route.length - 1)
  const between = exact - i0
  return [
    route[i0][0] + (route[i1][0] - route[i0][0]) * between,
    route[i0][1] + (route[i1][1] - route[i0][1]) * between,
  ]
}

export default function RouteMap({
  route, color, duration, currentTime, playhead, onScrub, height, distance, hrTimeline, paceTimeline, elevTimeline, cadenceTimeline, avatarUrl, maxHR, cadenceLabel,
  shading, onShadingChange, maximizeButton,
}: {
  route: Array<[number, number]>
  color: string
  duration: number
  /** Throttled, for anything that renders. The marker uses playhead instead. */
  currentTime: number
  playhead: Playhead
  onScrub: (t: number) => void
  height: number | string
  distance: number
  hrTimeline: Workout['hrTimeline']
  paceTimeline: Workout['paceTimeline']
  elevTimeline: Workout['elevTimeline']
  cadenceTimeline: Array<{ t: number; cad: number }>
  avatarUrl?: string
  maxHR: number
  cadenceLabel: string
  /**
   * Owned by the page, not by this component. The inline map and the maximized
   * one are two separate mounts, so state held here was discarded the moment
   * the map was expanded — the track went back to the accent colour and the
   * picker back to "Default".
   */
  shading: Shading
  onShadingChange: (s: Shading) => void
  /** Rendered by this component so it can sit beside the layer switcher rather
   *  than on top of it. Absent when the map is already maximized, and the
   *  switcher then takes the corner instead of leaving a hole where the button
   *  would have been. */
  maximizeButton?: React.ReactNode
}) {
  const [layer, setLayer] = useState<MapLayerId>(() => {
    const stored = localStorage.getItem(MAP_LAYER_KEY)
    // Street by default: it is the vector layer, so it is the one that stays
    // sharp at any zoom and costs the least to pan.
    return (stored === 'street' || stored === 'topo' || stored === 'satellite') ? stored : 'street'
  })
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  useEffect(() => {
    localStorage.setItem(MAP_LAYER_KEY, layer)
  }, [layer])

  const timeAt = (index: number) => (index / Math.max(route.length - 1, 1)) * duration

  // The moving playback marker shows the user's (minified) profile picture when
  // available, so it reads as "you" tracing the route. Falls back to a plain
  // dot when there's no avatar. Rebuilt only when the avatar/color changes.
  // The moving playback marker shows the user's (minified) profile picture when
  // available, so it reads as "you" tracing the route. Falls back to a plain
  // dot when there's no avatar.
  const markerElement = useMemo(() => {
    const el = document.createElement('div')
    el.className = 'route-avatar'
    el.innerHTML = avatarUrl
      ? `<img src="${avatarUrl}" width="34" height="34" loading="lazy" decoding="async" style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;border:2.5px solid ${color};box-shadow:0 1px 6px rgba(0,0,0,0.45);background:var(--bg-2)" alt="" />`
      : `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5)"></div>`
    return el
  }, [avatarUrl, color])

  // Shading is precomputed once per route/metric (never per playback tick) and
  // capped to a fixed number of segments so long, high-frequency tracks stay
  // smooth. The metric min/max is computed a single time rather than
  // re-scanned for every segment (which was O(n^2) and caused the lag).
  // NOTE: this hook must run unconditionally (before the early return below)
  // to keep hook order stable when route data loads asynchronously.
  const shadedSegments = useMemo(() => {
    if (shading === 'accent' || route.length < 2) {
      return [{ positions: route, color }]
    }
    const series: Record<Exclude<Shading, 'accent'>, { samples: Array<{ t: number }>; values: number[] }> = {
      hr: { samples: hrTimeline, values: hrTimeline.map(p => p.hr) },
      pace: { samples: paceTimeline, values: paceTimeline.map(p => p.pace) },
      elevation: { samples: elevTimeline, values: elevTimeline.map(p => p.elev) },
      cadence: { samples: cadenceTimeline, values: cadenceTimeline.map(p => p.cad) },
    }
    const { samples, values } = series[shading]
    if (samples.length === 0) return [{ positions: route, color }]
    const min = Math.min(...values)
    const span = Math.max(Math.max(...values) - min, 1)
    const maxSegments = 220
    const step = Math.max(1, Math.ceil((route.length - 1) / maxSegments))
    const segStep = duration / Math.max(route.length - 1, 1)
    let cursor = 0
    const colorFor = (t: number) => {
      while (cursor < samples.length - 1 && Math.abs(samples[cursor + 1].t - t) <= Math.abs(samples[cursor].t - t)) cursor++
      if (shading === 'hr') return hrZoneColor(values[cursor], maxHR)
      const ratio = (values[cursor] - min) / span
      return `hsl(${210 - ratio * 190} 78% 52%)`
    }
    const segs: Array<{ positions: Array<[number, number]>; color: string }> = []
    for (let i = 0; i < route.length - 1; i += step) {
      const end = Math.min(i + step, route.length - 1)
      segs.push({ positions: route.slice(i, end + 1), color: colorFor(i * segStep) })
    }
    return segs
  }, [route, shading, hrTimeline, paceTimeline, elevTimeline, cadenceTimeline, duration, color, maxHR])

  /**
   * The track as GeoJSON, one feature per shaded segment, carrying its colour
   * as a property so a single line layer can draw the lot.
   *
   * This is the whole reason panning stayed smooth while the track plays. The
   * route used to be up to 220 React components, reconciled and handed to the
   * map on every animation frame of playback — so moving the map while playing
   * meant React rebuilding the entire track sixty times a second on top of the
   * map's own work. Here the geometry is uploaded once and only the marker
   * moves, which is a single imperative call.
   */
  const routeGeoJSON = useMemo<maplibregl.GeoJSONSourceSpecification['data']>(() => ({
    type: 'FeatureCollection',
    features: shadedSegments.map(seg => ({
      type: 'Feature' as const,
      properties: { color: seg.color },
      // GeoJSON is lng,lat; the route is stored lat,lng.
      geometry: { type: 'LineString' as const, coordinates: seg.positions.map(([lat, lng]) => [lng, lat]) },
    })),
  }), [shadedSegments])

  // ── The map itself ────────────────────────────────────────────────────────
  //
  // Held in refs and driven imperatively. React renders the container and the
  // controls around it and nothing inside it, so a playback frame costs one
  // setLngLat rather than a reconciliation of the whole track.
  const mapNode = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const glAvailable = useMemo(hasWebGL, [])
  // The workout arrives after the first render, so the map cannot be built
  // there — this is what the init effect waits for. Depending on the route
  // array itself would tear the map down and rebuild it whenever the reference
  // changed; the only thing that matters is whether there is one to draw.
  const mapBuildable = glAvailable && route.length >= 2

  // Latest values for the click handler, which is bound once to the map and
  // would otherwise capture the first render's props forever.
  const clickData = useRef({ route, duration, onScrub, selected: selectedPoint })
  clickData.current = { route, duration, onScrub, selected: selectedPoint }

  /**
   * The playback time this component last asked for, so a move it did not cause
   * can be told apart from one it did.
   *
   * The popup describes one point the user picked, and any transport action —
   * play, reset, jump to end, dragging the slider — makes it a label for
   * somewhere the playhead no longer is. Reset in particular left it sitting at
   * the old position looking authoritative. Comparing against our own scrub is
   * what distinguishes the two without threading a signal down from the
   * transport controls, which live several components up.
   */
  const ownScrub = useRef<number | null>(null)
  useEffect(() => {
    if (currentTime === ownScrub.current) return
    ownScrub.current = null
    setSelectedPoint(null)
  }, [currentTime])

  useEffect(() => {
    if (!mapNode.current || mapRef.current || !mapBuildable) return
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: MAP_LAYERS[layer].style,
      center: [route[0][1], route[0][0]],
      zoom: 13,
      attributionControl: { compact: true },
      // Pitch and rotation have no use for a route trace and make it easy to
      // leave the map in a state a two-finger drag cannot undo.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      const { route: r, duration: d, onScrub: scrub, selected } = clickData.current
      if (r.length < 2 || d <= 0) return
      // A click while the popup is up means "close it", and nothing else.
      // Moving it instead is why dismissing took two clicks: the first landed
      // on the popup itself and did nothing, and the second reopened it
      // somewhere new rather than putting it away.
      if (selected != null) {
        setSelectedPoint(null)
        return
      }
      const idx = nearestRouteIndex(r, e.lngLat.lat, e.lngLat.lng)
      const t = (idx / (r.length - 1)) * d
      ownScrub.current = t
      scrub(t)
      setSelectedPoint(idx)
    })
    // Attribution opens expanded even when compact, and on a phone that is a
    // bar of link text across the bottom of the map. Collapsed to the "i" it
    // already knows how to be; the class stays, so it is not re-expanded.
    map.once('load', () => {
      const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
      attrib?.classList.remove('maplibregl-compact-show')
      attrib?.removeAttribute('open')
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
    // Built once, on the first render that has a route to put in it. Layer and
    // data changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapBuildable])

  useEffect(() => {
    const map = mapRef.current
    if (map) map.setStyle(MAP_LAYERS[layer].style)
  }, [layer])

  // Track geometry, re-added whenever a style swap has wiped it.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const draw = () => {
      const existing = map.getSource('route') as maplibregl.GeoJSONSource | undefined
      if (existing) {
        existing.setData(routeGeoJSON)
        return
      }
      map.addSource('route', { type: 'geojson', data: routeGeoJSON })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        // Each feature carries its own colour, so shading is a data change
        // rather than a different set of layers.
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.85 },
      })
    }
    // Drawn now if there is a style to draw into, and again after every style
    // change — a layer switch throws away every source and layer the old style
    // owned, the track among them.
    //
    // `style.load` is the event for this: MapLibre fires it once the style has
    // fully loaded *or changed*, which is exactly both cases. The two obvious
    // neighbours are both wrong. `load` fires once in a map's lifetime, so
    // after a switch it has already been and gone. `styledata` fires while a
    // style is still loading, when sources cannot be added yet, and stops
    // firing before isStyleLoaded() turns true — so waiting for that
    // combination waits forever.
    if (map.isStyleLoaded()) draw()
    map.on('style.load', draw)
    return () => { map.off('style.load', draw) }
  }, [routeGeoJSON])

  // Start, finish and playback markers. Markers survive a style change, so
  // these are created once and only the moving one is updated.
  useEffect(() => {
    const map = mapRef.current
    if (!map || route.length < 2) return
    const start = new maplibregl.Marker({ element: pinElement(START_SVG) }).setLngLat([route[0][1], route[0][0]]).addTo(map)
    const finish = new maplibregl.Marker({ element: pinElement(FINISH_SVG), anchor: 'bottom' }).setLngLat([route[route.length - 1][1], route[route.length - 1][0]]).addTo(map)
    const marker = new maplibregl.Marker({ element: markerElement }).setLngLat([route[0][1], route[0][0]]).addTo(map)
    markerRef.current = marker
    return () => { start.remove(); finish.remove(); marker.remove(); markerRef.current = null }
  }, [route, markerElement])

  // Frame the whole route when it changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || route.length < 2) return
    const bounds = new maplibregl.LngLatBounds()
    for (const [lat, lng] of route) bounds.extend([lng, lat])
    map.fitBounds(bounds, { padding: 28, duration: 0 })
  }, [route])

  const fraction = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0
  // Where playback is between two fixes, not at the nearer of the two.
  //
  // The clock already advances every animation frame, so the stepping was
  // entirely this rounding: a 600-point track played over 15 seconds changes
  // its nearest fix 40 times a second, and the marker jumped between them.
  // Interpolating along the segment gives a position for every frame, which is
  // what makes it read as motion rather than as a sequence of positions.
  //
  // Straight-line between neighbours is enough. GPS fixes on a recorded track
  // are metres apart, so the chord and the true path differ by less than the
  // marker is wide.
  // Computed before the "no route" return below, because the effects that use
  // it are hooks and cannot be skipped — so it has to hold up with no route at
  // all, which is the state this page is in while the workout loads.
  // Read inside the per-frame subscriber below, which must not be resubscribed
  // for a new route array — that would tear down and rebuild the subscription
  // on every render which produced one.
  const routeRef = useRef(route)
  routeRef.current = route

  const current = positionAt(route, fraction)
  const sampleAt = <T extends { t: number }>(samples: T[], index: number) => samples.reduce<T | null>((closest, sample) => !closest || Math.abs(sample.t - timeAt(index)) < Math.abs(closest.t - timeAt(index)) ? sample : closest, null)

  // Playback position, applied straight to the marker.
  //
  // Subscribed to the playhead rather than driven by a prop, so this is the one
  // thing that happens per animation frame: no render, no React state, no map
  // source touched — just a transform on an element the map already owns. That
  // is what leaves the main thread free enough to answer a pan while the track
  // is playing.
  useEffect(() => playhead.subscribe(t => {
    const marker = markerRef.current
    if (!marker) return
    const at = positionAt(routeRef.current, duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 0)
    marker.setLngLat([at[1], at[0]])
  }), [playhead, duration])


  // The point popup, opened on click and torn down with the selection.
  useEffect(() => {
    const map = mapRef.current
    popupRef.current?.remove()
    popupRef.current = null
    if (!map || selectedPoint == null || route.length < 2) return
    const at = route[selectedPoint]
    const cad = cadenceTimeline.length > 0 ? `<br />Cadence ${sampleAt(cadenceTimeline, selectedPoint)?.cad ?? '—'} ${cadenceLabel}` : ''
    const pace = sampleAt(paceTimeline, selectedPoint)?.pace
    // closeOnClick off: MapLibre would tear the element down on the next map
    // click while our state still said it was open, leaving the two out of step.
    // The click handler above is the single place that decides.
    popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 12, closeOnClick: false })
      .setLngLat([at[1], at[0]])
      .setHTML(`<div style="font-size:12px;line-height:1.6"><strong>${fmtDuration(timeAt(selectedPoint))}</strong><br />`
        + `Distance ${fmtDist((selectedPoint / Math.max(route.length - 1, 1)) * distance)}<br />`
        + `HR ${sampleAt(hrTimeline, selectedPoint)?.hr ?? '—'} bpm<br />`
        + `Pace ${pace ? `${fmtPace(pace)} /km` : '—'}<br />`
        + `Speed ${pace ? `${(3600 / pace).toFixed(1)} km/h` : '—'}<br />`
        + `Elevation ${sampleAt(elevTimeline, selectedPoint)?.elev ?? '—'} m${cad}</div>`)
      .addTo(map)
    return () => { popupRef.current?.remove(); popupRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoint, route, distance, cadenceLabel])

  if (route.length < 2) {
    return (
      <div style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No route data
      </div>
    )
  }



  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      {maximizeButton}
      {glAvailable && <LayerSwitcher layer={layer} onChange={setLayer} offsetRight={maximizeButton ? 46 : 10} />}
      <div className="map-shade-picker">
        <Dropdown
          value={shading}
          onChange={onShadingChange}
          dropUp
          ariaLabel="Track shading"
          options={[
            { value: 'accent' as Shading, label: 'Default', glyph: <Route size={14} color="var(--text-3)" aria-hidden /> },
            ...(hrTimeline.length > 0 ? [{ value: 'hr' as Shading, label: 'Heart rate zones', glyph: <Heart size={14} color="var(--text-3)" aria-hidden /> }] : []),
            ...(paceTimeline.length > 0 ? [{ value: 'pace' as Shading, label: 'Pace / Speed', glyph: <Gauge size={14} color="var(--text-3)" aria-hidden /> }] : []),
            ...(elevTimeline.length > 0 ? [{ value: 'elevation' as Shading, label: 'Elevation', glyph: <Mountain size={14} color="var(--text-3)" aria-hidden /> }] : []),
            ...(cadenceTimeline.length > 0 ? [{ value: 'cadence' as Shading, label: 'Cadence', glyph: <Activity size={14} color="var(--text-3)" aria-hidden /> }] : []),
          ]}
        />
      </div>
      {glAvailable
        ? <div ref={mapNode} className="route-map-canvas" />
        : (
          <>
            <RouteShapeFallback route={route} segments={shadedSegments} current={current} onScrub={onScrub} duration={duration} avatar={avatarUrl} color={color} />
            {/* Along the top, because the bottom of the frame belongs to the
                shading picker — which used to cover this outright. */}
            <p className="route-fallback-note">
              Showing the route outline only — this browser has no WebGL, which the map needs.
              Enabling hardware acceleration brings the map back.
            </p>
          </>
        )}
    </div>
  )
}
