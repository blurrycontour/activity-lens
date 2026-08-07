import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { Flame, Loader2, Maximize2, Minimize2, Route as RouteIcon } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import { LayerSwitcher, MAP_LAYERS, MAP_LAYER_KEY, hasWebGL, type MapLayerId } from '../components/RouteMap'
import { TYPE_COLOR, type WorkoutType } from '../data/workouts'
import { api, type Track } from '../lib/api'
import { useLocalStorage } from '../lib/useLocalStorage'
import { rangeLabel } from '../lib/range'

/**
 * Every workout at once.
 *
 * Its own page rather than a panel, because a map is the one view where more
 * space is strictly better, and because loading a library of routes has no
 * business happening on a page opened for something else.
 *
 * Three things keep it fast as a library grows, and all three are needed:
 *
 *   - the server stores a simplified copy of each route (about 80 points) and
 *     its bounding box, so nothing here decompresses a full track;
 *   - it filters by the visible area and the chosen range in SQL, so panning
 *     asks about what is on screen rather than about everything;
 *   - past a threshold the individual lines become a density layer, because a
 *     few thousand overlapping tracks over one city is a solid blob that says
 *     less than a heatmap of the same data.
 */

/**
 * Resolves a CSS custom property to the literal colour behind it.
 *
 * MapLibre parses colours itself and has no DOM to look a variable up in, so a
 * `var(--run)` handed to a paint property does not fail loudly — it fails to
 * parse and the layer draws black. Every sport colour in TYPE_COLOR is a
 * variable, so without this the whole map would be one black tangle. The same
 * mistake put a black band in the heart-rate track shading; see hrZones.ts.
 */
function literalColor(value: string, fallback: string): string {
  const name = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  if (!name) return value
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Above this many tracks, drawing them individually stops informing. */
const HEATMAP_FROM = 400

type Mode = 'auto' | 'routes' | 'heat'

/** Refetch no faster than this while a pan is in progress. */
const PAN_DEBOUNCE = 400

const VIEW_KEY = 'al_map_view'

interface SavedView { lng: number; lat: number; zoom: number }

/**
 * Where the map was left.
 *
 * Without this a reload dropped you at zoom 1.4 over the Atlantic looking at
 * nothing, because the first fetch has no viewport to ask about and the fit
 * only happens once. Restoring the position also means the first fetch asks
 * about somewhere real, which is the difference between a map that fills in and
 * one that appears empty.
 */
function readView(): SavedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')
    if (v && Number.isFinite(v.lng) && Number.isFinite(v.lat) && Number.isFinite(v.zoom)) return v
  } catch {
    // Corrupt or absent; fall back to fitting the data.
  }
  return null
}

export default function MapPage() {
  const [rangeDays, setRangeDays] = useLocalStorage<number>('al_map_range', 365)
  const [typeFilter, setTypeFilter] = useLocalStorage<WorkoutType | 'All'>('al_map_type', 'All')
  const [mode, setMode] = useLocalStorage<Mode>('al_map_mode', 'auto')
  const [layer, setLayer] = useState<MapLayerId>(() => {
    const stored = localStorage.getItem(MAP_LAYER_KEY)
    return stored === 'topo' || stored === 'satellite' ? stored : 'street'
  })
  useEffect(() => { localStorage.setItem(MAP_LAYER_KEY, layer) }, [layer])

  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [capped, setCapped] = useState(false)
  const [preparing, setPreparing] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [full, setFull] = useState(false)

  const node = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const glAvailable = useMemo(hasWebGL, [])
  // True until the first response has been fitted; the map opens on nothing in
  // particular and should move to where the workouts are exactly once.
  const needsFit = useRef(true)

  const from = useMemo(() => {
    if (rangeDays <= 0) return undefined
    const d = new Date()
    d.setDate(d.getDate() - rangeDays)
    return d.toISOString().slice(0, 10)
  }, [rangeDays])

  /**
   * Fetches the tracks for the current view.
   *
   * The viewport is read from the map at call time rather than held in state:
   * a pan produces a continuous stream of positions, and putting each one
   * through React would rerender the page on every frame of a drag.
   */
  const load = useCallback(async () => {
    setError(null)
    try {
      const b = mapRef.current?.getBounds()
      const res = await api.workoutTracks({
        from,
        bbox: b
          ? [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
          : undefined,
      })
      setTracks(res.tracks)
      setCapped(res.capped)
      setPreparing(res.preparing)
    } catch {
      setError('Could not load your routes.')
    } finally {
      setLoading(false)
    }
  }, [from])

  // The map's listeners are bound once and would otherwise hold the first
  // render's callbacks forever.
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => { setLoading(true); void load() }, [load])

  // The backfill runs in the background on the server, so a first visit on a
  // large library shows a growing map rather than a wrong one. Polling stops
  // the moment it is done, and never starts if there was nothing to prepare.
  useEffect(() => {
    if (preparing <= 0) return
    const t = setTimeout(() => { void load() }, 5000)
    return () => clearTimeout(t)
  }, [preparing, load])

  // Fullscreen is a CSS class rather than the Fullscreen API: the API is
  // unreliable inside an Android WebView and on iOS Safari, and this has to
  // work in the app as well as the browser. Escape leaves, like every other
  // dismissible surface here.
  useEffect(() => {
    if (!full) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setFull(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [full])

  // The container changed size under the canvas, which MapLibre cannot detect
  // on its own. Deferred a frame so the new layout has been applied.
  useEffect(() => {
    const id = requestAnimationFrame(() => mapRef.current?.resize())
    return () => cancelAnimationFrame(id)
  }, [full])

  const shown = useMemo(
    () => typeFilter === 'All' ? tracks : tracks.filter(t => t.type === typeFilter),
    [tracks, typeFilter],
  )
  const heat = mode === 'heat' || (mode === 'auto' && shown.length > HEATMAP_FROM)

  // ── The map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!node.current || mapRef.current || !glAvailable) return
    const saved = readView()
    // A saved position means there is nothing to fit to: the user already chose
    // where they wanted to be looking.
    if (saved) needsFit.current = false
    const map = new maplibregl.Map({
      container: node.current,
      style: MAP_LAYERS[layer].style,
      center: saved ? [saved.lng, saved.lat] : [0, 20],
      zoom: saved ? saved.zoom : 1.4,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map

    // Debounced, because a drag fires moveend once but a pinch-zoom fires it
    // repeatedly, and each one is a request.
    let timer: ReturnType<typeof setTimeout> | undefined
    const onMove = () => {
      const c = map.getCenter()
      localStorage.setItem(VIEW_KEY, JSON.stringify({ lng: c.lng, lat: c.lat, zoom: map.getZoom() }))
      clearTimeout(timer)
      // Through a ref: this handler is bound once, and the direct reference
      // would have kept fetching with the range that was selected when the map
      // was built.
      timer = setTimeout(() => { void loadRef.current() }, PAN_DEBOUNCE)
    }
    map.on('moveend', onMove)
    // Both, and via a ref for the same reason. `load` covers the first style;
    // `styledata` covers a base-layer switch, which discards every source and
    // layer and needs them put back. Whichever arrives, the data is applied
    // from what is current rather than from what was current at binding time.
    const apply = () => applyRef.current()
    map.on('load', apply)
    map.on('styledata', apply)
    return () => {
      clearTimeout(timer)
      map.remove()
      mapRef.current = null
    }
    // Built once. Everything that changes afterwards reaches it through a ref
    // or its own effect; rebuilding the map would throw away the user's
    // position, which is the bug this whole block exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glAvailable])

  // Switching base layer replaces the style, which drops every source and layer
  // with it; the data effect below re-adds them when the new style settles.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(MAP_LAYERS[layer].style)
  }, [layer])

  // Re-resolved on every draw rather than cached: the accent and the theme are
  // both user-settable, and a cached palette would keep the old colours until
  // the page was reloaded.
  const colorFor = useCallback(
    (type: WorkoutType) => literalColor(TYPE_COLOR[type] ?? 'var(--primary)', '#00e87a'),
    [],
  )

  /** Puts the current data on the map. A no-op until the style is ready. */
  const applyData = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const lines = {
      type: 'FeatureCollection' as const,
      features: shown.map(t => ({
        type: 'Feature' as const,
        properties: { id: t.id, name: t.name, color: colorFor(t.type) },
        geometry: { type: 'LineString' as const, coordinates: t.points.map(([lat, lon]) => [lon, lat]) },
      })),
    }
    // The heatmap wants points, not lines: MapLibre's heatmap layer only reads
    // point geometry, and a route's own vertices are already an even sampling
    // of where the person was.
    const points = {
      type: 'FeatureCollection' as const,
      features: shown.flatMap(t => t.points.map(([lat, lon]) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [lon, lat] },
      }))),
    }

    const set = (id: string, data: maplibregl.GeoJSONSourceSpecification['data']) => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(data)
      else map.addSource(id, { type: 'geojson', data })
    }
    set('tracks', lines)
    set('track-points', points)

    // A dark casing under the coloured line, which is how every printed map
    // separates a route from the roads beneath it. Without it the amber used
    // for Hike is very nearly the colour a basemap paints a main road, and the
    // track disappears into the street it is running along.
    if (!map.getLayer('tracks-casing')) {
      map.addLayer({
        id: 'tracks-casing',
        type: 'line',
        source: 'tracks',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': 'rgba(0,0,0,0.55)',
          // Always wider than the line above it by roughly two pixels, at every
          // zoom, or the casing vanishes where it is needed most.
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.6, 12, 5, 16, 7.5],
          'line-opacity': 0.5,
        },
      })
    }
    if (!map.getLayer('tracks-line')) {
      map.addLayer({
        id: 'tracks-line',
        type: 'line',
        source: 'tracks',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        // Fully opaque, unlike the first version: overlap-as-brightness reads
        // nicely on a plain background and turns to mud over a street map. The
        // heatmap is what answers "how often", and it does it properly.
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2.5, 16, 4],
          'line-opacity': 0.95,
        },
      })
    }
    if (!map.getLayer('tracks-heat')) {
      map.addLayer({
        id: 'tracks-heat',
        type: 'heatmap',
        source: 'track-points',
        paint: {
          'heatmap-weight': 0.6,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 16, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 10, 8, 16, 18],
          'heatmap-opacity': 0.85,
          // Transparent at zero so the basemap shows through where nobody has
          // been; a solid low end would tint the whole world.
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, '#3b82f6',
            0.4, '#22d3ee',
            0.6, '#facc15',
            0.8, '#f97316',
            1, '#ef4444',
          ],
        },
      })
    }
    for (const id of ['tracks-casing', 'tracks-line']) {
      map.setLayoutProperty(id, 'visibility', heat ? 'none' : 'visible')
    }
    map.setLayoutProperty('tracks-heat', 'visibility', heat ? 'visible' : 'none')

    // Fitted once, to the first thing that comes back. Doing it on every load
    // would fight the user for control of the map: they pan, that triggers a
    // fetch, and the fetch moves the map back.
    if (needsFit.current && shown.length > 0) {
      const b = new maplibregl.LngLatBounds()
      for (const t of shown) for (const [lat, lon] of t.points) b.extend([lon, lat])
      if (!b.isEmpty()) {
        needsFit.current = false
        map.fitBounds(b, { padding: 48, animate: false, maxZoom: 14 })
      }
    }
  }, [shown, heat, colorFor])

  const applyRef = useRef(applyData)
  applyRef.current = applyData

  // Data changed: apply it if the style is ready, and rely on the map's own
  // `load`/`styledata` listeners if it is not. Between the two, there is no
  // ordering in which the tracks arrive and never get drawn — which is what
  // left a reloaded page showing an empty world.
  useEffect(() => { applyData() }, [applyData])

  const scope = rangeLabel(rangeDays)

  return (
    <>
      <PageHeader
        title="Map"
        subtitle="Every route you have recorded"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <TypeDropdown value={typeFilter} onChange={setTypeFilter} />
            <RangeDropdown value={rangeDays} onChange={setRangeDays} />
          </div>
        }
      />

      <div className="page-content map-page">
        <div className="map-page-bar">
          <span className="map-page-count">
            {loading
              ? <><Loader2 size={12} className="spin" /> Loading…</>
              : `${shown.length} route${shown.length === 1 ? '' : 's'} · ${scope}`}
            {capped && !loading && ' (showing the most recent — zoom in for the rest)'}
          </span>

          {/* Only offered once there is a choice to make. Below the threshold
              the automatic answer is always "routes", and a toggle that does
              nothing visible is worse than no toggle. */}
          <div className="map-mode">
            {([
              { id: 'routes' as Mode, label: 'Routes', icon: <RouteIcon size={13} /> },
              { id: 'heat' as Mode, label: 'Heatmap', icon: <Flame size={13} /> },
            ]).map(o => (
              <button
                key={o.id}
                className={`chip${(mode === o.id || (mode === 'auto' && heat === (o.id === 'heat'))) ? ' active' : ''}`}
                aria-pressed={mode === o.id}
                onClick={() => setMode(mode === o.id ? 'auto' : o.id)}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
        </div>

        {preparing > 0 && (
          <p className="map-page-note">
            <Loader2 size={12} className="spin" /> Preparing {preparing} earlier
            workout{preparing === 1 ? '' : 's'} for the map. They appear as they are done.
          </p>
        )}
        {error && <p className="map-page-note error">{error}</p>}

        <div className={`map-page-canvas${full ? ' full' : ''}`}>
          {glAvailable
            ? <div ref={node} className="map-page-gl" />
            : (
              <div className="map-page-empty">
                This browser has no WebGL, so the map cannot be drawn here.
              </div>
            )}
          {glAvailable && (
            <>
              <LayerSwitcher layer={layer} onChange={setLayer} offsetRight={46} />
              <button
                className="btn-icon map-page-expand"
                onClick={() => setFull(f => !f)}
                title={full ? 'Exit full screen' : 'Full screen'}
                aria-label={full ? 'Exit full screen' : 'Full screen'}
              >
                {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </>
          )}
          {!loading && shown.length === 0 && !error && (
            <div className="map-page-empty overlay-note">
              No routes in this view. Try a wider date range, or zoom out.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
