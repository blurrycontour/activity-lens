import { useEffect, useMemo, useRef, useState } from 'react'
import { type Workout, type WorkoutType, fmtDuration, fmtDist, fmtPace, TYPE_COLOR } from '../data/workouts'
import TypeIcon from '../components/TypeIcon'
import SportDropdown from '../components/SportDropdown'
import Dropdown from '../components/Dropdown'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, ReferenceLine, ReferenceDot, BarChart, Bar } from 'recharts'
import {
  ArrowLeft, Heart, Mountain, Zap, Clock, TrendingUp, Navigation, Download, Pencil, Trash2, Gauge,
  Check, X as XIcon, Play, Pause, RotateCcw, SkipForward, Maximize2, Sigma, Footprints, MoreVertical, Layers, AlertTriangle, Activity, Share2, Lock, FileDown, Route, Plus,
} from 'lucide-react'
import { useWorkouts } from '../context/WorkoutsContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { downloadWorkoutGPX, downloadWorkoutOriginal, reportSaveFailure } from '../lib/download'
import { useLocalStorage } from '../lib/useLocalStorage'
import { DEFAULT_HR_ZONE_CHART, HR_ZONE_CHART_KEY, type HRZoneChart } from '../lib/dashboardConfig'
import InfoTip from '../components/InfoTip'
import { useIsMobile } from '../lib/useIsMobile'
import UserAvatar, { avatarUrl, userLabel } from '../components/UserAvatar'
import ShareDialog from '../components/ShareDialog'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { divIcon } from 'leaflet'
import type { LatLngBoundsExpression } from 'leaflet'

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

function ManualIcon() {
  return (
    <span title="Entered manually" style={{ display: 'inline-flex', opacity: 0.55 }}>
      <Pencil size={10} />
    </span>
  )
}

function StatChip({ icon, label, value, calculated, manual }: { icon?: React.ReactNode; label: string; value: string; calculated?: boolean; manual?: boolean }) {
  return (
    <div className="stat-grid-item">
      <span className="stat-label">
        {icon}
        {label}
        {manual ? <ManualIcon /> : calculated && <CalcIcon />}
      </span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

function OptionsMenu({ onEdit, onExport, onDownloadOriginal, onShare, onRecalculate, onDelete, deleting }: { onEdit: () => void; onExport: () => void; onDownloadOriginal?: () => void; onShare?: () => void; onRecalculate: () => void; onDelete: () => void; deleting: boolean }) {
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
          <button className="options-menu-item" onClick={() => { setOpen(false); onRecalculate() }}>
            <RotateCcw size={14} /> Recalculate
          </button>
          {onShare && (
            <button className="options-menu-item" onClick={() => { setOpen(false); onShare() }}>
              <Share2 size={14} /> Share
            </button>
          )}
          <button className="options-menu-item" onClick={() => { setOpen(false); onExport() }}>
            <Download size={14} /> Export GPX
          </button>
          {/* Only when an original was actually archived. "Export GPX" above is
              rebuilt from the parsed data; this is the file as imported. */}
          {onDownloadOriginal && (
            <button className="options-menu-item" onClick={() => { setOpen(false); onDownloadOriginal() }}>
              <FileDown size={14} /> Download original
            </button>
          )}
          <button className="options-menu-item danger" onClick={() => { setOpen(false); onDelete() }} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete workout'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The workout's private notes. Always present so there is somewhere obvious to
 * write, rather than a field that only appears once a note exists.
 *
 * Notes never leave the owner: the API redacts them from every response to
 * anyone else, which is why this card is not rendered at all in read-only mode.
 */
function NotesCard({ workout: w, onSaved }: { workout: Workout; onSaved: (w: Workout) => void }) {
  const { updateWorkout } = useWorkouts()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(w.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) areaRef.current?.focus()
  }, [editing])

  function start() {
    setDraft(w.notes ?? '')
    setError(null)
    setEditing(true)
  }

  async function save(next: string) {
    setSaving(true)
    setError(null)
    try {
      onSaved(await updateWorkout(w.id, { notes: next.trim() }))
      setEditing(false)
    } catch {
      setError('Could not save your note.')
    } finally {
      setSaving(false)
    }
  }

  const hasNotes = (w.notes ?? '').trim().length > 0

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          Notes
          <span className="notes-private" title="Notes stay private — they are never included when a workout is shared or made public">
            <Lock size={10} /> Private
          </span>
        </h3>
        {!editing && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={start}>
            {hasNotes ? 'Edit' : 'Add note'}
          </button>
        )}
      </div>

      {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{error}</p>}

      {editing ? (
        <>
          <textarea
            ref={areaRef}
            className="notes-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="How did it feel? Weather, route, niggles, anything worth remembering."
            rows={5}
            disabled={saving}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            {hasNotes && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, marginRight: 'auto', color: 'var(--danger)' }}
                onClick={() => void save('')}
                disabled={saving}
              >
                Remove
              </button>
            )}
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => void save(draft)} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : hasNotes ? (
        <p className="notes-text">{w.notes}</p>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No notes yet.</p>
      )}
    </div>
  )
}

type Metric = 'hr' | 'pace' | 'speed' | 'elevation' | 'cadence'

const CADENCE_COLOR = '#ec4899'

/** Cadence means steps per minute on foot and crank revolutions on a bike. */
function cadenceUnit(type: WorkoutType): string {
  return type === 'Ride' ? 'rpm' : 'spm'
}

const HR_ZONE_COLORS = ['#60a5fa', '#34d399', '#fbbf24', 'var(--danger)', '#a855f7']
const HR_ZONE_LABELS = ['Zone 1 (<60%)', 'Zone 2 (60-70%)', 'Zone 3 (70-80%)', 'Zone 4 (80-90%)', 'Zone 5 (90-100%)']
const HR_ZONE_SHORT = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']

/** Maps a heart rate (bpm) to its zone colour, given the user's max HR. */
function hrZoneColor(hr: number, maxHR: number): string {
  if (maxHR <= 0) return HR_ZONE_COLORS[0]
  const pct = (hr / maxHR) * 100
  const idx = pct < 60 ? 0 : pct < 70 ? 1 : pct < 80 ? 2 : pct < 90 ? 3 : 4
  return HR_ZONE_COLORS[idx]
}

/** Builds vertical gradient stops (top→bottom) that colour an HR line by zone,
 * mapping bpm values within [yMin, yMax] to the 5-zone palette. */
function hrZoneStops(yMin: number, yMax: number, maxHR: number): { offset: number; color: string }[] | null {
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

function hrZoneBuckets(hrTimeline: { t: number; hr: number }[], maxHR: number, totalForPct?: number) {
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
  html: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-label="Start"><circle cx="12" cy="12" r="7" fill="var(--success)" stroke="#fff" stroke-width="2.5"/></svg>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})
const FINISH_MARKER = divIcon({
  className: 'route-pin',
  html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-label="Finish"><path d="M6 21V4" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M6 5h11l-2.2 3.3L17 12H6z" fill="var(--danger)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>',
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

function LayerSwitcher({ layer, onChange, offsetRight = 46 }: {
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

type Shading = 'accent' | 'hr' | 'pace' | 'elevation' | 'cadence'

function RouteMap({
  route, color, duration, currentTime, onScrub, height, distance, hrTimeline, paceTimeline, elevTimeline, cadenceTimeline, avatarUrl, maxHR, cadenceLabel,
  shading, onShadingChange, maximizeButton,
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
    return (stored === 'street' || stored === 'topo' || stored === 'satellite') ? stored : 'satellite'
  })
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  useEffect(() => {
    localStorage.setItem(MAP_LAYER_KEY, layer)
  }, [layer])

  const timeAt = (index: number) => (index / Math.max(route.length - 1, 1)) * duration

  // The moving playback marker shows the user's (minified) profile picture when
  // available, so it reads as "you" tracing the route. Falls back to a plain
  // dot when there's no avatar. Rebuilt only when the avatar/color changes.
  const avatarIcon = useMemo(() => {
    if (!avatarUrl) return null
    return divIcon({
      className: 'route-avatar',
      html: `<img src="${avatarUrl}" width="34" height="34" loading="lazy" decoding="async" style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;border:2.5px solid ${color};box-shadow:0 1px 6px rgba(0,0,0,0.45);background:var(--bg-2)" alt="" />`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    })
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

  if (route.length < 2) {
    return (
      <div style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No route data
      </div>
    )
  }
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
  const exact = fraction * (route.length - 1)
  const i0 = Math.floor(exact)
  const i1 = Math.min(i0 + 1, route.length - 1)
  const between = exact - i0
  const current: [number, number] = [
    route[i0][0] + (route[i1][0] - route[i0][0]) * between,
    route[i0][1] + (route[i1][1] - route[i0][1]) * between,
  ]
  const start = route[0]
  const end = route[route.length - 1]
  const activeLayer = MAP_LAYERS[layer]
  const sampleAt = <T extends { t: number }>(samples: T[], index: number) => samples.reduce<T | null>((closest, sample) => !closest || Math.abs(sample.t - timeAt(index)) < Math.abs(closest.t - timeAt(index)) ? sample : closest, null)

  const selectedTime = selectedPoint == null ? 0 : timeAt(selectedPoint)
  const selectedHR = selectedPoint == null ? null : sampleAt(hrTimeline, selectedPoint)?.hr
  const selectedPace = selectedPoint == null ? null : sampleAt(paceTimeline, selectedPoint)?.pace
  const selectedElev = selectedPoint == null ? null : sampleAt(elevTimeline, selectedPoint)?.elev
  const selectedCad = selectedPoint == null ? null : sampleAt(cadenceTimeline, selectedPoint)?.cad

  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      {maximizeButton}
      <LayerSwitcher layer={layer} onChange={setLayer} offsetRight={maximizeButton ? 46 : 10} />
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
      <MapContainer center={current} zoom={14} style={{ width: '100%', height: '100%' }} scrollWheelZoom attributionControl={false}>
        <TileLayer
          key={layer}
          url={activeLayer.url}
          maxZoom={activeLayer.maxZoom}
        />
        <FitBounds route={route} />
        <MapClickHandler route={route} duration={duration} onScrub={onScrub} onPoint={setSelectedPoint} />
        {shadedSegments.map((seg, index) => <Polyline key={index} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.85 }} />)}
        <Marker position={start} icon={START_MARKER} interactive={false} />
        <Marker position={end} icon={FINISH_MARKER} interactive={false} />
        {avatarIcon
          ? <Marker position={current} icon={avatarIcon} interactive={false} />
          : <CircleMarker center={current} radius={7} pane="markerPane" pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }} />}
        {selectedPoint != null && <Popup position={route[selectedPoint]} closeButton={false} autoPan><div style={{ fontSize: 12, lineHeight: 1.6 }}><strong>{fmtDuration(selectedTime)}</strong><br />Distance {fmtDist((selectedPoint / Math.max(route.length - 1, 1)) * distance)}<br />HR {selectedHR ?? '—'} bpm<br />Pace {selectedPace ? `${fmtPace(selectedPace)} /km` : '—'}<br />Speed {selectedPace ? `${(3600 / selectedPace).toFixed(1)} km/h` : '—'}<br />Elevation {selectedElev ?? '—'} m{cadenceTimeline.length > 0 && <><br />Cadence {selectedCad ?? '—'} {cadenceLabel}</>}</div></Popup>}
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


/**
 * One metric's chart card: title row, then its min/avg/max, then the plot.
 *
 * The readout is on a line of its own rather than sharing the title row. It
 * shared it until now, and on a phone there was never enough width for both —
 * so "Heart Rate" wrapped to two lines to make room for a figure that then
 * wrapped as well. Giving each a full line is also what stops the six cards
 * from disagreeing about their header height.
 *
 * The six charts were six copies of this markup, which is how the expand button
 * ended up in a different place in one of them.
 */
function MetricPanel({ icon, title, badge, info, stats, onExpand, children }: {
  icon: React.ReactNode
  title: string
  /** Marker between title and info tip — the Σ for a derived series. */
  badge?: React.ReactNode
  info: string
  /** Min/avg/max line. Omitted by charts that have nothing to summarise. */
  stats?: React.ReactNode
  onExpand: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card">
      <div className="metric-panel-head">
        <h3 className="metric-panel-title">
          {icon}
          {title}
          {badge}
          <InfoTip label={title} text={info} />
        </h3>
        <button className="btn-icon" onClick={onExpand} title="Expand" aria-label={`Expand ${title}`}>
          <Maximize2 size={13} />
        </button>
      </div>
      {stats && <div className="metric-panel-stats">{stats}</div>}
      {children}
    </div>
  )
}

/** Axis label below the plot, clear of the tick row. Matches Analysis. */
function xLabel(value: string) {
  return { value, position: 'insideBottom' as const, offset: -4, fontSize: 10, fill: 'var(--text-3)' }
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
  const { user } = useAuth()
  const [w, setW] = useState(w0)
  const [sharing, setSharing] = useState(false)
  /**
   * Whether this workout belongs to someone else — it was made public or
   * shared directly with us. Everything stays visible (map, charts, splits);
   * only the controls that would change the owner's data are withheld.
   *
   * List rows carry no `isOwner`, so until the full record loads we fall back
   * to `owner`, which the API sets on feed rows and never on your own.
   */
  const readOnly = w.isOwner === undefined ? w.owner !== undefined : !w.isOwner
  const isMobile = useIsMobile()
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
  const [editCalories, setEditCalories] = useState('')
  const [editSteps, setEditSteps] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [confirmRecalc, setConfirmRecalc] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [recalcErr, setRecalcErr] = useState<string | null>(null)
  const [originalErr, setOriginalErr] = useState<string | null>(null)

  const [selectedMetrics, setSelectedMetrics] = useLocalStorage<Metric[]>('al_wd_metrics', ['hr', 'pace', 'speed', 'elevation'])
  function toggleMetric(m: Metric) {
    setSelectedMetrics(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }
  const [yFromZero, setYFromZero] = useLocalStorage<boolean>('al_y0', false)
  const [hrZoneStyle] = useLocalStorage<HRZoneChart>(HR_ZONE_CHART_KEY, DEFAULT_HR_ZONE_CHART)

  // Equipment editing
  const [allEquipment, setAllEquipment] = useState<import('../lib/api').Equipment[]>([])
  const [editingEquip, setEditingEquip] = useState(false)
  const [equipSel, setEquipSel] = useState<string[]>([])
  const [equipSaving, setEquipSaving] = useState(false)
  useEffect(() => {
    if (readOnly) return
    api.listEquipment().then(setAllEquipment).catch(() => {})
  }, [])
  function startEditEquip() {
    setEquipSel((w.equipment ?? []).map(e => e.id))
    setEditingEquip(true)
  }
  async function saveEquip() {
    setEquipSaving(true)
    try {
      const updated = await updateWorkout(w.id, { equipmentIds: equipSel })
      setW(updated)
      setEditingEquip(false)
    } catch { /* keep editing open on failure */ }
    finally { setEquipSaving(false) }
  }

  const speedTimeline = useMemo(
    () => w.paceTimeline.filter(p => p.pace > 0).map(p => ({ t: p.t, speed: Math.round((3600 / p.pace) * 10) / 10 })),
    [w.paceTimeline],
  )
  // Cadence arrives noisy (a dropped stride shows up as a zero), so zeros are
  // dropped and the series is lightly smoothed the way pace/speed are.
  const cadenceTimeline = useMemo(
    () => smoothTimeline((w.cadenceTimeline ?? []).filter(p => p.cad > 0).map(p => ({ t: p.t, value: p.cad })), 5)
      .map(p => ({ t: p.t, cad: Math.round(p.value) })),
    [w.cadenceTimeline],
  )
  const [prefMaxHr, setPrefMaxHr] = useState(0)
  useEffect(() => {
    let cancelled = false
    api.getPreferences().then(p => { if (!cancelled) setPrefMaxHr(p.maxHr || 0) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const effectiveMaxHR = w.maxHR > 0 ? w.maxHR : prefMaxHr
  const hrZones = useMemo(() => hrZoneBuckets(w.hrTimeline, effectiveMaxHR), [w.hrTimeline, effectiveMaxHR])

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
    const cadVals = cadenceTimeline.map(p => p.cad)
    return {
      cadMin: cadVals.length ? Math.min(...cadVals) : null,
      cadMax: cadVals.length ? Math.max(...cadVals) : null,
      cadAvg: cadVals.length ? Math.round(cadVals.reduce((a, b) => a + b, 0) / cadVals.length) : null,
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
  }, [w, speedTimeline, cadenceTimeline])

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

  /**
   * The same buckets, counting only what has been played so far, so the chart
   * fills as the track runs.
   *
   * Cheap enough to recompute every frame: it is one pass over the heart-rate
   * samples, a few hundred of them, against a 60fps clock that is already
   * re-rendering five other charts. Slicing the samples first would cost the
   * same scan to find where to cut.
   *
   * Percentages stay relative to the whole activity rather than to the part
   * played, so the bars grow instead of rearranging themselves — the shares of
   * a few early samples would otherwise swing wildly and settle only at the end.
   */
  const hrZonesPlayed = useMemo(
    () => hrZoneBuckets(w.hrTimeline.filter(p => p.t <= currentTime), effectiveMaxHR, w.hrTimeline.length),
    [w.hrTimeline, effectiveMaxHR, currentTime],
  )
  const [expanded, setExpanded] = useState<null | 'map' | Metric | 'hrzones'>(null)
  // Lives here rather than in RouteMap: expanding the map mounts a second one,
  // and a choice held inside it was lost on the way.
  const [shading, setShading] = useState<Shading>('accent')

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

  /**
   * Hands back the file this workout was imported from.
   *
   * Failure is worth surfacing rather than swallowing: the menu item only
   * appears when the workout says an original exists, so an error here means
   * something is genuinely wrong — the archive was pruned from the data
   * directory, or the server cannot read it.
   */
  async function downloadOriginal() {
    setOriginalErr(null)
    try {
      await downloadWorkoutOriginal(w)
    } catch (err) {
      setOriginalErr(err instanceof Error ? err.message : 'could not download the original file')
    }
  }

  function startEdit() {
    setEditName(w.name)
    setEditDate(w.date)
    setEditType(w.type)
    setEditCalories(w.calories > 0 ? String(w.calories) : '')
    setEditSteps(w.steps != null && w.steps > 0 ? String(w.steps) : '')
    setSaveErr(null)
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    setSaveErr(null)
    try {
      const updated = await updateWorkout(w.id, {
        name: editName.trim(), type: editType, date: editDate,
        calories: Math.max(0, Math.round(Number(editCalories) || 0)),
        steps: Math.max(0, Math.round(Number(editSteps) || 0)),
      })
      setW(updated)
      setEditing(false)
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function handleRecalculate() {
    setRecalculating(true)
    setRecalcErr(null)
    try {
      const updated = await api.recalcWorkout(w.id)
      setW(updated)
      setConfirmRecalc(false)
    } catch (err) {
      setRecalcErr(err instanceof Error ? err.message : 'Failed to recalculate')
    } finally {
      setRecalculating(false)
    }
  }

  async function handleDelete() {
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
    hrZoneStroke?: boolean
    maxHRForZones?: number
  }) {
    const { data, dataKey, stroke, gradId, unit, reversed, yTickFormatter, height, valueFormatter, hrZoneStroke, maxHRForZones } = opts
    const visible = visibleUpTo(data, currentTime)
    const vals = data.map(d => d[dataKey])
    const yDomain: [number, number] = yFromZero
      ? [0, vals.length ? Math.ceil(Math.max(...vals) * 1.05) || 1 : 1]
      : domainOf(vals)
    const cursorVal = valueAtTime(data, dataKey as any, currentTime)
    const strokeStops = hrZoneStroke && maxHRForZones ? hrZoneStops(yDomain[0], yDomain[1], maxHRForZones) : null
    const strokeColor = strokeStops ? `url(#${gradId}_stroke)` : stroke
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={visible}
          margin={{ top: 4, right: 4, left: -24, bottom: 14 }}
          onClick={(e: any) => { if (e && e.activeLabel != null) handleScrub(Number(e.activeLabel)) }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={stroke} stopOpacity={0.3} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
            {strokeStops && (
              <linearGradient id={`${gradId}_stroke`} x1="0" y1="0" x2="0" y2="1">
                {strokeStops.map((s, i) => <stop key={i} offset={`${(s.offset * 100).toFixed(2)}%`} stopColor={s.color} />)}
              </linearGradient>
            )}
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t" type="number" domain={[0, w.duration || 1]}
            tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false} tickFormatter={v => `${Math.floor(v / 60)}m`} interval="preserveStartEnd"
            label={xLabel('Elapsed time (min)')}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false} domain={yDomain} reversed={reversed} tickFormatter={yTickFormatter}
          />
          <Tooltip content={<ChartTooltip unit={unit} valueFormatter={valueFormatter} />} />
          <Area type="monotone" dataKey={dataKey} stroke={strokeColor} strokeWidth={2} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
          {currentTime > 0 && <ReferenceLine x={currentTime} stroke="var(--text-2)" strokeDasharray="3 3" />}
          {cursorVal != null && <ReferenceDot x={currentTime} y={cursorVal} r={4} fill={stroke} stroke="var(--bg-2)" strokeWidth={2} />}
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  function hrChart(height: number) {
    return areaChart({ data: w.hrTimeline as any, dataKey: 'hr', stroke: 'var(--danger)', gradId: 'hrGrad', unit: 'bpm', height, hrZoneStroke: true, maxHRForZones: effectiveMaxHR })
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
  function cadenceChart(height: number) {
    return areaChart({ data: cadenceTimeline as any, dataKey: 'cad', stroke: CADENCE_COLOR, gradId: 'cadGrad', unit: cadenceUnit(w.type), height })
  }

  function hrZoneChart(height: number) {
    if (hrZoneStyle === 'histogram') {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={hrZonesPlayed} margin={{ top: 4, right: 4, left: -24, bottom: 14 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="short" tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false} label={xLabel('Heart-rate zone')}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false} tickFormatter={v => `${v}%`}
              domain={[0, Math.max(1, ...hrZones.map(z => z.pct))]}
            />
            <Tooltip cursor={{ fill: 'var(--bg-3)' }} content={<HRZoneTooltip />} />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {hrZonesPlayed.map(z => <Cell key={z.name} fill={z.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }
    // Rows come from the whole activity so the legend keeps a fixed set and a
    // stable height; the figures beside them are what has played. Arcs are the
    // played counts, so the ring fills as the track runs.
    const rows = hrZones.filter(z => z.value > 0)
    const playedOf = (name: string) => hrZonesPlayed.find(p => p.name === name)
    const arcs = rows.map(z => ({ ...z, value: playedOf(z.name)?.value ?? 0 })).filter(z => z.value > 0)
    return (
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, width: isMobile ? '100%' : undefined }}>
          {rows.map(z => (
            <div key={z.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: z.color, flexShrink: 0 }} />
              <span style={{ whiteSpace: 'nowrap' }}>{z.name} · {playedOf(z.name)?.pct ?? 0}%</span>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={arcs} dataKey="value" nameKey="name" innerRadius={height * 0.25} outerRadius={height * 0.44} paddingAngle={2} isAnimationActive={false}>
              {arcs.map(z => <Cell key={z.name} fill={z.color} />)}
            </Pie>
            <Tooltip content={<HRZoneTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  /**
   * Whose face rides the route marker: the person who did the workout.
   *
   * `w.owner` is set on anything that came from a feed and never on your own,
   * so it is the right answer whenever it exists — the marker on a workout
   * shared with you was showing *your* avatar running someone else's route.
   *
   * Through avatarUrl() rather than reading avatarPath directly, which is the
   * other half of the same bug: that field is empty for anyone who never
   * uploaded a picture, so the marker simply had no face. The helper falls back
   * to the generated identicon exactly as every other avatar in the app does.
   */
  const routeAvatar = w.owner
    ? avatarUrl(w.owner)
    : user ? avatarUrl(user) : undefined

  function mapCard(height: number | string, maximizeButton?: React.ReactNode) {
    return (
      <RouteMap route={w.route} color={trailColor} duration={w.duration} currentTime={currentTime} onScrub={handleScrub} height={height} distance={w.distance} hrTimeline={w.hrTimeline} paceTimeline={w.paceTimeline} elevTimeline={w.elevTimeline} cadenceTimeline={cadenceTimeline} cadenceLabel={cadenceUnit(w.type)} avatarUrl={routeAvatar} maxHR={effectiveMaxHR} shading={shading} onShadingChange={setShading} maximizeButton={maximizeButton} />
    )
  }


  return (
    <div>
      {confirmRecalc && (
        <div
          onClick={() => { if (!recalculating) setConfirmRecalc(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <div className="card" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: '100%' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <RotateCcw size={16} /> Recalculate workout?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 20 }}>
              This recomputes all derived metrics (calories, steps, heart-rate, pace, speed and elevation)
              from the recorded track and your calorie settings. Any values you entered manually will be
              <strong> overwritten</strong>. The workout's name, type and date are not affected.
            </p>
            {recalcErr && (
              <p style={{ fontSize: 13, color: 'var(--danger, #e5484d)', marginBottom: 12 }}>{recalcErr}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setConfirmRecalc(false)} disabled={recalculating}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRecalculate} disabled={recalculating}>
                {recalculating ? 'Recalculating…' : 'Recalculate'}
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <>
          <div className="overlay" onClick={() => { if (!saving) setEditing(false) }} />
          <div className="modal">
            <div className="modal-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700 }}>Edit Workout</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Update the workout's details</p>
                </div>
                <button className="btn-icon" onClick={() => setEditing(false)} disabled={saving}><XIcon size={16} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Workout Name</label>
                  <input className="input" style={{ width: '100%' }} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Workout name" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Sport Type</label>
                  <SportDropdown value={editType} onChange={setEditType} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Date</label>
                  <input className="input" style={{ width: '100%' }} type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Calories (kcal)</label>
                  <input className="input" style={{ width: '100%' }} type="number" min="0" value={editCalories} onChange={e => setEditCalories(e.target.value)} placeholder="Calories" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Steps</label>
                  <input className="input" style={{ width: '100%' }} type="number" min="0" value={editSteps} onChange={e => setEditSteps(e.target.value)} placeholder="Steps" />
                </div>
              </div>

              {saveErr && (
                <div style={{ display: 'flex', gap: 6, marginTop: 16, alignItems: 'center', color: 'var(--danger)', fontSize: 12 }}>
                  {saveErr}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={saveEdit} disabled={saving || !editName.trim()}>
                  <Check size={14} /> {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {confirmDelete && (
        <>
          <div className="overlay" onClick={() => { if (!deleting) setConfirmDelete(false) }} />
          <div className="modal">
            <div className="modal-box" style={{ maxWidth: 420 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Delete workout?</h3>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 20, lineHeight: 1.5 }}>
                “{w.name}” will be permanently deleted. This cannot be undone.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
                <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon" onClick={onBack}><ArrowLeft size={18} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{w.name}</h1>
              <span className={`badge tag-${w.type.toLowerCase()}`}><TypeIcon type={w.type} size={12} /> {w.type}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {new Date(w.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            {/* Its own line rather than sharing one with the date: a long
                display name would otherwise squeeze the date or wrap raggedly. */}
            {readOnly && w.owner && (
              <span className="owner-byline" style={{ marginTop: 4 }}>
                <span>Shared by</span>
                <UserAvatar user={w.owner} size={20} />
                <span>{userLabel(w.owner)}</span>
              </span>
            )}
          </div>
          <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            {readOnly ? (
              // Export stays available even on someone else's workout: it is a
              // purely client-side render of data already on screen.
              <button className="btn-icon" title="Export as GPX" onClick={() => void downloadWorkoutGPX(w).catch(reportSaveFailure)}>
                <Download size={16} />
              </button>
            ) : (
              <OptionsMenu
                onEdit={startEdit}
                onExport={() => void downloadWorkoutGPX(w).catch(reportSaveFailure)}
                onDownloadOriginal={w.hasOriginal ? downloadOriginal : undefined}
                onShare={() => setSharing(true)}
                onRecalculate={() => { setRecalcErr(null); setConfirmRecalc(true) }}
                onDelete={() => setConfirmDelete(true)}
                deleting={deleting}
              />
            )}
          </div>
        </div>
      </div>

      <div className="page-content">
        {originalErr && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, color: 'var(--danger)', fontSize: 13 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{originalErr}</span>
            <button className="btn-icon" aria-label="Dismiss" onClick={() => setOriginalErr(null)}>
              <XIcon size={14} />
            </button>
          </div>
        )}
        {/* Map (flexible width) + Summary card (fixed, narrower) side by
            side on desktop; stacked on mobile so the map never gets
            squeezed. */}
        <div className="detail-top">
          <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative', background: 'var(--bg-3)', display: 'flex', flexDirection: 'column', minHeight: 280 }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {mapCard('100%', (
                <button
                  className="btn-icon"
                  onClick={() => setExpanded('map')}
                  title="Expand map"
                  aria-label="Expand map"
                  style={{ position: 'absolute', top: 10, right: 10, zIndex: 500, background: 'var(--bg-2)', border: '1px solid var(--border)' }}
                >
                  <Maximize2 size={14} />
                </button>
              ))}
            </div>
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
              {/* Calories are only badged as computed when we estimated them
                  ourselves — TCX files state them outright, and those are as
                  good as any other reported field. */}
              <StatChip icon={<Zap size={12} />} label="Calories" value={w.calories > 0 ? `${w.calories} kcal` : '—'} manual={w.caloriesManual} calculated={!w.caloriesManual && !w.caloriesReported && w.calories > 0} />
            </div>

            {(w.hrTimeline.length > 0 || w.avgHR > 0) && (
              <div className="stat-grid-3">
                <StatChip icon={<Heart size={12} color="var(--danger)" />} label="Min HR" value={derived.hrMin != null ? `${derived.hrMin} bpm` : '—'} />
                <StatChip icon={<Heart size={12} color="var(--danger)" />} label="Avg HR" value={derived.hrAvg != null ? `${derived.hrAvg} bpm` : '—'} />
                <StatChip icon={<Heart size={12} color="var(--danger)" />} label="Max HR" value={derived.hrMax != null ? `${derived.hrMax} bpm` : '—'} />
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

            {cadenceTimeline.length > 0 && (
              <div className="stat-grid-3">
                <StatChip icon={<Activity size={12} color={CADENCE_COLOR} />} label="Min Cadence" value={derived.cadMin != null ? `${derived.cadMin} ${cadenceUnit(w.type)}` : '—'} />
                <StatChip icon={<Activity size={12} color={CADENCE_COLOR} />} label="Avg Cadence" value={derived.cadAvg != null ? `${derived.cadAvg} ${cadenceUnit(w.type)}` : '—'} calculated />
                <StatChip icon={<Activity size={12} color={CADENCE_COLOR} />} label="Max Cadence" value={derived.cadMax != null ? `${derived.cadMax} ${cadenceUnit(w.type)}` : '—'} />
              </div>
            )}

            <div className="stat-grid-3">
              <StatChip icon={<Mountain size={12} color="var(--hike)" />} label="Elev. Gain" value={w.elevTimeline.length > 0 ? `${Math.round(w.elevationGain)} m` : '—'} />
              <StatChip icon={<Mountain size={12} color="var(--hike)" />} label="Elev. Loss" value={w.elevTimeline.length > 0 ? `${derived.elevLoss} m` : '—'} calculated={w.elevTimeline.length > 0} />
              <StatChip icon={<Footprints size={12} />} label="Steps" value={(w.steps ?? 0) > 0 ? w.steps!.toLocaleString() : (derived.steps != null ? derived.steps.toLocaleString() : '—')} manual={w.stepsManual} calculated={!w.stepsManual && ((w.steps ?? 0) > 0 || derived.steps != null)} />
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          {([
            { id: 'hr' as Metric, label: 'Heart Rate', color: 'var(--danger)', available: w.hrTimeline.length > 0 },
            { id: 'pace' as Metric, label: 'Pace', color: color, available: w.paceTimeline.length > 0 },
            { id: 'speed' as Metric, label: 'Speed', color: 'var(--blue)', available: speedTimeline.length > 0 },
            { id: 'elevation' as Metric, label: 'Elevation', color: 'var(--hike)', available: w.elevTimeline.length > 0 },
            { id: 'cadence' as Metric, label: 'Cadence', color: CADENCE_COLOR, available: cadenceTimeline.length > 0 },
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
          <label className="switch" style={{ marginLeft: 'auto' }} title="Start every chart's Y axis at zero">
            <input type="checkbox" checked={yFromZero} onChange={e => setYFromZero(e.target.checked)} />
            <span className="switch-track" />
            Y axis from 0
          </label>
        </div>

        {/* Charts */}
        <div className="charts-grid">
          {selectedMetrics.includes('hr') && w.hrTimeline.length > 0 && (
            <MetricPanel
              icon={<Heart size={14} color="var(--danger)" />}
              title="Heart Rate"
              info="Every heart-rate sample the file recorded, plotted against elapsed time. The line is coloured by training zone using your max HR — from Settings when the activity doesn't report its own. Click anywhere on the chart to move the playback cursor and the map marker to that moment."
              stats={<>Min {derived.hrMin ?? '—'} · Avg {w.avgHR} · Max {w.maxHR} bpm</>}
              onExpand={() => setExpanded('hr')}
            >
              {hrChart(140)}
            </MetricPanel>
          )}

          {selectedMetrics.includes('hr') && hrZones.length > 0 && (
            <MetricPanel
              icon={<Heart size={14} color="var(--danger)" />}
              title="Heart Rate Zones"
              info="How the activity's time split across the five effort zones, as a share of recorded samples. Zones are percentages of your max HR: under 60% is recovery, 60-70% endurance, 70-80% tempo, 80-90% threshold, and above 90% is maximal. Switch between the histogram and donut under Settings → Charts."
              onExpand={() => setExpanded('hrzones')}
            >
              {hrZoneChart(160)}
              {/* The only chart here with no time axis of its own, so it needs
                  the transport to say what "so far" means. */}
              {w.hrTimeline.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
                </div>
              )}
            </MetricPanel>
          )}

          {selectedMetrics.includes('pace') && w.paceTimeline.length > 0 && (
            <MetricPanel
              icon={<TrendingUp size={14} color={color} />}
              title="Pace"
              badge={<CalcIcon />}
              info="Pace derived from the distance and time between consecutive GPS fixes, then smoothed — very few files record pace directly, which is what the Σ marks. Segments shorter than three metres are skipped so standing still doesn't produce wild spikes. Lower on the chart is faster."
              stats={<>Min {derived.paceMin != null ? fmtPace(derived.paceMin) : '—'} · Avg {fmtPace(w.avgPace)} · Max {derived.paceMax != null ? fmtPace(derived.paceMax) : '—'} /km</>}
              onExpand={() => setExpanded('pace')}
            >
              {paceChart(140)}
            </MetricPanel>
          )}

          {selectedMetrics.includes('speed') && speedTimeline.length > 0 && (
            <MetricPanel
              icon={<Gauge size={14} color="var(--blue)" />}
              title="Speed"
              badge={<CalcIcon />}
              info="The same GPS-derived measurement as the pace chart, expressed as km/h instead of minutes per kilometre. It's the more natural read for rides; pace is the more natural read for runs."
              stats={<>Min {derived.speedMin?.toFixed(1) ?? '—'} · Avg {w.avgSpeed > 0 ? w.avgSpeed.toFixed(1) : '—'} · Max {derived.speedMax?.toFixed(1) ?? '—'} km/h</>}
              onExpand={() => setExpanded('speed')}
            >
              {speedChart(140)}
            </MetricPanel>
          )}

          {selectedMetrics.includes('elevation') && w.elevTimeline.length > 0 && (
            <MetricPanel
              icon={<Mountain size={14} color="var(--hike)" />}
              title="Elevation"
              info="Altitude recorded at each track point. Total gain sums only the upward steps between consecutive samples, so barometric noise on a flat route can inflate it slightly. Compare the shape against the heart-rate chart to see what the climbs actually cost you."
              stats={<>+{w.elevationGain} m gain · {derived.elevLoss} m loss</>}
              onExpand={() => setExpanded('elevation')}
            >
              {elevChart(140)}
            </MetricPanel>
          )}

          {selectedMetrics.includes('cadence') && cadenceTimeline.length > 0 && (
            <MetricPanel
              icon={<Activity size={14} color={CADENCE_COLOR} />}
              title="Cadence"
              info="Steps per minute on foot, or crank revolutions per minute on a bike. Foot pods report only one leg, so those values are doubled on import to give the total most trackers show — around 170-180 spm is a common target for runners. The series is lightly smoothed to ride over dropped samples."
              stats={<>Min {derived.cadMin ?? '—'} · Avg {derived.cadAvg ?? '—'} · Max {derived.cadMax ?? '—'} {cadenceUnit(w.type)}</>}
              onExpand={() => setExpanded('cadence')}
            >
              {cadenceChart(140)}
            </MetricPanel>
          )}
        </div>

        {/* Notes are stripped from every response to a non-owner, so a shared
            workout has none to show and no field to offer. */}
        {readOnly
          ? w.notes && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Notes</h3>
              <p className="notes-text">{w.notes}</p>
            </div>
          )
          : <NotesCard workout={w} onSaved={setW} />}

        {!readOnly && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Equipment</h3>
            {!editingEquip && !readOnly && (
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={startEditEquip}>
                {(w.equipment ?? []).length > 0 ? 'Edit' : 'Add'}
              </button>
            )}
          </div>
          {editingEquip ? (
            <>
              {(() => {
                const available = allEquipment.filter(e => !equipSel.includes(e.id))
                return (
                  <>
                    {equipSel.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                        {equipSel.map(id => {
                          const e = allEquipment.find(x => x.id === id)
                          if (!e) return null
                          return (
                            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 12px', borderRadius: 20, fontSize: 12, border: '1px solid var(--primary)', background: 'var(--primary-dim)', color: 'var(--primary)' }}>
                              {e.name}
                              <button
                                type="button"
                                onClick={() => setEquipSel(prev => prev.filter(x => x !== id))}
                                title="Remove"
                                style={{ display: 'inline-flex', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
                              >
                                <XIcon size={13} />
                              </button>
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {allEquipment.length === 0 ? (
                      <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No equipment yet. Add some on the Equipment page.</p>
                    ) : available.length > 0 ? (
                      <Dropdown
                        value=""
                        placeholder="Add equipment…"
                        onChange={id => { if (id) setEquipSel(prev => [...prev, id]) }}
                        block
                        icon={<Plus size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
                        ariaLabel="Add equipment"
                        options={available.map(e => ({ value: e.id, label: e.name }))}
                      />
                    ) : (
                      <p style={{ fontSize: 12, color: 'var(--text-3)' }}>All equipment added.</p>
                    )}
                  </>
                )
              })()}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditingEquip(false)} disabled={equipSaving}>Cancel</button>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => void saveEquip()} disabled={equipSaving}>{equipSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </>
          ) : (w.equipment ?? []).length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(w.equipment ?? []).map(e => (
                <span key={e.id} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, border: '1px solid var(--border)', color: 'var(--text-2)' }}>{e.name}</span>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No equipment linked.</p>
          )}
        </div>
        )}
      </div>

      {sharing && (
        <ShareDialog workout={w} onClose={() => setSharing(false)} />
      )}

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
      {expanded === 'cadence' && (
        <ExpandModal title="Cadence" onClose={() => setExpanded(null)}>
          {cadenceChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'hrzones' && (
        <ExpandModal title="Heart Rate Zones" onClose={() => setExpanded(null)}>
          {hrZoneChart(320)}
          {w.hrTimeline.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <PlaybackBar playing={playing} currentTime={currentTime} duration={w.duration} onPlayPause={handlePlayPause} onReset={handleReset} onEnd={handleEnd} onScrub={handleScrub} />
            </div>
          )}
        </ExpandModal>
      )}
    </div>
  )
}
