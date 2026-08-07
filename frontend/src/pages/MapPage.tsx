import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { Flame, Loader2, Maximize2, Route as RouteIcon } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import ExpandModal from '../components/ExpandModal'
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

/*
 * The view is deliberately not remembered.
 *
 * An earlier version persisted the centre and zoom, which meant arriving at the
 * page put you wherever you last dragged to — often mid-ocean, at a zoom that
 * showed nothing, with no clue that a "go back to my routes" control was what
 * you needed. Opening the map fits it to the routes it just loaded, every time,
 * so the page always starts by answering the question it exists to answer.
 */

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

  // Held in state, not a ref: maximizing moves the map's container from the
  // page into the modal, which is a different element, and the effect that
  // builds the map has to notice. A ref's identity never changes, so it cannot.
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const glAvailable = useMemo(hasWebGL, [])
  // True until the first response has been fitted; the map opens on nothing in
  // particular and should move to where the workouts are exactly once.
  const needsFit = useRef(true)
  // Where the map is looking, carried across the rebuild that maximizing
  // causes. Not persisted — see above.
  const view = useRef<{ center: maplibregl.LngLat; zoom: number } | null>(null)

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

  // Not the Fullscreen API: it is unreliable inside an Android WebView and on
  // iOS Safari, and this has to work in the app as well as the browser. The
  // modal handles the back gesture and the close button; Escape is here so a
  // keyboard has the same way out as every other dismissible surface.
  useEffect(() => {
    if (!full) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setFull(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [full])

  /*
   * The map runs to the bottom of the viewport, measured rather than computed.
   *
   * `100dvh` minus a constant was the obvious version and it was wrong at half
   * the sizes it met: the header wraps onto a second line on a narrow phone,
   * the filter row wraps independently of it, and the bottom bar exists on some
   * widths and not others. Measuring the gap between the top of the map and the
   * bottom of the scroll container is the only version that survives all of
   * them, and it is one read per resize.
   */
  const canvasEl = useRef<HTMLDivElement>(null)
  const [mapH, setMapH] = useState<number>()
  useEffect(() => {
    const el = canvasEl.current
    if (!el) return
    const measure = () => {
      const scroller = el.closest('.main-content')
      if (!scroller) return
      const style = getComputedStyle(scroller)
      // clientHeight includes the padding the bottom bar sits behind, so it has
      // to come back off; the page's own bottom gutter comes off as well.
      const usable = scroller.getBoundingClientRect().top + scroller.clientHeight
        - parseFloat(style.paddingBottom || '0')
      const gutter = parseFloat(getComputedStyle(el.parentElement ?? el).paddingBottom || '0')
      const next = Math.round(usable - el.getBoundingClientRect().top - gutter)
      // Only on a real change: this sets a height inside an element the
      // observer is watching, and echoing it back would be an endless loop.
      setMapH(prev => (prev != null && Math.abs(prev - next) < 2 ? prev : next))
    }
    measure()
    // The header and the filter row are what move; watching them covers a
    // rotation, a wrap, and the browser's address bar collapsing on scroll.
    const ro = new ResizeObserver(measure)
    if (el.parentElement) ro.observe(el.parentElement)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  // The container changed size under the canvas, which MapLibre cannot detect
  // on its own. Deferred a frame so the new layout has been applied.
  useEffect(() => {
    const id = requestAnimationFrame(() => mapRef.current?.resize())
    return () => cancelAnimationFrame(id)
  }, [mapH])

  const shown = useMemo(
    () => typeFilter === 'All' ? tracks : tracks.filter(t => t.type === typeFilter),
    [tracks, typeFilter],
  )
  const heat = mode === 'heat' || (mode === 'auto' && shown.length > HEATMAP_FROM)

  // ── The map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!node || !glAvailable) return
    const saved = view.current
    const map = new maplibregl.Map({
      container: node,
      style: MAP_LAYERS[layer].style,
      // Where it was left, but only across a maximize — `view` starts empty on
      // every visit, so arriving at the page still fits to the routes.
      center: saved ? saved.center : [0, 20],
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
      view.current = { center: map.getCenter(), zoom: map.getZoom() }
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
    // MapLibre builds the compact attribution *expanded* and only folds it away
    // on the first interaction with the map, so a page that is looked at before
    // it is touched wears a bar of tile credits across its corner. Removing the
    // class is exactly what MapLibre's own minimise does. It is a documented
    // stylesheet class rather than a private method, and the worst outcome if it
    // is ever renamed is the attribution staying open — which is where it starts
    // anyway.
    map.on('load', () => {
      map.getContainer()
        .querySelector('.maplibregl-ctrl-attrib')
        ?.classList.remove('maplibregl-compact-show')
    })
    return () => {
      clearTimeout(timer)
      map.remove()
      mapRef.current = null
    }
    // Rebuilt only when the container element itself changes, which is once per
    // maximize and never otherwise. Everything else — the range, the filter,
    // the base layer, the data — reaches the existing map through a ref or its
    // own effect, because rebuilding for those would throw away the position
    // the user had panned to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glAvailable, node])

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
        // Recorded here as well as on moveend: the fit happens once, and if a
        // maximize came before the user had panned anywhere there would be no
        // position to rebuild at and the new map would open on an empty world.
        view.current = { center: map.getCenter(), zoom: map.getZoom() }
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

  /*
   * The map and its controls, rendered in exactly one place at a time: in the
   * page, or inside the modal that maximizing opens. Moving it costs a rebuild
   * of the MapLibre instance — React cannot hand the same element to a new
   * parent — which is what `view` above exists to paper over.
   *
   * The alternative was leaving it in the page and making it cover the screen
   * with `position: fixed`, which is what the first version did and why the
   * bottom bar sat on top of it: the swipe pager is a stacking context, so no
   * z-index from in here can escape the page.
   */
  const mapPanel = (
    <>
      {glAvailable
        ? <div ref={setNode} className="map-page-gl" />
        : (
          <div className="map-page-empty">
            This browser has no WebGL, so the map cannot be drawn here.
          </div>
        )}
      {glAvailable && (
        <>
          {/* Takes the corner to itself when maximized: the modal's own header
              carries the close button there, so nothing sits beside it. */}
          <LayerSwitcher layer={layer} onChange={setLayer} offsetRight={full ? 10 : 46} />
          {!full && (
            <button
              className="btn-icon map-page-expand"
              onClick={() => setFull(true)}
              title="Full screen"
              aria-label="Full screen"
            >
              <Maximize2 size={14} />
            </button>
          )}
        </>
      )}
      {!loading && shown.length === 0 && !error && (
        <div className="map-page-empty overlay-note">
          No routes in this view. Try a wider date range, or zoom out.
        </div>
      )}
    </>
  )

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

        <div ref={canvasEl} className="map-page-canvas" style={{ height: mapH }}>
          {!full && mapPanel}
        </div>
      </div>

      {full && (
        <ExpandModal title="Map" variant="map" onClose={() => setFull(false)}>
          <div className="modal-immersive-map">{mapPanel}</div>
        </ExpandModal>
      )}
    </>
  )
}
