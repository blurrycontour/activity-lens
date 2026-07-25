import { useEffect, useMemo, useRef, useState } from 'react'
import { type Workout, type WorkoutType, WORKOUT_TYPES, fmtDuration, fmtDist, fmtPace, TYPE_COLOR, TYPE_ICON } from '../data/workouts'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, ReferenceLine, ReferenceDot } from 'recharts'
import {
  ArrowLeft, Heart, Mountain, Zap, Clock, TrendingUp, Navigation, Download, Pencil, Trash2, Gauge,
  Check, X as XIcon, Play, Pause, RotateCcw, SkipForward, Maximize2, Sigma, Footprints, MoreVertical, Layers,
} from 'lucide-react'
import { useWorkouts } from '../context/WorkoutsContext'
import { api } from '../lib/api'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { divIcon } from 'leaflet'
import type { LatLngBoundsExpression } from 'leaflet'

function exportGPX(w: Workout) {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Activity Lens">
  <metadata><name>${w.name}</name></metadata>
  <trk>
    <name>${w.name}</name>
    <type>${w.type}</type>
    <trkseg>
${w.route.map(([lat, lng]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`
  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${w.name.replace(/\s+/g, '_')}_${w.date}.gpx`
  a.click()
  URL.revokeObjectURL(url)
}

interface WorkoutDetailProps {
  workout: Workout
  accent?: string
  onBack: () => void
}

/** Small marker shown next to stat values that are derived from recorded
 * samples rather than reported directly by the imported source. */
function CalcIcon() {
  return (
    <span title="Calculated from recorded data" style={{ display: 'inline-flex', opacity: 0.55 }}>
      <Sigma size={10} />
    </span>
  )
}

function StatChip({ icon, label, value, calculated }: { icon?: React.ReactNode; label: string; value: string; calculated?: boolean }) {
  return (
    <div className="stat-grid-item">
      <span className="stat-label">
        {icon}
        {label}
        {calculated && <CalcIcon />}
      </span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

function OptionsMenu({ onEdit, onExport, onDelete, deleting }: { onEdit: () => void; onExport: () => void; onDelete: () => void; deleting: boolean }) {
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
    <div className="options-menu-wrap" ref={ref}>
      <button className="btn-icon" onClick={() => setOpen(o => !o)} title="Workout options">
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="options-menu" style={{ animation: 'fadeIn 0.12s ease' }}>
          <button className="options-menu-item" onClick={() => { setOpen(false); onEdit() }}>
            <Pencil size={14} /> Edit workout
          </button>
          <button className="options-menu-item" onClick={() => { setOpen(false); onExport() }}>
            <Download size={14} /> Export GPX
          </button>
          <button className="options-menu-item danger" onClick={() => { setOpen(false); onDelete() }} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete workout'}
          </button>
        </div>
      )}
    </div>
  )
}

type Metric = 'hr' | 'pace' | 'speed' | 'elevation'

const HR_ZONE_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#ef4444', '#a855f7']
const HR_ZONE_LABELS = ['Zone 1 (<60%)', 'Zone 2 (60-70%)', 'Zone 3 (70-80%)', 'Zone 4 (80-90%)', 'Zone 5 (90-100%)']

function hrZoneBuckets(hrTimeline: { t: number; hr: number }[], maxHR: number) {
  if (hrTimeline.length === 0 || maxHR <= 0) return []
  const counts = [0, 0, 0, 0, 0]
  for (let i = 0; i < hrTimeline.length; i++) {
    const pct = (hrTimeline[i].hr / maxHR) * 100
    const idx = pct < 60 ? 0 : pct < 70 ? 1 : pct < 80 ? 2 : pct < 90 ? 3 : 4
    counts[idx]++
  }
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return counts.map((c, i) => ({ name: HR_ZONE_LABELS[i], value: c, pct: Math.round((c / total) * 100), color: HR_ZONE_COLORS[i] })).filter(z => z.value > 0)
}

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

function smoothTimeline(data: Array<{ t: number; value: number }>, radius = 3) {
  return data.map((point, index) => {
    const first = Math.max(0, index - radius)
    const last = Math.min(data.length, index + radius + 1)
    const values = data.slice(first, last)
    return { ...point, value: values.reduce((total, sample) => total + sample.value, 0) / values.length }
  })
}

function FitBounds({ route }: { route: Array<[number, number]> }) {
  const map = useMap()
  useEffect(() => {
    if (route.length === 0) return
    if (route.length === 1) {
      map.setView(route[0], 15)
      return
    }
    const bounds = route as unknown as LatLngBoundsExpression
    map.fitBounds(bounds, { padding: [24, 24] })
  }, [route, map])
  return null
}

function MapClickHandler({ route, duration, onScrub, onPoint }: { route: Array<[number, number]>; duration: number; onScrub: (t: number) => void; onPoint: (index: number) => void }) {
  useMapEvents({
    click(e) {
      if (route.length < 2 || duration <= 0) return
      const idx = nearestRouteIndex(route, e.latlng.lat, e.latlng.lng)
      onScrub((idx / (route.length - 1)) * duration)
      onPoint(idx)
    },
  })
  return null
}

type MapLayerId = 'street' | 'topo' | 'satellite'

const MAP_LAYER_KEY = 'al_map_layer'
const START_MARKER = divIcon({
  className: 'route-pin',
  html: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-label="Start"><circle cx="12" cy="12" r="7" fill="#22c55e" stroke="#fff" stroke-width="2.5"/></svg>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})
const FINISH_MARKER = divIcon({
  className: 'route-pin',
  html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-label="Finish"><path d="M6 21V4" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M6 5h11l-2.2 3.3L17 12H6z" fill="#ef4444" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  iconSize: [28, 28],
  iconAnchor: [7, 25],
})

const MAP_LAYERS: Record<MapLayerId, { label: string; url: string; attribution: string; maxZoom: number }> = {
  street: {
    label: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  topo: {
    label: 'Topographic',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
}

function LayerSwitcher({ layer, onChange }: { layer: MapLayerId; onChange: (l: MapLayerId) => void }) {
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
      style={{ position: 'absolute', top: 10, right: 46, zIndex: 500 }}
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

function RouteMap({
  route, color, duration, currentTime, onScrub, height, distance, hrTimeline, paceTimeline, elevTimeline,
}: {
  route: Array<[number, number]>
  color: string
  duration: number
  currentTime: number
  onScrub: (t: number) => void
  height: number | string
  distance: number
  hrTimeline: Workout['hrTimeline']
  paceTimeline: Workout['paceTimeline']
  elevTimeline: Workout['elevTimeline']
}) {
  const [layer, setLayer] = useState<MapLayerId>(() => {
    const stored = localStorage.getItem(MAP_LAYER_KEY)
    return (stored === 'street' || stored === 'topo' || stored === 'satellite') ? stored : 'street'
  })
  const [shading, setShading] = useState<'accent' | 'hr' | 'pace' | 'elevation'>('accent')
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  useEffect(() => {
    localStorage.setItem(MAP_LAYER_KEY, layer)
  }, [layer])

  if (route.length < 2) {
    return (
      <div style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No route data
      </div>
    )
  }
  const fraction = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0
  const idx = Math.round(fraction * (route.length - 1))
  const current = route[idx]
  const start = route[0]
  const end = route[route.length - 1]
  const activeLayer = MAP_LAYERS[layer]
  const timeAt = (index: number) => (index / Math.max(route.length - 1, 1)) * duration
  const sampleAt = <T extends { t: number }>(samples: T[], index: number) => samples.reduce<T | null>((closest, sample) => !closest || Math.abs(sample.t - timeAt(index)) < Math.abs(closest.t - timeAt(index)) ? sample : closest, null)

  // Shading is precomputed once per route/metric (never per playback tick) and
  // capped to a fixed number of segments so long, high-frequency tracks stay
  // smooth. The metric min/max is computed a single time rather than
  // re-scanned for every segment (which was O(n^2) and caused the lag).
  const shadedSegments = useMemo(() => {
    if (shading === 'accent' || route.length < 2) {
      return [{ positions: route, color }]
    }
    const samples = shading === 'hr' ? hrTimeline : shading === 'pace' ? paceTimeline : elevTimeline
    const values = shading === 'hr' ? hrTimeline.map(p => p.hr) : shading === 'pace' ? paceTimeline.map(p => p.pace) : elevTimeline.map(p => p.elev)
    if (samples.length === 0) return [{ positions: route, color }]
    const min = Math.min(...values)
    const span = Math.max(Math.max(...values) - min, 1)
    const maxSegments = 220
    const step = Math.max(1, Math.ceil((route.length - 1) / maxSegments))
    const segStep = duration / Math.max(route.length - 1, 1)
    let cursor = 0
    const colorFor = (t: number) => {
      while (cursor < samples.length - 1 && Math.abs(samples[cursor + 1].t - t) <= Math.abs(samples[cursor].t - t)) cursor++
      const ratio = (values[cursor] - min) / span
      if (shading === 'hr') return ratio < 0.6 ? '#34d399' : ratio < 0.8 ? '#fbbf24' : '#ef4444'
      return `hsl(${210 - ratio * 190} 78% 52%)`
    }
    const segs: Array<{ positions: Array<[number, number]>; color: string }> = []
    for (let i = 0; i < route.length - 1; i += step) {
      const end = Math.min(i + step, route.length - 1)
      segs.push({ positions: route.slice(i, end + 1), color: colorFor(i * segStep) })
    }
    return segs
  }, [route, shading, hrTimeline, paceTimeline, elevTimeline, duration, color])

  const selectedTime = selectedPoint == null ? 0 : timeAt(selectedPoint)
  const selectedHR = selectedPoint == null ? null : sampleAt(hrTimeline, selectedPoint)?.hr
  const selectedPace = selectedPoint == null ? null : sampleAt(paceTimeline, selectedPoint)?.pace
  const selectedElev = selectedPoint == null ? null : sampleAt(elevTimeline, selectedPoint)?.elev

  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      <LayerSwitcher layer={layer} onChange={setLayer} />
      <select className="map-shade-select" value={shading} onChange={e => setShading(e.target.value as typeof shading)} title="Track shading">
        <option value="accent">Default</option>
        <option value="hr">Heart rate zones</option>
        <option value="pace">Pace / Speed</option>
        <option value="elevation">Elevation</option>
      </select>
      <MapContainer center={current} zoom={14} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
        <TileLayer
          key={layer}
          url={activeLayer.url}
          attribution={activeLayer.attribution}
          maxZoom={activeLayer.maxZoom}
        />
        <FitBounds route={route} />
        <MapClickHandler route={route} duration={duration} onScrub={onScrub} onPoint={setSelectedPoint} />
        {shadedSegments.map((seg, index) => <Polyline key={index} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.85 }} />)}
        <Marker position={start} icon={START_MARKER} interactive={false} />
        <Marker position={end} icon={FINISH_MARKER} interactive={false} />
        <CircleMarker center={current} radius={7} pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }} />
        {selectedPoint != null && <Popup position={route[selectedPoint]} closeButton={false} autoPan><div style={{ fontSize: 12, lineHeight: 1.6 }}><strong>{fmtDuration(selectedTime)}</strong><br />Distance {fmtDist((selectedPoint / Math.max(route.length - 1, 1)) * distance)}<br />HR {selectedHR ?? '—'} bpm<br />Pace {selectedPace ? `${fmtPace(selectedPace)} /km` : '—'}<br />Speed {selectedPace ? `${(3600 / selectedPace).toFixed(1)} km/h` : '—'}<br />Elevation {selectedElev ?? '—'} m</div></Popup>}
      </MapContainer>
    </div>
  )
}

function PlaybackBar({
  playing, currentTime, duration, onPlayPause, onReset, onEnd, onScrub,
}: {
  playing: boolean
  currentTime: number
  duration: number
  onPlayPause: () => void
  onReset: () => void
  onEnd: () => void
  onScrub: (t: number) => void
}) {
  return (
    <div className="playback-bar">
      <div className="playback-controls">
        <button className="btn-icon" onClick={onPlayPause} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="btn-icon" onClick={onReset} title="Reset">
          <RotateCcw size={16} />
        </button>
        <button className="btn-icon" onClick={onEnd} title="Jump to end">
          <SkipForward size={16} />
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(duration))}
        step={1}
        value={Math.round(currentTime)}
        onChange={e => onScrub(Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--primary)' }}
      />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)', minWidth: 88, textAlign: 'right' }}>
        {fmtDuration(currentTime)} / {fmtDuration(duration)}
      </span>
    </div>
  )
}


function ChartTooltip({ active, payload, label, unit, valueFormatter }: { active?: boolean; payload?: any[]; label?: string; unit: string; valueFormatter?: (value: number) => string }) {
  if (!active || !payload?.length) return null
  const mins = Math.floor(Number(label) / 60)
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>{mins}m</div>
      <div style={{ color: 'var(--text)', fontWeight: 600 }}>{valueFormatter ? valueFormatter(Number(payload[0].value)) : payload[0].value} {unit}</div>
    </div>
  )
}

function HRZoneTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>{d.name}</div>
      <div style={{ color: 'var(--text)', fontWeight: 600 }}>{d.value} samples ({d.pct}%)</div>
    </div>
  )
}

function ExpandModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-box" style={{ maxWidth: 900, width: '95vw' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
            <button className="btn-icon" onClick={onClose} title="Close"><XIcon size={18} /></button>
          </div>
          {children}
        </div>
      </div>
    </>
  )
}

export default function WorkoutDetail({ workout: w0, accent, onBack }: WorkoutDetailProps) {
  const { updateWorkout, removeWorkout } = useWorkouts()
  const [w, setW] = useState(w0)
  const color = TYPE_COLOR[w.type]
  const trailColor = accent || color

  // List views only carry summary fields (no route/timelines) for
  // efficiency, so if we were handed a summary-only workout, fetch the full
  // record before rendering the map/charts (otherwise they'd stay blank
  // until an unrelated re-render happened to bring in the full data).
  useEffect(() => {
    if (w0.route.length > 0 || w0.hrTimeline.length > 0 || w0.paceTimeline.length > 0 || w0.elevTimeline.length > 0) return
    let cancelled = false
    api.getWorkout(w0.id).then(full => { if (!cancelled) setW(full) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(w.name)
  const [editDate, setEditDate] = useState(w.date)
  const [editType, setEditType] = useState<WorkoutType>(w.type)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const [selectedMetrics, setSelectedMetrics] = useState<Metric[]>(['hr', 'pace', 'speed', 'elevation'])
  function toggleMetric(m: Metric) {
    setSelectedMetrics(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  const speedTimeline = useMemo(
    () => w.paceTimeline.filter(p => p.pace > 0).map(p => ({ t: p.t, speed: Math.round((3600 / p.pace) * 10) / 10 })),
    [w.paceTimeline],
  )
  const hrZones = useMemo(() => hrZoneBuckets(w.hrTimeline, w.maxHR), [w.hrTimeline, w.maxHR])

  // Stats not directly reported by imports (per-point min/max, elevation
  // loss, step estimate) — derived here from the recorded timelines/route.
  const derived = useMemo(() => {
    const hrVals = w.hrTimeline.map(p => p.hr).filter(hr => hr > 0)
    const paceVals = w.paceTimeline.filter(p => p.pace > 0).map(p => p.pace)
    const speedVals = speedTimeline.map(p => p.speed)
    let elevLoss = 0
    for (let i = 1; i < w.elevTimeline.length; i++) {
      const d = w.elevTimeline[i].elev - w.elevTimeline[i - 1].elev
      if (d < 0) elevLoss += -d
    }
    const strideLength = w.type === 'Run' ? 1.0 : w.type === 'Hike' ? 0.75 : null
    const steps = strideLength && w.distance > 0 ? Math.round(w.distance / strideLength) : null
    return {
      hrMin: hrVals.length ? Math.min(...hrVals) : null,
      hrMax: hrVals.length ? Math.max(...hrVals) : (w.maxHR || null),
      hrAvg: w.avgHR || (hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : null),
      paceMin: paceVals.length ? Math.min(...paceVals) : null,
      paceMax: paceVals.length ? Math.max(...paceVals) : null,
      speedMin: speedVals.length ? Math.min(...speedVals) : null,
      speedMax: speedVals.length ? Math.max(...speedVals) : null,
      elevLoss: Math.round(elevLoss),
      steps,
    }
  }, [w, speedTimeline])

  const smoothPaceTimeline = useMemo(
    () => smoothTimeline(w.paceTimeline.filter(point => point.pace > 0).map(point => ({ t: point.t, value: point.pace })), 10).map(point => ({ t: point.t, pace: point.value })),
    [w.paceTimeline],
  )
  const smoothSpeedTimeline = useMemo(
    () => smoothTimeline(speedTimeline.map(point => ({ t: point.t, value: point.speed })), 10).map(point => ({ t: point.t, speed: point.value })),
    [speedTimeline],
  )

  // --- Playback: drives the map marker and the "draw up to here" chart cursor ---
  const [currentTime, setCurrentTime] = useState(w.duration)
  const [playing, setPlaying] = useState(false)
  const [expanded, setExpanded] = useState<null | 'map' | Metric | 'hrzones'>(null)

  useEffect(() => {
    if (!playing || w.duration <= 0) return
    const totalMs = 15000 // full playback takes 15s of wall-clock time
    const startWall = performance.now()
    const startT = currentTime
    let raf = 0
    function tick(now: number) {
      const elapsed = now - startWall
      const t = Math.min(w.duration, startT + (elapsed / totalMs) * w.duration)
      setCurrentTime(t)
      if (t >= w.duration) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  function handlePlayPause() {
    if (playing) {
      setPlaying(false)
      return
    }
    if (currentTime >= w.duration) setCurrentTime(0)
    setPlaying(true)
  }

  function handleReset() {
    setPlaying(false)
    setCurrentTime(0)
  }

  function handleEnd() {
    setPlaying(false)
    setCurrentTime(w.duration)
  }

  function handleScrub(t: number) {
    setPlaying(false)
    setCurrentTime(Math.max(0, Math.min(w.duration, t)))
  }

  function domainOf(data: number[]): [number, number] {
    if (!data.length) return [0, 1]
    const min = Math.min(...data)
    const max = Math.max(...data)
    const pad = (max - min) * 0.15 || 1
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }

  function valueAtTime<T extends { t: number }>(data: T[], key: keyof T, t: number): number | null {
    if (data.length === 0) return null
    let best = data[0]
    let bestDiff = Math.abs(data[0].t - t)
    for (const d of data) {
      const diff = Math.abs(d.t - t)
      if (diff < bestDiff) {
        bestDiff = diff
        best = d
      }
    }
    return best[key] as unknown as number
  }

  function visibleUpTo<T extends { t: number }>(data: T[], t: number): T[] {
    if (data.length === 0) return []
    const visible = data.filter(d => d.t <= t)
    return visible.length ? visible : [data[0]]
  }

  function startEdit() {
    setEditName(w.name)
    setEditDate(w.date)
    setEditType(w.type)
    setSaveErr(null)
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    setSaveErr(null)
    try {
      const updated = await updateWorkout(w.id, { name: editName.trim(), type: editType, date: editDate })
      setW(updated)
      setEditing(false)
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${w.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await removeWorkout(w.id)
      onBack()
    } catch {
      setDeleting(false)
    }
  }

  function areaChart(opts: {
    data: Array<{ t: number;[k: string]: number }>
    dataKey: string
    stroke: string
    gradId: string
    unit: string
    reversed?: boolean
    yTickFormatter?: (v: number) => string
    height: number
    valueFormatter?: (value: number) => string
  }) {
    const { data, dataKey, stroke, gradId, unit, reversed, yTickFormatter, height, valueFormatter } = opts
    const visible = visibleUpTo(data, currentTime)
    const yDomain = domainOf(data.map(d => d[dataKey]))
    const cursorVal = valueAtTime(data, dataKey as any, currentTime)
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={visible}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
          onClick={(e: any) => { if (e && e.activeLabel != null) handleScrub(Number(e.activeLabel)) }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={stroke} stopOpacity={0.3} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t" type="number" domain={[0, w.duration || 1]}
            tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false} tickFormatter={v => `${Math.floor(v / 60)}m`} interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false} domain={yDomain} reversed={reversed} tickFormatter={yTickFormatter}
          />
          <Tooltip content={<ChartTooltip unit={unit} valueFormatter={valueFormatter} />} />
          <Area type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
          {currentTime > 0 && <ReferenceLine x={currentTime} stroke="var(--text-2)" strokeDasharray="3 3" />}
          {cursorVal != null && <ReferenceDot x={currentTime} y={cursorVal} r={4} fill={stroke} stroke="var(--bg-2)" strokeWidth={2} />}
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  function hrChart(height: number) {
    return areaChart({ data: w.hrTimeline as any, dataKey: 'hr', stroke: '#ef4444', gradId: 'hrGrad', unit: 'bpm', height })
  }
  function paceChart(height: number) {
    return areaChart({ data: smoothPaceTimeline as any, dataKey: 'pace', stroke: color, gradId: 'paceGrad', unit: '/km', valueFormatter: fmtPace, reversed: true, yTickFormatter: v => fmtPace(v), height })
  }
  function speedChart(height: number) {
    return areaChart({ data: smoothSpeedTimeline as any, dataKey: 'speed', stroke: 'var(--blue)', gradId: 'speedGrad', unit: 'km/h', valueFormatter: value => value.toFixed(1), height })
  }
  function elevChart(height: number) {
    return areaChart({ data: w.elevTimeline as any, dataKey: 'elev', stroke: 'var(--hike)', gradId: 'elevGrad', unit: 'm', height })
  }

  function hrZoneChart(height: number) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {hrZones.map(z => (
            <div key={z.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: z.color, flexShrink: 0 }} />
              <span style={{ whiteSpace: 'nowrap' }}>{z.name} · {z.pct}%</span>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={hrZones} dataKey="value" nameKey="name" innerRadius={height * 0.25} outerRadius={height * 0.44} paddingAngle={2}>
              {hrZones.map(z => <Cell key={z.name} fill={z.color} />)}
            </Pie>
            <Tooltip content={<HRZoneTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  function mapCard(height: number | string) {
    return (
      <RouteMap route={w.route} color={trailColor} duration={w.duration} currentTime={currentTime} onScrub={handleScrub} height={height} distance={w.distance} hrTimeline={w.hrTimeline} paceTimeline={w.paceTimeline} elevTimeline={w.elevTimeline} />
    )
  }


  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon" onClick={onBack}><ArrowLeft size={18} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" style={{ minWidth: 160 }} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Workout name" />
                <select className="select" value={editType} onChange={e => setEditType(e.target.value as WorkoutType)}>
                  {WORKOUT_TYPES.map(t => <option key={t} value={t}>{TYPE_ICON[t]} {t}</option>)}
                </select>
                <input className="input" type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                <button className="btn btn-primary" onClick={saveEdit} disabled={saving || !editName.trim()} title="Save">
                  <Check size={14} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving} title="Cancel">
                  <XIcon size={14} />
                </button>
                {saveErr && <span style={{ fontSize: 12, color: '#ef4444' }}>{saveErr}</span>}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{w.name}</h1>
                  <span className={`badge tag-${w.type.toLowerCase()}`}>{TYPE_ICON[w.type]} {w.type}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {new Date(w.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </>
            )}
          </div>
          {!editing && (
            <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <OptionsMenu onEdit={startEdit} onExport={() => exportGPX(w)} onDelete={handleDelete} deleting={deleting} />
            </div>
          )}
        </div>
      </div>

      <div className="page-content">
        {/* Map (flexible width) + Summary card (fixed, narrower) side by
            side on desktop; stacked on mobile so the map never gets
            squeezed. */}
        <div className="detail-top">
          <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative', background: 'var(--bg-3)', display: 'flex', flexDirection: 'column', minHeight: 280 }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {mapCard('100%')}
            </div>
            <button
              className="btn-icon"
              onClick={() => setExpanded('map')}
              title="Expand map"
              style={{ position: 'absolute', top: 10, right: 10, zIndex: 500, background: 'var(--bg-2)', border: '1px solid var(--border)' }}
            >
              <Maximize2 size={14} />
            </button>
          </div>

          {/* Summary: every headline + derived stat grouped by category.
              Values that are not reported directly by the import (or that
              cannot be computed at all) show a dash instead of a misleading
              zero; values derived from recorded samples (rather than
              reported directly by the source) carry a small calculated
              indicator. */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Summary</h3>

            <div className="stat-grid-3">
              <StatChip icon={<Navigation size={12} />} label="Distance" value={w.distance > 0 ? fmtDist(w.distance) : '—'} />
              <StatChip icon={<Clock size={12} />} label="Duration" value={w.duration > 0 ? fmtDuration(w.duration) : '—'} />
              <StatChip icon={<Zap size={12} />} label="Calories" value={w.calories > 0 ? `${w.calories} kcal` : '—'} />
            </div>

            {(w.hrTimeline.length > 0 || w.avgHR > 0) && (
              <div className="stat-grid-3">
                <StatChip icon={<Heart size={12} color="#ef4444" />} label="Min HR" value={derived.hrMin != null ? `${derived.hrMin} bpm` : '—'} />
                <StatChip icon={<Heart size={12} color="#ef4444" />} label="Avg HR" value={derived.hrAvg != null ? `${derived.hrAvg} bpm` : '—'} />
                <StatChip icon={<Heart size={12} color="#ef4444" />} label="Max HR" value={derived.hrMax != null ? `${derived.hrMax} bpm` : '—'} />
              </div>
            )}

            {w.paceTimeline.length > 0 && (
              <div className="stat-grid-3">
                <StatChip icon={<TrendingUp size={12} color={color} />} label="Min Pace" value={derived.paceMin != null ? `${fmtPace(derived.paceMin)} /km` : '—'} calculated={derived.paceMin != null} />
                <StatChip icon={<TrendingUp size={12} color={color} />} label="Avg Pace" value={w.avgPace ? `${fmtPace(w.avgPace)} /km` : '—'} calculated />
                <StatChip icon={<TrendingUp size={12} color={color} />} label="Max Pace" value={derived.paceMax != null ? `${fmtPace(derived.paceMax)} /km` : '—'} calculated={derived.paceMax != null} />
              </div>
            )}

            {speedTimeline.length > 0 && (
              <div className="stat-grid-3">
                <StatChip icon={<Gauge size={12} color="var(--blue)" />} label="Min Speed" value={derived.speedMin != null ? `${derived.speedMin.toFixed(1)} km/h` : '—'} calculated={derived.speedMin != null} />
                <StatChip icon={<Gauge size={12} color="var(--blue)" />} label="Avg Speed" value={w.avgSpeed > 0 ? `${w.avgSpeed.toFixed(1)} km/h` : '—'} calculated />
                <StatChip icon={<Gauge size={12} color="var(--blue)" />} label="Max Speed" value={derived.speedMax != null ? `${derived.speedMax.toFixed(1)} km/h` : '—'} calculated={derived.speedMax != null} />
              </div>
            )}

            <div className="stat-grid-3">
              <StatChip icon={<Mountain size={12} color="var(--hike)" />} label="Elev. Gain" value={w.elevTimeline.length > 0 ? `${Math.round(w.elevationGain)} m` : '—'} />
              <StatChip icon={<Mountain size={12} color="var(--hike)" />} label="Elev. Loss" value={w.elevTimeline.length > 0 ? `${derived.elevLoss} m` : '—'} calculated={w.elevTimeline.length > 0} />
              <StatChip icon={<Footprints size={12} />} label="Steps" value={derived.steps != null ? derived.steps.toLocaleString() : '—'} calculated={derived.steps != null} />
            </div>
          </div>
        </div>

        {/* Playback controls: drives the map marker + chart cursors below */}
        <div className="card" style={{ marginBottom: 16 }}>
          <PlaybackBar
            playing={playing}
            currentTime={currentTime}
            duration={w.duration}
            onPlayPause={handlePlayPause}
            onReset={handleReset}
            onEnd={handleEnd}
            onScrub={handleScrub}
          />
        </div>

        {/* Metric toggle row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {([
            { id: 'hr' as Metric, label: 'Heart Rate', color: '#ef4444', available: w.hrTimeline.length > 0 },
            { id: 'pace' as Metric, label: 'Pace', color: color, available: w.paceTimeline.length > 0 },
            { id: 'speed' as Metric, label: 'Speed', color: 'var(--blue)', available: speedTimeline.length > 0 },
            { id: 'elevation' as Metric, label: 'Elevation', color: 'var(--hike)', available: w.elevTimeline.length > 0 },
          ]).filter(m => m.available).map(m => (
            <button
              key={m.id}
              onClick={() => toggleMetric(m.id)}
              className="btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, fontSize: 12,
                border: `1px solid ${selectedMetrics.includes(m.id) ? m.color : 'var(--border)'}`,
                background: selectedMetrics.includes(m.id) ? `${m.color}18` : 'transparent',
                color: selectedMetrics.includes(m.id) ? m.color : 'var(--text-3)',
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, opacity: selectedMetrics.includes(m.id) ? 1 : 0.3 }} />
              {m.label}
            </button>
          ))}
        </div>

        {/* Charts */}
        <div className="charts-grid">
          {/* Heart Rate chart */}
          {selectedMetrics.includes('hr') && w.hrTimeline.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Heart size={14} color="#ef4444" /> Heart Rate</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>Min {derived.hrMin ?? '—'} · Avg {w.avgHR} · Max {w.maxHR}</span>
                  <button className="btn-icon" onClick={() => setExpanded('hr')} title="Expand"><Maximize2 size={13} /></button>
                </div>
              </div>
              {hrChart(140)}
            </div>
          )}

          {/* Pace chart */}
          {selectedMetrics.includes('pace') && w.paceTimeline.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={14} color={color} /> Pace <CalcIcon /></h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>Min {derived.paceMin != null ? fmtPace(derived.paceMin) : '—'} · Avg {fmtPace(w.avgPace)} · Max {derived.paceMax != null ? fmtPace(derived.paceMax) : '—'} /km</span>
                  <button className="btn-icon" onClick={() => setExpanded('pace')} title="Expand"><Maximize2 size={13} /></button>
                </div>
              </div>
              {paceChart(140)}
            </div>
          )}

          {/* Speed chart */}
          {selectedMetrics.includes('speed') && speedTimeline.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Gauge size={14} color="var(--blue)" /> Speed <CalcIcon /></h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>Min {derived.speedMin?.toFixed(1) ?? '—'} · Avg {w.avgSpeed > 0 ? w.avgSpeed.toFixed(1) : '—'} · Max {derived.speedMax?.toFixed(1) ?? '—'} km/h</span>
                  <button className="btn-icon" onClick={() => setExpanded('speed')} title="Expand"><Maximize2 size={13} /></button>
                </div>
              </div>
              {speedChart(140)}
            </div>
          )}

          {/* Elevation chart */}
          {selectedMetrics.includes('elevation') && w.elevTimeline.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Mountain size={14} color="var(--hike)" /> Elevation</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>+{w.elevationGain} m gain · {derived.elevLoss} m loss</span>
                  <button className="btn-icon" onClick={() => setExpanded('elevation')} title="Expand"><Maximize2 size={13} /></button>
                </div>
              </div>
              {elevChart(140)}
            </div>
          )}

          {/* Heart rate zones */}
          {selectedMetrics.includes('hr') && hrZones.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Heart size={14} color="#ef4444" /> Heart Rate Zones
                </h3>
                <button className="btn-icon" onClick={() => setExpanded('hrzones')} title="Expand"><Maximize2 size={13} /></button>
              </div>
              {hrZoneChart(160)}
            </div>
          )}
        </div>

        {w.notes && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Notes</h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{w.notes}</p>
          </div>
        )}
      </div>

      {expanded === 'map' && (
        <ExpandModal title="Route" onClose={() => setExpanded(null)}>
          <div style={{ marginBottom: 12 }}>
            {mapCard(Math.round(window.innerHeight * 0.6))}
          </div>
          <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
        </ExpandModal>
      )}
      {expanded === 'hr' && (
        <ExpandModal title="Heart Rate" onClose={() => setExpanded(null)}>
          {hrChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'pace' && (
        <ExpandModal title="Pace" onClose={() => setExpanded(null)}>
          {paceChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'speed' && (
        <ExpandModal title="Speed" onClose={() => setExpanded(null)}>
          {speedChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'elevation' && (
        <ExpandModal title="Elevation" onClose={() => setExpanded(null)}>
          {elevChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'hrzones' && (
        <ExpandModal title="Heart Rate Zones" onClose={() => setExpanded(null)}>
          {hrZoneChart(320)}
        </ExpandModal>
      )}
    </div>
  )
}
