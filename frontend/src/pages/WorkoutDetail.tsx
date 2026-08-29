import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LOCATION_EVENT } from '../App'
import { clearDeepLink, deepLinkFor } from '../lib/deepLink'
import { createPortal } from 'react-dom'
import { type RecalcParts, type Workout, type WorkoutType, fmtClock, fmtDuration, fmtDist, fmtPace, TYPE_COLOR } from '../data/workouts'
import TypeIcon from '../components/TypeIcon'
import PageHeader from '../components/PageHeader'
import SportDropdown from '../components/SportDropdown'
import Dropdown from '../components/Dropdown'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, ReferenceLine, ReferenceDot, ReferenceArea, BarChart, Bar } from 'recharts'
import {
  Heart, Mountain, Zap, Clock, TrendingUp, Navigation, Pencil, Trash2, Gauge,
  Check, X as XIcon, Play, Pause as PauseIcon, LoaderCircle, RotateCcw, SkipForward, Maximize2, Sigma, Footprints, MoreVertical, AlertTriangle, Activity, Share2, Lock, FileDown, Plus, Image as ImageIcon, NotebookPen, Images, MessageSquare, ClipboardList, Watch, Undo2, ChevronDown, Thermometer, LineChart, Info } from 'lucide-react'
import { useWorkouts } from '../context/WorkoutsContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { downloadWorkoutOriginal } from '../lib/download'
import { extraSeriesMeta, extraSeriesStats, type ExtraSeriesMeta } from '../lib/extraSeries'
import { lazyChunk } from '../lib/lazyChunk'
import { useLocalStorage } from '../lib/useLocalStorage'
import { DEFAULT_HR_ZONE_CHART, HR_ZONE_CHART_KEY, type HRZoneChart } from '../lib/dashboardConfig'
import InfoTip from '../components/InfoTip'
import WeatherCard from '../components/WeatherCard'
import WorkoutInfoDialog from '../components/WorkoutInfoDialog'
import { usePreferences } from '../context/PreferencesContext'
import { useIsMobile } from '../lib/useIsMobile'
import { usePlayhead, useThrottledPlayhead } from '../lib/playhead'
import { downsample, PLOT_POINTS } from '../lib/downsample'
import { hrZoneBuckets, hrZoneCounter, hrZoneStops } from '../lib/hrZones'
import type { Shading } from '../components/RouteMap'

/**
 * MapLibre is by a wide margin the largest thing this app depends on, and it is
 * needed on exactly one screen — by no one who never opens a workout with a
 * route, which includes everybody on their first load. Splitting it out is what
 * takes the initial bundle from "the whole application" to "the application
 * without a mapping engine in it".
 *
 * Deliberately not preloaded on a hunch. The chart cards render immediately and
 * the map arrives a beat later behind its own placeholder, which is a far
 * better trade than a slower first paint on every page in the app.
 */
const RouteMap = lazy(lazyChunk(() => import('../components/RouteMap')))
import ExpandModal from '../components/ExpandModal'
import TabStrip, { type TabStripItem } from '../components/TabStrip'
import ShareBadge from '../components/ShareBadge'
import { useRefreshHandler } from '../context/RefreshContext'
import { inlineTicks } from '../lib/chartTicks'
const WorkoutGallery = lazy(lazyChunk(() => import('../components/WorkoutGallery')))
const WorkoutSocial = lazy(lazyChunk(() => import('../components/WorkoutSocial')))

/** The sections under the charts. */
type DetailTab = 'notes' | 'gallery' | 'social'
import SessionProfile, { canProfile, type Tint } from '../components/SessionProfile'
import SessionContext from '../components/SessionContext'
import { sessionStanding } from '../lib/standing'
import RecalculateDialog, { defaultRecalcParts } from '../components/RecalculateDialog'
import UserAvatar, { avatarUrl, userLabel } from '../components/UserAvatar'
import ConfirmDialog from '../components/ConfirmDialog'
import MenuButton from '../components/MenuButton'
import WorkoutReshape, { emptyPlan, planChanges, presentStreams, type ReshapePlan } from '../components/WorkoutReshape'
import ShareDialog from '../components/ShareDialog'
import ShareCardDialog from '../components/ShareCardDialog'
import Modal from '../components/Modal'
import { END_PADDING } from '../components/ChartAxis'
import { fromDateKey, longDate } from '../lib/date'

interface WorkoutDetailProps {
  workout: Workout
  accent?: string
  onBack: () => void
  /** Opens Settings, for the weather panel's "turn it on" link. */
  onOpenSettings?: () => void
  /** Opens another member's profile, from the byline on their workout. */
  onOpenUser?: (id: number) => void
}

/** Small marker shown next to stat values that are derived from recorded
 * samples rather than reported directly by the imported source. */
function CalcIcon({ title = 'Calculated from recorded data' }: { title?: string } = {}) {
  return (
    <span title={title} style={{ display: 'inline-flex', opacity: 0.55 }}>
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

function OptionsMenu({ onEdit, onInfo, onDownloadOriginal, onRestore, onShare, onShareCard, onRecalculate, onDelete, deleting }: { onEdit: () => void; onInfo: () => void; onDownloadOriginal?: () => void; onRestore?: () => void; onShare?: () => void; onShareCard: () => void; onRecalculate: () => void; onDelete: () => void; deleting: boolean }) {
  return (
    <MenuButton icon={<MoreVertical size={18} />} label="Workout options">
      <button className="options-menu-item" onClick={onEdit}>
        <Pencil size={14} /> Edit workout
      </button>
      <button className="options-menu-item" onClick={onRecalculate}>
        <RotateCcw size={14} /> Recalculate
      </button>
      {/* Below the two that change the workout and above the ones that send it
          somewhere: this only reads. */}
      <button className="options-menu-item" onClick={onInfo}>
        <Info size={14} /> Details
      </button>
      {onShare && (
        <button className="options-menu-item" onClick={onShare}>
          <Share2 size={14} /> Share
        </button>
      )}
      {/* Always offered, unlike Share above: that one publishes a link and
          needs the workout to be shareable, this one makes a picture out of
          what is already on screen and needs nothing from the server. */}
      <button className="options-menu-item" onClick={onShareCard}>
        <ImageIcon size={14} /> Share card
      </button>
      {/* The file as it was imported, when the instance archived it. There is
          no rebuilt-GPX export beside it any more: it was assembled from the
          parsed route, so a treadmill run or an indoor ride — which have no
          route at all — exported an empty document that looked like a working
          feature until somebody opened it. A FIT import makes that worse, not
          better: what it would throw away now includes power. */}
      {onDownloadOriginal && (
        <button className="options-menu-item" onClick={onDownloadOriginal}>
          <FileDown size={14} /> Download original
        </button>
      )}
      {/* The undo for a trim or a removal, and only offered when there is a
          file to undo from — the archive is an admin setting, so plenty of
          workouts have none. */}
      {onRestore && (
        <button className="options-menu-item" onClick={onRestore}>
          <Undo2 size={14} /> Restore from original
        </button>
      )}
      <button className="options-menu-item danger" onClick={onDelete} disabled={deleting}>
        <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete workout'}
      </button>
    </MenuButton>
  )
}

/**
 * The workout's private notes. Always present so there is somewhere obvious to
 * write, rather than a field that only appears once a note exists.
 *
 * Notes never leave the owner: the API redacts them from every response to
 * anyone else, which is why this panel is not rendered at all in read-only mode.
 *
 * It lives inside the Notes tab, which already names it and draws the surface
 * around it — so no card and no heading here, only the one thing the tab label
 * cannot say: that what you write stays yours.
 */
function NotesPanel({ workout: w, onSaved }: { workout: Workout; onSaved: (w: Workout) => void }) {
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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span className="notes-private" title="Notes stay private — they are never included when a workout is shared or made public">
          <Lock size={10} /> Private
        </span>
        {!editing && (
          <button className="btn btn-ghost btn-section" onClick={start}>
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

/*
 * Which charts a workout can show.
 *
 * Five fixed, plus one per named series the file happened to carry. The extras
 * are prefixed rather than bare so a future series called "pace" cannot collide
 * with the real one, and so a stored selection can always be told apart from a
 * metric this build no longer has.
 */
type Metric = 'hr' | 'pace' | 'speed' | 'elevation' | 'cadence' | `extra:${string}`

/* A token rather than the literal #ec4899 it was, which followed neither theme.
   --strength is that pink and carries a light-mode variant; cadence is not a
   sport, but this chart never shows a sport beside it, and the alternative is a
   hex that is right in one of the eighteen theme-and-accent combinations. */
const CADENCE_COLOR = 'var(--strength)'

/**
 * The mark for a named series.
 *
 * By name, with a fallback, for the same reason the labels are: the server can
 * send a series this build has never heard of, and a missing icon should be a
 * generic one rather than a hole in the panel header.
 */
function ExtraSeriesIcon({ name, color }: { name: string; color: string }) {
  if (name === 'power') return <Zap size={14} color={color} />
  if (name === 'temperature') return <Thermometer size={14} color={color} />
  return <LineChart size={14} color={color} />
}

/** Min, average and max under a named series' chart, in its own unit. */
function ExtraStats({ points, meta }: { points: { v: number }[]; meta: ExtraSeriesMeta }) {
  const stats = extraSeriesStats(points)
  if (!stats) return null
  const n = (v: number) => v.toFixed(meta.decimals)
  return <>Min {n(stats.min)} · Avg {n(stats.avg)} · Max {n(stats.max)} {meta.unit}</>
}

/** Cadence means steps per minute on foot and crank revolutions on a bike. */
function cadenceUnit(type: WorkoutType): string {
  return type === 'Ride' ? 'rpm' : 'spm'
}



function smoothTimeline(data: Array<{ t: number; value: number }>, radius = 3) {
  return data.map((point, index) => {
    const first = Math.max(0, index - radius)
    const last = Math.min(data.length, index + radius + 1)
    const values = data.slice(first, last)
    return { ...point, value: values.reduce((total, sample) => total + sample.value, 0) / values.length }
  })
}


/** The props every copy of the bar is handed, so eleven call sites cannot drift. */
interface PlaybackProps {
  playing: boolean
  currentTime: number
  duration: number
  onPlayPause: () => void
  onReset: () => void
  onEnd: () => void
  onScrub: (t: number) => void
}

/**
 * The transport: play, reset, jump to end, a scrub bar and the clock.
 *
 * One line and one shape everywhere it appears — docked on a phone, in the
 * card beside the map on a desktop, and under every expanded chart and map.
 * It used to have a roomier variant that stacked onto two rows in a narrow
 * card and printed "4:27:37 / 4:27:37"; the docked copy needed neither, and
 * once the sleek one existed there was no reason for the page to show two
 * different players depending on where you met it.
 *
 * The clock is the elapsed time alone. The total is what the end of the scrub
 * bar means, and seventeen characters of "x / y" is what forced the two-row
 * layout in the first place. Nothing is lost to a screen reader: the slider's
 * aria-valuetext still announces both.
 */
function PlaybackBar({
  playing, currentTime, duration, onPlayPause, onReset, onEnd, onScrub,
}: PlaybackProps) {
  return (
    <div className="playback-bar">
      <div className="playback-controls">
        <button className="btn-icon playback-play" onClick={onPlayPause} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseIcon size={16} /> : <Play size={16} />}
        </button>
        <button className="btn-icon" onClick={onReset} title="Reset" aria-label="Reset">
          <RotateCcw size={16} />
        </button>
        <button className="btn-icon" onClick={onEnd} title="Jump to end" aria-label="Jump to end">
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
        aria-label="Position in workout"
        /* Without this a screen reader announces the raw sample index — "7268" —
           which is the one number on this control that means nothing to anyone. */
        aria-valuetext={`${fmtDuration(currentTime)} of ${fmtDuration(duration)}`}
        style={{ flex: 1, accentColor: 'var(--primary)' }}
      />
      <span className="playback-clock">{fmtDuration(currentTime)}</span>
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
/**
 * A time label that does not hang off the end of the plot.
 *
 * The first and last tick sit exactly on the domain's edges, and a centred
 * label there puts half of "0:00" outside the drawing — which on a phone, where
 * the plot runs to the card's edge, means half of it is simply cut off. Recharts
 * nudges end labels inward on a *category* axis, by measuring them; this is a
 * numeric axis, where it does not, which is why the margin added earlier did
 * not help.
 *
 * So the two ends anchor to their own edge instead of to their centre, and
 * every label in between stays centred where it belongs.
 */
function EdgeTick(props: {
  // Supplied by Recharts, which passes the axis's own formatter down with them.
  x?: number
  y?: number
  index?: number
  visibleTicksCount?: number
  payload?: { value: number }
  tickFormatter?: (value: number, index: number) => string
}) {
  const { x, y, payload, index = 0, visibleTicksCount = 0 } = props
  if (!payload) return null
  const last = index === visibleTicksCount - 1
  const anchor = index === 0 ? 'start' : last ? 'end' : 'middle'
  return (
    <text
      x={x} y={y} dy={10}
      textAnchor={anchor}
      fontSize={10}
      fontFamily="var(--font-mono)"
      fill="var(--text-3)"
    >
      {props.tickFormatter ? props.tickFormatter(payload.value, index) : payload.value}
    </text>
  )
}

/**
 * The tab a deep link asked for, read once when the page mounts.
 *
 * Validated against the known set rather than trusted: this comes from a URL,
 * and an unknown value would leave the strip with no tab selected at all. An
 * absent or unrecognised parameter means the default, which is what every
 * ordinary visit gets.
 */
function askedTab(tab: string | null): DetailTab | null {
  return tab === 'gallery' || tab === 'social' || tab === 'notes' ? tab : null
}

/**
 * The tab body, whose top edge never moves.
 *
 * The panels are different sizes and load at different times, so switching
 * used to change the page's height twice — down to a spinner, then up to the
 * content. This is the last section on the page, so those changes do not push
 * anything below them around; what they do is make the *document* shorter,
 * and a reader scrolled near the bottom then has their scroll position
 * clamped by the browser. That is not a layout shift you can see the cause of.
 * It reads as the page sliding out from under you, and it was worst switching
 * to Social because Social differs most in height from the other two.
 *
 * So the panel keeps a high-water mark: the tallest its content has been on
 * this workout, applied as a minimum and never lowered. Every switch after the
 * first therefore grows the panel or leaves it alone, and the page never gets
 * shorter while you are reading it.
 *
 * The mark is bounded by the viewport, which is the one concession. Without a
 * bound, opening a gallery of thirty photos would leave that much blank space
 * under a three-line note forever. Below the bound — where all three panels
 * normally sit — nothing moves at all; above it the page is already longer
 * than the screen, so the tab strip is not on it to be watched.
 *
 * Measured on an inner element that never carries the minimum. Measuring the
 * element the minimum is applied to would just read the minimum back and the
 * mark could only ever grow.
 */
function TabPanel({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [floor, setFloor] = useState(0)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const bump = () => {
      const cap = Math.round(window.innerHeight * 0.8)
      const height = Math.min(el.offsetHeight, cap)
      setFloor(prev => (height > prev ? height : prev))
    }
    bump()
    const obs = new ResizeObserver(bump)
    obs.observe(el)
    // A rotation or a window drag changes the cap, not just the content.
    window.addEventListener('resize', bump)
    return () => {
      obs.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [])

  return (
    <div className="card detail-tab-panel" style={floor ? { minHeight: floor } : undefined}>
      <div ref={box}>{children}</div>
    </div>
  )
}

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
    // The header keeps the card's padding; the plot does not. It runs to the
    // card's own edges and is clipped by its corner radius, so the area fill
    // becomes part of the card rather than a picture placed on it — and on a
    // phone that is nearly half again the plot width, taken back from a gutter
    // that was drawing nothing. See metric-panel-plot.
    <div className="card metric-panel">
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
      <div className="metric-panel-plot">{children}</div>
    </div>
  )
}

/**
 * The break glyph in the middle of a pause band.
 *
 * Drawn only when the band is wide enough to hold it. A two-pixel band on a
 * long workout would otherwise get a mark wider than the thing it marks, which
 * reads as a data point rather than as a gap.
 */
function PauseMark({ viewBox }: { viewBox?: { x: number; y: number; width: number; height: number } }) {
  if (!viewBox || viewBox.width < 14) return null
  const cx = viewBox.x + viewBox.width / 2
  const cy = viewBox.y + viewBox.height / 2
  return (
    <g pointerEvents="none">
      <rect x={cx - 4} y={cy - 6} width={3} height={12} rx={1} fill="var(--text-3)" fillOpacity={0.75} />
      <rect x={cx + 1.5} y={cy - 6} width={3} height={12} rx={1} fill="var(--text-3)" fillOpacity={0.75} />
    </g>
  )
}

/** Axis label below the plot, clear of the tick row. Matches Analysis. */
function xLabel(value: string) {
  return { value, position: 'insideBottom' as const, offset: -4, fontSize: 10, fill: 'var(--text-3)' }
}

function ChartTooltip({ active, payload, label, unit, valueFormatter }: { active?: boolean; payload?: any[]; label?: string; unit: string; valueFormatter?: (value: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>{fmtClock(Number(label))}</div>
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


/**
 * A series prepared for plotting: reduced to a drawable number of points, with
 * its extremes measured once.
 *
 * Both halves exist for the same reason. During playback these charts re-render
 * on every frame, and everything derived from the full series — the reduction,
 * the y-domain — is identical on every one of those frames. Doing it here means
 * a frame costs a slice and a render rather than several passes over an hour of
 * samples, per chart.
 */
interface PlotSeries {
  points: Array<{ t: number;[k: string]: number }>
  min: number
  max: number
  count: number
}

function preparePlot<T extends { t: number }>(data: T[], key: string): PlotSeries {
  const rows = data as unknown as Array<{ t: number;[k: string]: number }>
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    const v = row[key]
    if (v < min) min = v
    if (v > max) max = v
  }
  return {
    points: downsample(rows, d => d[key], PLOT_POINTS),
    min: rows.length ? min : 0,
    max: rows.length ? max : 1,
    count: rows.length,
  }
}

export default function WorkoutDetail({ workout: w0, accent, onBack, onOpenSettings, onOpenUser }: WorkoutDetailProps) {
  const { updateWorkout, removeWorkout, refresh: refreshLibrary, workouts: library } = useWorkouts()
  const { user } = useAuth()
  const [w, setW] = useState(w0)
  /*
   * The page can be opened from a list row, which carries no timelines and no
   * route, and be handed the full record a moment later. Keyed by id, this
   * component does not remount for that, so without this it would keep showing
   * the summary it started with — an empty map and no charts on a workout that
   * has both.
   *
   * Guarded on identity, so a re-render of the parent never resets an edit in
   * progress: the prop only changes identity when the workout is refetched or
   * reselected.
   */
  const seeded = useRef(w0)
  useEffect(() => {
    if (w0 === seeded.current) return
    seeded.current = w0
    setW(w0)
  }, [w0])
  const [sharing, setSharing] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  /**
   * Whether this workout belongs to someone else — it was made public or
   * shared directly with us. Everything stays visible (map, charts, splits);
   * only the controls that would change the owner's data are withheld.
   *
   * List rows carry no `isOwner`, so until the full record loads we fall back
   * to `owner`, which the API sets on feed rows and never on your own.
   */
  /**
   * Whether this workout belongs to somebody else.
   *
   * `isOwner` is authoritative but only single-workout responses carry it, so a
   * row opened from a list is judged by whether it names an author — with one
   * exception: an author who is *you*. A list that attaches your own name would
   * otherwise open your workout as a guest's view, captioned "Shared by <you>",
   * until the full fetch arrived and took it back. The server does not send
   * that any more; this makes it harmless if it ever does again.
   */
  const readOnly = w.isOwner === undefined
    ? w.owner !== undefined && w.owner.id !== user?.id
    : !w.isOwner
  // Undefined while preferences load, and on a server too old to send the
  // field. Both mean "assume on", which matches the server default — the
  // alternative is telling the user their lookups are off when they are not.
  const { prefs } = usePreferences()
  const isMobile = useIsMobile()
  const color = TYPE_COLOR[w.type]
  const trailColor = accent || color

  // List views only carry summary fields (no route/timelines) for
  // efficiency, so if we were handed a summary-only workout, fetch the full
  // record before rendering the map/charts (otherwise they'd stay blank
  // until an unrelated re-render happened to bring in the full data).
  //
  // `hydrating` is what the map and the charts show a spinner for meanwhile. On
  // a long workout the request is several hundred kilobytes of samples and
  // takes long enough to see, and the panels' own empty states say "no route
  // data" — which is a statement about the workout, not about the wait, and it
  // is wrong.
  const [hydrating, setHydrating] = useState(false)
  useEffect(() => {
    if (w0.route.length > 0 || w0.hrTimeline.length > 0 || w0.paceTimeline.length > 0 || w0.elevTimeline.length > 0) return
    let cancelled = false
    setHydrating(true)
    api.getWorkout(w0.id)
      .then(full => { if (!cancelled) setW(full) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHydrating(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The page owns this workout, so a pull has to refetch it — otherwise the
  // gesture does nothing on the one screen where a comment or a photo someone
  // else just added is exactly what you pulled to see.
  useRefreshHandler(useCallback(async () => {
    try { setW(await api.getWorkout(w0.id)) } catch { /* keep what is on screen */ }
  }, [w0.id]))

  const [editing, setEditing] = useState(false)
  /**
   * The staged trim and stream removals. Held beside the other edit fields and
   * applied only on Save, so nothing here touches the workout until asked.
   */
  const [plan, setPlan] = useState<ReshapePlan>(() => emptyPlan(w))
  // Raised on Save when the plan would destroy something, naming what.
  const [confirmReshape, setConfirmReshape] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [editName, setEditName] = useState(w.name)
  const [editDate, setEditDate] = useState(w.date)
  const [editType, setEditType] = useState<WorkoutType>(w.type)
  const [editCalories, setEditCalories] = useState('')
  const [editSteps, setEditSteps] = useState('')
  // Kilometres, because that is the unit on every other screen. A treadmill
  // export often states a total the app cannot derive — the track points carry
  // heart rate and time and no position at all — and sometimes states nothing.
  const [editDistance, setEditDistance] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [confirmRecalc, setConfirmRecalc] = useState(false)
  /*
   * What a recalculation will replace.
   *
   * Everything the app can derive on its own, which is what it always did —
   * but each one is now refusable, because the operation overwrites
   * hand-entered figures and there was no way to ask for the pauses on an old
   * workout without also losing a corrected calorie count. The one part that
   * fetches from outside is the exception and starts unticked; the dialog owns
   * that rule, since it owns the list.
   */
  const [recalcParts, setRecalcParts] = useState<RecalcParts>(defaultRecalcParts)
  const [recalculating, setRecalculating] = useState(false)
  const [recalcErr, setRecalcErr] = useState<string | null>(null)
  const [originalErr, setOriginalErr] = useState<string | null>(null)

  // The key carries a version because the default changed: cadence used to be
  // off, and a workout that recorded it showed nothing until you found the
  // toggle. Bumping the key is what lets an existing install pick the new
  // default up — the cost is one forgotten customisation, once.
  const [selectedMetrics, setSelectedMetrics] = useLocalStorage<Metric[]>('al_wd_metrics_v2', ['hr', 'pace', 'speed', 'elevation', 'cadence'])
  function toggleMetric(m: Metric) {
    setSelectedMetrics(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }
  /*
   * Which extra series have been switched off, rather than which are on.
   *
   * The five fixed metrics are a stored selection, which works because the set
   * never changes. These come from the file, so a stored list of "on" would
   * mean every series the app meets for the first time is invisible until
   * somebody finds the toggle — the exact bug that made cadence look missing
   * and cost a storage-key bump to fix. Stored by name, so switching power off
   * on one ride switches it off on the next.
   */
  const [hiddenExtras, setHiddenExtras] = useLocalStorage<string[]>('al_wd_extras_off', [])
  const extraOn = (key: string) => !hiddenExtras.includes(key)
  function toggleExtra(key: string) {
    setHiddenExtras(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }
  const [yFromZero, setYFromZero] = useLocalStorage<boolean>('al_y0', false)
  const [showPauses, setShowPauses] = useLocalStorage<boolean>('al_show_pauses', true)
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
  /*
   * The stretches where the recording stopped.
   *
   * Empty for a workout imported before the server detected these, until it is
   * recalculated — and empty is also the honest answer for one that ran
   * straight through, so nothing here needs to tell the two apart. `movingTime`
   * does, and the summary uses it.
   */
  const pauses = useMemo(() => w.pauses ?? [], [w.pauses])

  const cadenceTimeline = useMemo(
    () => smoothTimeline((w.cadenceTimeline ?? []).filter(p => p.cad > 0).map(p => ({ t: p.t, value: p.cad })), 5)
      .map(p => ({ t: p.t, cad: Math.round(p.value) })),
    [w.cadenceTimeline],
  )
  /**
   * The ceiling the five HR zones are percentages of.
   *
   * The athlete's, not this workout's. Reading `w.maxHR` first — which is
   * simply the hardest moment of this one activity — is what made every
   * workout end in Zone 5 and none of them comparable to each other: an easy
   * hour that peaked at 137 was drawn with the same top zone as an interval
   * session that peaked at 180.
   *
   * `athleteMaxHr` is the owner's configured value, or the one their age
   * implies, and it arrives with the workout so that a workout shared by
   * someone else is measured against *them*. The old code asked the API for
   * the signed-in viewer's preferences instead, which is the wrong person on
   * every shared workout.
   *
   * The workout's own peak survives only as the last resort, for an owner who
   * has set neither a max HR nor a birth year. It is a poor ceiling, but it is
   * better than a chart with no zones at all.
   */
  const effectiveMaxHR = w.athleteMaxHr && w.athleteMaxHr > 0 ? w.athleteMaxHr : w.maxHR
  const hrZones = useMemo(() => hrZoneBuckets(w.hrTimeline, effectiveMaxHR), [w.hrTimeline, effectiveMaxHR])

  /**
   * What fills the panel beside the summary.
   *
   * A ladder rather than a branch on activity type: what a workout has is a
   * fact about the file, and a treadmill run with a stray GPS fix should get a
   * map exactly as an outdoor one does. Each rung asks only whether it has
   * anything to say.
   *
   * The profile needs a maximum heart rate to name zones against, so a library
   * whose owner has not set one — and whose watch did not report one — drops to
   * the standing panel rather than colouring the whole band Zone 1.
   */
  /*
   * The named series this workout carries, in a stable order.
   *
   * Sorted by name rather than left in the object's own order: a map from JSON
   * has whatever order the server serialised, and charts that swap places
   * between two loads of the same page look like a bug.
   */
  const extraSeries = useMemo(() => {
    const out: Array<{ key: string; meta: ReturnType<typeof extraSeriesMeta>; points: Array<{ t: number; v: number }> }> = []
    for (const [key, points] of Object.entries(w.extraSeries ?? {})) {
      if (!points || points.length === 0) continue
      out.push({ key, meta: extraSeriesMeta(key), points })
    }
    return out.sort((a, b) => a.meta.label.localeCompare(b.meta.label))
  }, [w.extraSeries])

  const extraPlots = useMemo(
    () => Object.fromEntries(extraSeries.map(e => [e.key, preparePlot(e.points, 'v')])),
    [extraSeries],
  )

  /**
   * Whether there is anything for the playhead to drive.
   *
   * The transport moves a marker along a route and a cursor along the charts.
   * A workout entered by hand, or imported with nothing but a duration, has
   * neither — so the controls were a play button that made a number count up
   * and nothing else move. Hidden rather than disabled: a disabled control is
   * a promise that something would happen if only you were allowed, and here
   * there is nothing to allow.
   */
  const hasSeries =
    w.hrTimeline.length > 0 || w.paceTimeline.length > 0 || speedTimeline.length > 0
    || w.elevTimeline.length > 0 || cadenceTimeline.length > 0 || extraSeries.length > 0
  const playable = w.route.length >= 2 || hasSeries || hydrating

  /** Where this workout stands among the others of its sport. See standing.ts. */
  const standing = useMemo(() => sessionStanding(library, w), [library, w])

  const hero: 'map' | 'profile' | 'context' | 'none' =
    w.route.length >= 2 || hydrating ? 'map'
      : canProfile(w.duration, w.hrTimeline, cadenceTimeline) ? 'profile'
        : standing.length > 0 ? 'context'
          : 'none'

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
    // Mirrors estimateSteps on the server, including Other — see onFoot there
    // for why an unclassified activity is treated as walked.
    const strideLength = w.type === 'Run' ? 1.0 : w.type === 'Hike' || w.type === 'Other' ? 0.75 : null
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


  // Rebuilt only when a series actually changes, never per playback frame.
  const plots = useMemo(() => ({
    hr: preparePlot(w.hrTimeline, 'hr'),
    pace: preparePlot(smoothPaceTimeline, 'pace'),
    speed: preparePlot(smoothSpeedTimeline, 'speed'),
    elev: preparePlot(w.elevTimeline, 'elev'),
    cad: preparePlot(cadenceTimeline, 'cad'),
  }), [w.hrTimeline, w.elevTimeline, smoothPaceTimeline, smoothSpeedTimeline, cadenceTimeline])

  // --- Playback: drives the map marker and the "draw up to here" chart cursor ---
  //
  // Two rates, deliberately. `playhead` is exact and updates every frame; the
  // map marker rides it without React involved. `currentTime` is a throttled
  // copy for everything that costs a render — see lib/playhead.
  const [playing, setPlaying] = useState(false)
  const playhead = usePlayhead(w.duration)
  const currentTime = useThrottledPlayhead(playhead, playing)

  /**
   * The same buckets, counting only what has been played so far, so the chart
   * fills as the track runs.
   *
   * Built once per activity and then queried per frame: the counts are
   * cumulative, so asking about a later moment is a binary search and five
   * array reads rather than another two passes over the samples.
   */
  const countZonesTo = useMemo(
    () => hrZoneCounter(w.hrTimeline, effectiveMaxHR),
    [w.hrTimeline, effectiveMaxHR],
  )
  const hrZonesPlayed = useMemo(() => countZonesTo(currentTime), [countZonesTo, currentTime])
  const [expanded, setExpanded] = useState<null | 'map' | 'session' | Metric | 'hrzones'>(null)
  // Lives here rather than in RouteMap: expanding the map mounts a second one,
  // and a choice held inside it was lost on the way.
  const [shading, setShading] = useState<Shading>('accent')
  /** What the no-route session drawing is coloured by. See SessionProfile. */
  const [tint, setTint] = useState<Tint>('hr')

  /*
   * The tabs under the charts.
   *
   * Not remembered across workouts. The obvious thing is to persist the choice,
   * and it is wrong here: the tabs are not the same set on every workout — a
   * shared one has no Notes — so a remembered tab is regularly a tab that is
   * not there, and landing on Gallery every time would fetch photos for someone
   * who opened the page to read the charts.
   */
  const [detailTab, setDetailTab] = useState<DetailTab>(() => askedTab(deepLinkFor(w0.id).tab) ?? 'notes')
  /**
   * The comment a notification pointed at, until the Social panel has found it.
   *
   * Held here rather than read from the URL by the panel, because the URL is
   * cleared as soon as the link is acted on — a reload should be the page you
   * were on, not the comment you were once sent to — while the panel may not
   * have loaded its thread yet.
   */
  const [focusComment, setFocusComment] = useState<string | null>(() => deepLinkFor(w0.id).commentId)
  /*
   * What is behind Gallery and Social, so the strip can say so before either
   * is opened. Both panels are lazy and fetch nothing until their tab is
   * selected, so the only way to learn a tab is empty was to open it.
   *
   * Seeded from the workout — the detail response carries the same two counts
   * a library row does — and then kept live by the panels themselves, because
   * adding a photo while looking at it must not leave the badge behind.
   */
  const [counts, setCounts] = useState({ photos: w.photoCount ?? 0, comments: w.commentCount ?? 0 })
  const onPhotoCount = useCallback((n: number) => setCounts(c => (c.photos === n ? c : { ...c, photos: n })), [])
  const onCommentCount = useCallback((n: number) => setCounts(c => (c.comments === n ? c : { ...c, comments: n })), [])
  /*
   * The seed above is whatever the list row carried, which is nothing at all
   * when the page was opened from a URL or a notification rather than from the
   * library. Re-taken whenever the workout is refetched, because the server has
   * just counted where the panel's figure is as old as the last time its tab
   * was open.
   *
   * `undefined` is "no opinion", not zero. Only the GET carries these — a PATCH
   * answers with the updated workout and both fields `omitempty` away — so
   * reading an absent field as a count would have renaming a workout clear the
   * badges off both its tabs.
   */
  useEffect(() => {
    setCounts(c => {
      const photos = w.photoCount ?? c.photos
      const comments = w.commentCount ?? c.comments
      return c.photos === photos && c.comments === comments ? c : { photos, comments }
    })
  }, [w.photoCount, w.commentCount])
  const sectionsRef = useRef<HTMLDivElement>(null)

  // Notes belong to the owner alone and are stripped from a shared response, so
  // there is nothing behind that tab for anyone else — and a viewer whose
  // first tab does not exist would land on an empty panel, hence the fallback.
  const detailTabs: TabStripItem<DetailTab>[] = [
    ...(readOnly ? [] : [{ id: 'notes' as DetailTab, label: 'Notes', icon: <NotebookPen size={14} /> }]),
    { id: 'gallery' as DetailTab, label: 'Gallery', icon: <Images size={14} />, count: counts.photos },
    // Only on a workout somebody else can see. A private one has no audience,
    // so there is no conversation to be had — and offering an empty tab that
    // refuses every comment would be worse than not offering it. A viewer is
    // always past this check: they are looking at it, which is the proof.
    ...(w.shared ? [{ id: 'social' as DetailTab, label: 'Social', icon: <MessageSquare size={14} />, count: counts.comments }] : []),
  ]
  const activeTab = detailTabs.some(t => t.id === detailTab) ? detailTab : detailTabs[0].id

  /*
   * A notification links straight to the tab it happened in, so opening one
   * has to land on the conversation rather than on the charts above it.
   *
   * A passive effect and not a layout one: App scrolls the page to the top
   * when you drill into a workout, from a layout effect in the parent, which
   * runs after every layout effect down here. Passive effects run after all of
   * those, so this is the last word rather than something silently undone.
   *
   * The parameter is then stripped, so a reload — or a back and forward — is
   * the page you were on rather than the tab a notification once pointed at.
   */
  useEffect(() => {
    function follow() {
      // Scoped to this workout. Every mounted detail page hears this event,
      // and a page that reads a link meant for another one also clears it —
      // which is what left the page the link was for with nothing to act on.
      const { tab, commentId } = deepLinkFor(w.id)
      if (!tab && !commentId) return
      const wanted = askedTab(tab)
      if (wanted) setDetailTab(wanted)
      // Handed to the Social panel, which owns the scrolling and the flash —
      // it is the only thing that knows when the thread has actually loaded.
      // Kept in state after the URL is cleared, so the panel still has a
      // target to find once it arrives.
      setFocusComment(commentId)
      clearDeepLink()
      // The panel scrolls itself to a named comment. Scrolling to the tab strip
      // is for the case with no comment to find — a gallery link, or a comment
      // that has since been deleted — and for getting the reader past the
      // charts while the thread loads.
      if (!commentId) sectionsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    follow()
    // Not only on mount. Tapping a notification for the workout already on
    // screen changes the URL without remounting anything, and reading the tab
    // once at mount is why that tap used to do nothing at all.
    window.addEventListener(LOCATION_EVENT, follow)
    window.addEventListener('popstate', follow)
    return () => {
      window.removeEventListener(LOCATION_EVENT, follow)
      window.removeEventListener('popstate', follow)
    }
  }, [])

  useEffect(() => {
    if (!playing || w.duration <= 0) return
    const totalMs = 15000 // full playback takes 15s of wall-clock time
    const startWall = performance.now()
    const startT = playhead.value
    let raf = 0
    function tick(now: number) {
      const elapsed = now - startWall
      const t = Math.min(w.duration, startT + (elapsed / totalMs) * w.duration)
      playhead.set(t)
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

  /**
   * The one set of props every copy of the transport is handed.
   *
   * Eleven call sites — the dock, the desktop card and every expanded chart and
   * map — repeated the same seven props by hand, which is nine chances for one
   * of them to be given a stale handler and no way to notice.
   */
  const playbackProps: PlaybackProps = {
    playing,
    currentTime,
    duration: w.duration,
    onPlayPause: handlePlayPause,
    onReset: handleReset,
    onEnd: handleEnd,
    onScrub: handleScrub,
  }

  function handlePlayPause() {
    if (playing) {
      setPlaying(false)
      return
    }
    if (playhead.value >= w.duration) playhead.set(0)
    setPlaying(true)
  }

  function handleReset() {
    setPlaying(false)
    playhead.set(0)
  }

  function handleEnd() {
    setPlaying(false)
    playhead.set(w.duration)
  }

  function handleScrub(t: number) {
    setPlaying(false)
    playhead.set(Math.max(0, Math.min(w.duration, t)))
  }

  function padDomain(min: number, max: number, count: number): [number, number] {
    if (count === 0) return [0, 1]
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

  /**
   * What the form was opened with, so saving can send only what moved.
   *
   * The patch is not a description of the form, it is a list of instructions:
   * sending `calories` marks that figure as hand-entered whatever its value,
   * so a form that submitted every field flagged all of them as edits the
   * moment anyone corrected one. Correcting a distance should not claim the
   * calorie estimate as your own.
   */
  const editedFrom = useRef({ name: '', date: '', type: w.type, calories: '', steps: '', distance: '' })

  function startEdit() {
    const initial = {
      name: w.name,
      date: w.date,
      type: w.type,
      calories: w.calories > 0 ? String(w.calories) : '',
      steps: w.steps != null && w.steps > 0 ? String(w.steps) : '',
      distance: w.distance > 0 ? (w.distance / 1000).toFixed(2) : '',
    }
    editedFrom.current = initial
    setEditName(initial.name)
    setEditDate(initial.date)
    setEditType(initial.type)
    setEditCalories(initial.calories)
    setEditSteps(initial.steps)
    setEditDistance(initial.distance)
    setPlan(emptyPlan(w))
    setShowAdvanced(false)
    setSaveErr(null)
    setEditing(true)
  }

  /**
   * Saves the form, and the reshape with it when one is staged.
   *
   * The field patch goes first and the reshape second, because the reshape
   * returns the whole recomputed workout: doing it the other way round would
   * render the trimmed workout and then overwrite it with the response to the
   * rename, whose numbers are the old ones.
   */
  async function saveEdit() {
    // A staged trim or removal is destructive, so it is confirmed once, here,
    // rather than per control while the user is still experimenting.
    if (planChanges(w, plan) && !confirmReshape) {
      setConfirmReshape(true)
      return
    }
    setSaving(true)
    setSaveErr(null)
    try {
      const from = editedFrom.current
      const patch: Parameters<typeof updateWorkout>[1] = {}
      if (editName.trim() !== from.name) patch.name = editName.trim()
      if (editType !== from.type) patch.type = editType
      if (editDate !== from.date) patch.date = editDate
      if (editCalories !== from.calories) patch.calories = Math.max(0, Math.round(Number(editCalories) || 0))
      if (editSteps !== from.steps) patch.steps = Math.max(0, Math.round(Number(editSteps) || 0))
      // Back to metres, which is what the field stores. Rounded, because a
      // typed "5.03" is 5030 m and not 5029.999999999999.
      if (editDistance !== from.distance) patch.distance = Math.max(0, Math.round((Number(editDistance) || 0) * 1000))

      // Nothing moved: the request would be a no-op that still bumps the
      // updated-at stamp and re-renders the list for no reason.
      if (Object.keys(patch).length > 0) {
        setW(await updateWorkout(w.id, patch))
      }
      if (planChanges(w, plan)) {
        setW(await api.reshapeWorkout(w.id, {
          start: plan.start,
          // The server reads 0 as "to the end", which is what an untouched
          // handle means — and avoids sending a duration it would clamp anyway.
          end: plan.end >= w.duration ? 0 : plan.end,
          drop: plan.drop,
        }))
        // The library cache holds this workout's distance and duration, and
        // both just changed. Without this the list, dashboard and charts keep
        // the old figures until something else reloads them.
        void refreshLibrary()
      }
      setConfirmReshape(false)
      setEditing(false)
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save changes')
      setConfirmReshape(false)
    } finally {
      setSaving(false)
    }
  }

  /** Rebuilds the recorded data from the archived original. */
  async function handleRestore() {
    setRestoring(true)
    try {
      setW(await api.restoreWorkout(w.id))
      void refreshLibrary()
      setConfirmRestore(false)
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Could not restore from the original file')
    } finally {
      setRestoring(false)
    }
  }

  async function handleRecalculate() {
    setRecalculating(true)
    setRecalcErr(null)
    try {
      await api.recalcWorkout(w.id, recalcParts)
      /*
       * Re-read rather than take the answer.
       *
       * A recalculation can add a whole series the page did not have — an
       * elevation lookup is exactly that — and after it the page was still
       * drawing the old workout until you left and came back. The response
       * carries the new series (there is a test on the server saying so), so
       * something between there and here was not making it onto the page, and
       * re-reading is the version with one source instead of two: the page
       * hydrates through getWorkout, and now it refreshes through the same
       * call. One request, after an action that has already been to the
       * network and back.
       */
      setW(await api.getWorkout(w.id))
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
    series: PlotSeries
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
    const { series, dataKey, stroke, gradId, unit, reversed, yTickFormatter, height, valueFormatter, hrZoneStroke, maxHRForZones } = opts
    const mobile = isMobile
    const data = series.points
    const visible = visibleUpTo(data, currentTime)
    // From the extremes measured once when the series was prepared. This used
    // to rescan the full series and spread it into Math.min/max on every frame
    // of playback, per chart — which for a long activity is also a spread wide
    // enough to overflow the call stack.
    const yDomain: [number, number] = yFromZero
      ? [0, series.count ? Math.ceil(series.max * 1.05) || 1 : 1]
      : padDomain(series.min, series.max, series.count)
    const cursorVal = valueAtTime(data, dataKey as any, currentTime)
    // The zone gradient is an SVG linear gradient in objectBoundingBox units,
    // so it maps to the *stroke path's* bounding box — the value range of the
    // line actually drawn — not to the padded axis domain. Computing the stops
    // against the axis domain painted the peak with the colour meant for the
    // padded top of the chart, so a Zone-4 peak drew as Zone 5 with no Zone-5
    // sample behind it. Measure the visible line's own range so the offsets
    // line up, and it stays right as the line grows during playback.
    let visMin = Infinity
    let visMax = -Infinity
    if (hrZoneStroke) {
      for (const p of visible) {
        const v = (p as Record<string, number>)[dataKey]
        if (v < visMin) visMin = v
        if (v > visMax) visMax = v
      }
    }
    const strokeStops = hrZoneStroke && maxHRForZones && visible.length
      ? hrZoneStops(visMin, visMax, maxHRForZones)
      : null
    const strokeColor = strokeStops ? `url(#${gradId}_stroke)` : stroke
    return (
      <ResponsiveContainer width="100%" height={height}>
        {/* No onClick. Tapping a chart used to seek the whole page to that
            moment, which meant reading a value cost you your place: the map
            marker jumped, every other chart's cursor moved, and the only way
            back was the transport. Recharts shows the tooltip on hover and on
            touch by itself, so inspecting a point now costs nothing, and
            seeking is what the scrub bar and the map are for. */}
        <AreaChart
          data={visible}
          /* Off, and with it the two focus rectangles a tap used to leave
             behind. Recharts turns this on by default, which makes the <svg>
             a tab stop with role="application" and draws a box around the
             plot when it takes focus. That is the right trade for a chart you
             operate with the keyboard; this one is not operable at all any
             more — there is no onClick, the tooltip comes on hover and touch
             by itself, and seeking belongs to the scrub bar. Announcing it as
             an application and boxing it on every tap was cost with nothing
             bought. */
          accessibilityLayer={false}
          // Edge to edge on a phone. The card's padding is gone from around the
          // plot, and the y axis with it — the numbers it carried are drawn on
          // the gridlines instead, inside the plot, where they cost nothing.
          // Edge to edge on a phone: the end labels are kept inside by
          // anchoring them rather than by reserving margin for them, so the
          // plot keeps the full width. See EdgeTick.
          margin={mobile
            ? { top: 4, right: 0, left: 0, bottom: 14 }
            : { top: 4, right: 18, left: -24, bottom: 14 }}
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
          {/* On a phone the gridlines come from the labelled reference lines
              below instead, so that there is one line per value rather than
              two nearly-coincident ones. */}
          {!mobile && <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />}
          {mobile && inlineTicks(yDomain).map(v => (
            <ReferenceLine
              key={v}
              y={v}
              stroke="var(--border)"
              strokeDasharray="2 4"
              label={{
                value: (yTickFormatter ?? String)(v),
                position: 'insideTopLeft',
                fontSize: 9,
                fill: 'var(--text-3)',
                fontFamily: 'var(--font-mono)',
                // Held off the plot's left edge, which on a phone is the
                // card's edge — at 4 the first glyph was touching it, and a
                // minus sign was half gone.
                offset: 9,
              }}
            />
          ))}
          {/* Before the axes and the series, so the shading sits behind them
              rather than over the line it is meant to explain. */}
          {showPauses && pauses.map(p => (
            <ReferenceArea
              key={`${p.from}-${p.to}`}
              x1={p.from} x2={p.to}
              fill="var(--pause-band)" fillOpacity={1} stroke="none"
              label={<PauseMark />}
              ifOverflow="hidden"
            />
          ))}
          <XAxis
            dataKey="t" type="number" domain={[0, w.duration || 1]}
            padding={END_PADDING}
            tick={<EdgeTick />}
            axisLine={false} tickLine={false} tickFormatter={fmtClock} interval="preserveStartEnd"
            label={xLabel('Elapsed time (h:mm)')}
          />
          {/* Hidden and not removed on a phone: the axis is what owns the
              domain, and dropping it would let the plot rescale itself. */}
          <YAxis
            hide={mobile}
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
    return areaChart({ series: plots.hr, dataKey: 'hr', stroke: 'var(--danger)', gradId: 'hrGrad', unit: 'bpm', height, hrZoneStroke: true, maxHRForZones: effectiveMaxHR })
  }
  function paceChart(height: number) {
    return areaChart({ series: plots.pace, dataKey: 'pace', stroke: color, gradId: 'paceGrad', unit: '/km', valueFormatter: fmtPace, reversed: true, yTickFormatter: v => fmtPace(v), height })
  }
  function speedChart(height: number) {
    return areaChart({ series: plots.speed, dataKey: 'speed', stroke: 'var(--blue)', gradId: 'speedGrad', unit: 'km/h', valueFormatter: value => value.toFixed(1), height })
  }
  function elevChart(height: number) {
    return areaChart({ series: plots.elev, dataKey: 'elev', stroke: 'var(--hike)', gradId: 'elevGrad', unit: 'm', height })
  }
  function cadenceChart(height: number) {
    return areaChart({ series: plots.cad, dataKey: 'cad', stroke: CADENCE_COLOR, gradId: 'cadGrad', unit: cadenceUnit(w.type), height })
  }

  /**
   * One named series, drawn with the same machinery as the five above.
   *
   * The gradient id is derived from the series name, which is also why names
   * are restricted to something id-safe: two charts sharing a gradient id take
   * whichever definition the browser saw last, and the second one is drawn in
   * the first one's colour.
   */
  function extraChart(key: string, height: number) {
    const plot = extraPlots[key]
    const meta = extraSeriesMeta(key)
    if (!plot) return null
    return areaChart({
      series: plot,
      dataKey: 'v',
      stroke: meta.color,
      gradId: `extraGrad_${key.replace(/[^a-zA-Z0-9_-]/g, '')}`,
      unit: meta.unit,
      height,
      valueFormatter: value => value.toFixed(meta.decimals),
    })
  }

  function hrZoneChart(height: number) {
    if (hrZoneStyle === 'histogram') {
      return (
        <ResponsiveContainer width="100%" height={height}>
          {/* accessibilityLayer off for the same reason as the area charts —
              see areaChart. */}
          <BarChart data={hrZonesPlayed} accessibilityLayer={false} margin={{ top: 4, right: 18, left: -24, bottom: 14 }}>
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
          <PieChart accessibilityLayer={false}>
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

  /*
   * The route map is mounted once and moved, not rendered in two places.
   *
   * Expanding it used to mount a second RouteMap inside the modal, which is a
   * second MapLibre instance: a blank panel, the style, glyphs and sprite
   * fetched again, and every visible tile decoded and uploaded to the GPU from
   * scratch — a second of white on every expand, and two live WebGL contexts
   * while it was open.
   *
   * A portal is what makes moving it possible. React cannot hand a rendered
   * element to a new parent, but it can keep rendering into a DOM node we own,
   * and that node can be moved anywhere. So the map's React position never
   * changes — it is never unmounted — while its container hops between the card
   * and the modal.
   */
  const [mapHolder] = useState(() => {
    const el = document.createElement('div')
    el.style.height = '100%'
    return el
  })
  const [cardHost, setCardHost] = useState<HTMLDivElement | null>(null)
  const [modalHost, setModalHost] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    // appendChild on a node that already has a parent is a move.
    const target = expanded === 'map' ? modalHost : cardHost
    target?.appendChild(mapHolder)
    // MapLibre observes its own container, so the new size is picked up without
    // being told.
  }, [expanded, cardHost, modalHost, mapHolder])

  function mapCard(height: number | string, maximizeButton?: React.ReactNode) {
    return (
      // The fallback matches the frame the map will fill, so its arrival does
      // not reflow the cards underneath it.
      <Suspense fallback={<div className="route-map-loading" style={{ height }}>Loading map…</div>}>
      <RouteMap route={w.route} color={trailColor} duration={w.duration} currentTime={currentTime} playhead={playhead} onScrub={handleScrub} height={height} distance={w.distance} hrTimeline={w.hrTimeline} paceTimeline={smoothPaceTimeline} elevTimeline={w.elevTimeline} cadenceTimeline={cadenceTimeline} cadenceLabel={cadenceUnit(w.type)} avatarUrl={routeAvatar} maxHR={effectiveMaxHR} shading={shading} onShadingChange={setShading} maximizeButton={maximizeButton} cooperativeGestures={isMobile && expanded !== 'map'} />
      </Suspense>
    )
  }


  return (
    <div>
      {confirmRecalc && (
        <RecalculateDialog
          parts={recalcParts}
          workout={{ hasRoute: w.route.length > 1, hasElevation: w.elevTimeline.length > 0 }}
          onChange={setRecalcParts}
          busy={recalculating}
          error={recalcErr}
          onClose={() => setConfirmRecalc(false)}
          onConfirm={handleRecalculate}
        />
      )}
      {editing && (
        <Modal onClose={() => setEditing(false)} dismissable={!saving} label="Edit workout">
            {/* Scrolls rather than growing past the viewport: with the
                recording section open this is taller than a laptop screen, and
                the Save button was the part that fell off the bottom. */}
            <div className="modal-box edit-modal">
              <div className="edit-modal-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700 }}>Edit Workout</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Update the workout's details</p>
                </div>
                <button className="btn-icon" onClick={() => setEditing(false)} disabled={saving} aria-label="Close"><XIcon size={16} /></button>
              </div>

              <div className="edit-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Workout Name</label>
                  <input className="input" style={{ width: '100%' }} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Workout name" />
                </div>
                <div>
                  <label className="form-label">Sport Type</label>
                  <SportDropdown value={editType} onChange={setEditType} />
                </div>
                <div>
                  <label className="form-label">Date</label>
                  <input className="input" style={{ width: '100%' }} type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Distance (km)</label>
                  <input
                    className="input" style={{ width: '100%' }} type="number" min="0" step="0.01"
                    value={editDistance}
                    onChange={e => setEditDistance(e.target.value)}
                    placeholder="Distance"
                  />
                </div>
                <div>
                  <label className="form-label">Calories (kcal)</label>
                  <input className="input" style={{ width: '100%' }} type="number" min="0" value={editCalories} onChange={e => setEditCalories(e.target.value)} placeholder="Calories" />
                </div>
                <div>
                  <label className="form-label">Steps</label>
                  <input className="input" style={{ width: '100%' }} type="number" min="0" value={editSteps} onChange={e => setEditSteps(e.target.value)} placeholder="Steps" />
                </div>
              </div>

              {/* What the workout recorded, as opposed to what it is called.
                  Folded away, because it is the rarer edit and the destructive
                  one: renaming a workout should not open with a pair of trim
                  handles in front of it. Only for workouts that have something
                  to trim or drop — a hand-entered one has neither. */}
              {(w.duration > 0 || presentStreams(w).length > 0) && (
                <div className="edit-advanced">
                  <button
                    type="button"
                    className="edit-advanced-toggle"
                    onClick={() => setShowAdvanced(a => !a)}
                    aria-expanded={showAdvanced}
                  >
                    <ChevronDown size={14} className={showAdvanced ? 'open' : undefined} aria-hidden />
                    Advanced
                    {planChanges(w, plan) && <span className="edit-advanced-mark">edited</span>}
                  </button>
                  {showAdvanced && <WorkoutReshape workout={w} plan={plan} onChange={setPlan} hasOriginal={!!w.hasOriginal} />}
                </div>
              )}
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
        </Modal>
      )}
      {/* Named rather than generic: "this cannot be undone" is not true here —
          there may be an original to restore from — and what is actually going
          is the only thing worth reading twice. */}
      {confirmReshape && (
        <ConfirmDialog
          title="Save these changes to the recording?"
          message={[
            plan.start > 0 || plan.end < w.duration
              ? `Trims the workout to ${fmtDuration(plan.end - plan.start)} of ${fmtDuration(w.duration)}. Distance, pace, calories and the rest are recalculated from what is left.`
              : '',
            plan.drop.length > 0
              ? `Removes ${plan.drop.map(d => presentStreams(w).find(s => s.id === d)?.label.toLowerCase() ?? d).join(', ')}.`
              : '',
            w.hasOriginal
              ? 'The file you imported is kept, so this can be undone with "Restore from original".'
              : 'There is no archived original for this workout, so this cannot be undone.',
          ].filter(Boolean).join(' ')}
          confirmLabel="Save changes"
          danger={!w.hasOriginal}
          busy={saving}
          busyLabel="Saving…"
          onConfirm={() => void saveEdit()}
          onCancel={() => setConfirmReshape(false)}
        />
      )}

      {confirmRestore && (
        <ConfirmDialog
          title="Restore from the original file?"
          message="Rebuilds the route, heart rate, cadence and elevation from the file you imported, undoing any trim or removal. The name, sport, notes, sharing, equipment, photos and comments are left alone."
          confirmLabel="Restore"
          busy={restoring}
          busyLabel="Restoring…"
          onConfirm={() => void handleRestore()}
          onCancel={() => setConfirmRestore(false)}
        />
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} dismissable={!deleting}>
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
        </Modal>
      )}
      {/* The shared header, like a plan's and a session's. This page used to
          hand-roll the same markup with its own inline styles, which is how
          the three drifted apart in the first place. */}
      <PageHeader
        title={w.name}
        subtitle={longDate(fromDateKey(w.date))}
        onBack={onBack}
        /* Beside the date, not the title: a long workout name with two chips
           after it wrapped the header onto three lines on a phone. */
        subtitleAction={
          <>
            <span className={`badge tag-${w.type.toLowerCase()}`}><TypeIcon type={w.type} size={12} /> {w.type}</span>
            {/* The same mark the list row carries. It was only ever on the
                list, which meant the one page you would open to check
                whether a workout is shared was the one that did not say.

                Owner only, and that is the whole meaning of it: the badge
                says "you have shared this". On someone else's workout the
                server sets `shared` unconditionally — that is how the Social
                tab knows it has an audience — so rendering it here told you
                that a workout you are merely a guest on is one you shared. */}
            {!readOnly && <ShareBadge workout={w} />}
          </>
        }
        /* Its own line rather than sharing one with the date: a long display
           name would otherwise squeeze the date or wrap raggedly. */
        meta={readOnly && w.owner ? (
          /* Opens their profile: the workouts of theirs you can see,
             gathered by person rather than by recency. */
          <button
            type="button"
            className="owner-byline owner-byline-link page-header-byline"
            onClick={() => onOpenUser?.(w.owner!.id)}
          >
            <span>Shared by</span>
            <UserAvatar user={w.owner} size={20} />
            <span>{userLabel(w.owner)}</span>
          </button>
        ) : undefined}
        compactActions
        actions={readOnly ? undefined : (
          <OptionsMenu
            onEdit={startEdit}
            onInfo={() => setShowInfo(true)}
            onDownloadOriginal={w.hasOriginal ? downloadOriginal : undefined}
            onRestore={w.hasOriginal ? () => setConfirmRestore(true) : undefined}
            onShare={() => setSharing(true)}
            onShareCard={() => setCardOpen(true)}
            onRecalculate={() => { setRecalcErr(null); setConfirmRecalc(true) }}
            onDelete={() => setConfirmDelete(true)}
            deleting={deleting}
          />
        )}
      />

      <div className={`page-content${playable ? ' with-dock' : ''}`}>
        {originalErr && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, color: 'var(--danger)', fontSize: 13 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{originalErr}</span>
            <button className="btn-icon" aria-label="Dismiss" onClick={() => setOriginalErr(null)}>
              <XIcon size={14} />
            </button>
          </div>
        )}
        {/* Hero (flexible width) + Summary card (fixed, narrower) side by
            side on desktop; stacked on mobile so neither gets squeezed.

            The hero is a ladder, not a branch: the map when there is a route,
            the effort profile when there are samples but no route, and the
            standing panel when there is neither. A treadmill run, a pool swim
            and a strength session are complete records, and the page used to
            greet all three with a grey rectangle reading "No route data".
            One rule in one place, so no page has to know about treadmills.

            A first-ever workout of its type has no rung left — nothing to
            draw and nothing to compare — so the summary takes the width rather
            than sharing it with an empty box. */}
        <div className={`detail-top${hero === 'map' ? '' : hero === 'none' ? ' solo' : ' no-map'}`}>
          {hero === 'map' && (
            <div className="card detail-map-card">
              {/* Empty on purpose: the map is portalled into a node this hosts.
                  See mapHolder. */}
              <div ref={setCardHost} style={{ flex: 1, minHeight: 0, position: 'relative' }} />
            </div>
          )}
          {hero === 'profile' && (
            <div className="card detail-hero-card">
              <SessionProfile
                id={w.id}
                duration={w.duration}
                hrTimeline={w.hrTimeline}
                cadenceTimeline={cadenceTimeline}
                maxHR={effectiveMaxHR}
                pauses={pauses}
                playhead={playhead}
                tint={tint}
                onTintChange={setTint}
                onScrub={handleScrub}
                avatarUrl={routeAvatar}
                cadenceLabel={cadenceUnit(w.type)}
                onExpand={() => setExpanded('session')}
              />
            </div>
          )}
          {hero === 'context' && (
            <div className="card detail-hero-card">
              <SessionContext workout={w} facts={standing} />
            </div>
          )}

          {/* Summary: every headline + derived stat grouped by category.
              Values that are not reported directly by the import (or that
              cannot be computed at all) show a dash instead of a misleading
              zero; values derived from recorded samples (rather than
              reported directly by the source) carry a small calculated
              indicator. */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 className="card-title">
              <ClipboardList size={15} style={{ color: 'var(--primary)' }} />
              Summary
              {/* The headline figures come with the list row; the ones derived
                  from the samples — min and max HR, elevation loss — arrive
                  with the full record, so the spinner says the rest is still
                  coming rather than leaving dashes that look final. */}
              {hydrating && <LoaderCircle size={12} className="spin" style={{ color: 'var(--text-3)' }} />}
            </h3>

            {/* The three figures about the activity itself on one row, and the
                two counted from it on the next. Moving time shows even when it
                equals the duration: an empty slot on most workouts would be
                worse than a repeated number, and its absence would read as
                "not measured" rather than "nothing was missed". */}
            <div className="stat-grid-3">
              <StatChip icon={<Navigation size={12} />} label="Distance" value={w.distance > 0 ? fmtDist(w.distance) : '—'} />
              <StatChip icon={<Clock size={12} />} label="Duration" value={w.duration > 0 ? fmtDuration(w.duration) : '—'} />
              <StatChip icon={<PauseIcon size={12} />} label="Moving" value={w.duration > 0 ? fmtDuration(w.movingTime || w.duration) : '—'} />
            </div>

            <div className="stat-grid-3">
              {/* Calories are only badged as computed when we estimated them
                  ourselves — TCX files state them outright, and those are as
                  good as any other reported field. */}
              <StatChip icon={<Zap size={12} />} label="Calories" value={w.calories > 0 ? `${w.calories} kcal` : '—'} manual={w.caloriesManual} calculated={!w.caloriesManual && !w.caloriesReported && w.calories > 0} />
              {/* The Σ marks an estimate, and steps counted from a recorded
                  cadence are not one — the watch counted them. It belongs only
                  on the fallback, which divides distance by an assumed stride. */}
              <StatChip
                icon={<Footprints size={12} />}
                label="Steps"
                value={(w.steps ?? 0) > 0 ? w.steps!.toLocaleString() : (derived.steps != null ? derived.steps.toLocaleString() : '—')}
                manual={w.stepsManual}
                calculated={!w.stepsManual && cadenceTimeline.length === 0 && ((w.steps ?? 0) > 0 || derived.steps != null)}
              />
            </div>

            {(w.hrTimeline.length > 0 || w.avgHR > 0) && (
              <div className="stat-grid-3">
                <StatChip icon={<Heart size={12} color="var(--danger)" />} label="Min HR" value={derived.hrMin != null ? `${derived.hrMin} bpm` : '—'} />
                <StatChip icon={<Heart size={12} color="var(--danger)" />} label="Avg HR" value={derived.hrAvg != null ? `${derived.hrAvg} bpm` : '—'} />
                <StatChip icon={<Heart size={12} color="var(--danger)" />} label="Max HR" value={derived.hrMax != null ? `${derived.hrMax} bpm` : '—'} />
              </div>
            )}

            {/* Shown on the average alone, not on the timeline. A treadmill
                export has no per-point pace to plot — its track carries heart
                rate and time and no position — but it does have a distance and
                a duration, which is all an average needs. Gating the row on the
                series meant correcting the distance produced a pace nothing on
                the page ever showed. Min and max still need the series and say
                so with a dash when it is missing. */}
            {(w.paceTimeline.length > 0 || w.avgPace > 0) && (
              <div className="stat-grid-3">
                <StatChip icon={<TrendingUp size={12} color={color} />} label="Min Pace" value={derived.paceMin != null ? `${fmtPace(derived.paceMin)} /km` : '—'} calculated={derived.paceMin != null} />
                <StatChip icon={<TrendingUp size={12} color={color} />} label="Avg Pace" value={w.avgPace ? `${fmtPace(w.avgPace)} /km` : '—'} calculated />
                <StatChip icon={<TrendingUp size={12} color={color} />} label="Max Pace" value={derived.paceMax != null ? `${fmtPace(derived.paceMax)} /km` : '—'} calculated={derived.paceMax != null} />
              </div>
            )}

            {(speedTimeline.length > 0 || w.avgSpeed > 0) && (
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
            </div>
          </div>
        </div>

        {/* Metric toggle row. Its two switches are about the charts, so with no
            charts to configure the row goes with them. */}
        {hasSeries && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          {([
            { id: 'hr', label: 'Heart Rate', color: 'var(--danger)', available: w.hrTimeline.length > 0, on: selectedMetrics.includes('hr'), toggle: () => toggleMetric('hr') },
            { id: 'pace', label: 'Pace', color: color, available: w.paceTimeline.length > 0, on: selectedMetrics.includes('pace'), toggle: () => toggleMetric('pace') },
            { id: 'speed', label: 'Speed', color: 'var(--blue)', available: speedTimeline.length > 0, on: selectedMetrics.includes('speed'), toggle: () => toggleMetric('speed') },
            { id: 'elevation', label: 'Elevation', color: 'var(--hike)', available: w.elevTimeline.length > 0, on: selectedMetrics.includes('elevation'), toggle: () => toggleMetric('elevation') },
            { id: 'cadence', label: 'Cadence', color: CADENCE_COLOR, available: cadenceTimeline.length > 0, on: selectedMetrics.includes('cadence'), toggle: () => toggleMetric('cadence') },
            // Whatever else the file recorded. These only ever appear on a
            // workout that has them, so the row grows for a FIT import and
            // looks exactly as it did before for everything else.
            ...extraSeries.map(e => ({
              id: e.key, label: e.meta.label, color: e.meta.color, available: true,
              on: extraOn(e.key), toggle: () => toggleExtra(e.key),
            })),
          ]).filter(m => m.available).map(m => (
            <button
              key={m.id}
              onClick={m.toggle}
              className="btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, fontSize: 12,
                border: `1px solid ${m.on ? m.color : 'var(--border)'}`,
                background: m.on ? `${m.color}18` : 'transparent',
                color: m.on ? m.color : 'var(--text-3)',
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, opacity: m.on ? 1 : 0.3 }} />
              {m.label}
            </button>
          ))}
          <label className="switch" style={{ marginLeft: 'auto' }} title="Start every chart's Y axis at zero">
            <input type="checkbox" checked={yFromZero} onChange={e => setYFromZero(e.target.checked)} />
            <span className="switch-track" />
            Y axis from 0
          </label>
          {/* Only where there is something to show. A toggle that never
              changes anything is a question about a feature this workout does
              not have. */}
          {pauses.length > 0 && (
            <label className="switch" title="Shade the stretches where the recording stopped">
              <input type="checkbox" checked={showPauses} onChange={e => setShowPauses(e.target.checked)} />
              <span className="switch-track" />
              Pauses
            </label>
          )}
        </div>
        )}

        {/* Charts */}
        <div className="charts-grid">
          {/* Spans the grid while the samples are on their way, so the page
              does not look like a workout that recorded nothing. */}
          {hydrating && (
            <div className="card detail-loading" style={{ gridColumn: '1 / -1' }}>
              <LoaderCircle size={18} className="spin" />
              Loading charts…
            </div>
          )}
          {selectedMetrics.includes('hr') && w.hrTimeline.length > 0 && (
            <MetricPanel
              icon={<Heart size={14} color="var(--danger)" />}
              title="Heart Rate"
              info="Every heart-rate sample the file recorded, plotted against elapsed time. The line is coloured by training zone using your max HR — from Settings when the activity doesn't report its own. Hover or tap the line to read a moment; the playback cursor is moved from the scrub bar or the map."
              stats={<>Min {derived.hrMin ?? '—'} · Avg {w.avgHR} · Max {w.maxHR} bpm</>}
              onExpand={() => setExpanded('hr')}
            >
              {hrChart(180)}
            </MetricPanel>
          )}

          {selectedMetrics.includes('hr') && hrZones.length > 0 && (
            <MetricPanel
              icon={<Heart size={14} color="var(--danger)" />}
              title="Heart Rate Zones"
              info="How the activity's time split across the five effort zones, as a share of recorded samples. Zones are percentages of your max HR: under 60% is recovery, 60-70% endurance, 70-80% tempo, 80-90% threshold, and above 90% is maximal. Switch between the histogram and donut under Settings → Charts."
              onExpand={() => setExpanded('hrzones')}
            >
              {hrZoneChart(190)}
            </MetricPanel>
          )}

          {selectedMetrics.includes('pace') && w.paceTimeline.length > 0 && (
            <MetricPanel
              icon={<TrendingUp size={14} color={color} />}
              title="Pace"
              badge={<CalcIcon />}
              info="Pace derived from the distance and time between consecutive GPS fixes, then smoothed — very few files record pace directly, which is what the Σ marks. Segments shorter than three metres are skipped so standing still doesn't produce wild spikes. Lower on the chart is faster. The average is over moving time: shaded bands mark the stretches where the recording stopped, and those are left out of it."
              stats={<>Min {derived.paceMin != null ? fmtPace(derived.paceMin) : '—'} · Avg {fmtPace(w.avgPace)} · Max {derived.paceMax != null ? fmtPace(derived.paceMax) : '—'} /km</>}
              onExpand={() => setExpanded('pace')}
            >
              {paceChart(180)}
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
              {speedChart(180)}
            </MetricPanel>
          )}

          {selectedMetrics.includes('elevation') && w.elevTimeline.length > 0 && (
            <MetricPanel
              icon={<Mountain size={14} color="var(--hike)" />}
              title="Elevation"
              /* Only when it was looked up. A device's own altitude is a
                 measurement and wants no mark; this one is the ground under
                 the route, and the difference is the whole reason the mark
                 exists. */
              badge={w.elevationLookup ? <CalcIcon title="Looked up from the route's coordinates, not recorded by the device" /> : undefined}
              info={w.elevationLookup
                ? "This workout recorded a route but no altitude, so the elevation here is the ground under that route, from a terrain model — that is what the Σ marks. The model has one height per 90 metres, which is wider than most trails, so read it as the shape of the hill rather than the shape of your ride. Total gain sums only the upward steps between consecutive samples."
                : "Altitude recorded at each track point. Total gain sums only the upward steps between consecutive samples, so barometric noise on a flat route can inflate it slightly. Compare the shape against the heart-rate chart to see what the climbs actually cost you."}
              stats={<>+{w.elevationGain} m gain · {derived.elevLoss} m loss</>}
              onExpand={() => setExpanded('elevation')}
            >
              {elevChart(180)}
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
              {cadenceChart(180)}
            </MetricPanel>
          )}

          {/* Everything else the file measured. Nothing here is compared
              across workouts — not every workout has them — so this is the
              only page they appear on, and the panel is the same one the
              charted five use rather than a second kind of card. */}
          {extraSeries.map(e => extraOn(e.key) && (
            <MetricPanel
              key={e.key}
              icon={<ExtraSeriesIcon name={e.key} color={e.meta.color} />}
              title={e.meta.label}
              info={e.meta.info}
              stats={<ExtraStats points={e.points} meta={e.meta} />}
              onExpand={() => setExpanded(`extra:${e.key}`)}
            >
              {extraChart(e.key, 180)}
            </MetricPanel>
          ))}
        </div>

        {/* Conditions. Rendered in every state, including "you have this
            switched off" — see WeatherCard on why absence needs a voice. */}
        <WeatherCard
          workout={w}
          isOwner={!readOnly}
          enabled={prefs?.weatherEnabled !== false}
          onSaved={setW}
          onOpenSettings={() => onOpenSettings?.()}
        />

        {!readOnly && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            {/* The same mark the sidebar puts on the Equipment page — gear is
                gear wherever you meet it. */}
            <h3 className="card-title"><Watch size={15} style={{ color: 'var(--primary)' }} /> Equipment</h3>
            {!editingEquip && !readOnly && (
              <button className="btn btn-ghost btn-section" onClick={startEditEquip}>
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

        {/* Everything about the workout that is not the workout: what you wrote
            down, what you photographed, and what people said about it. Tabs
            rather than a stack of cards because these grow, and three panels
            nobody opened is a page you scroll past rather than a page you use.

            Last on the page, and after the equipment, because the workout and
            its gear are the record — these are what accumulates around it.

            The strip sits outside the panel and joins onto it; see
            .detail-sections. Notes are stripped from every response to a
            non-owner, so a shared workout has no notes tab rather than an
            empty one, and activeTab falls back when the stored tab is one this
            workout does not offer. */}
        <div className="detail-sections" ref={sectionsRef}>
          <TabStrip
            items={detailTabs}
            value={activeTab}
            onChange={setDetailTab}
            ariaLabel="Workout sections"
          />
          <TabPanel>
            {activeTab === 'notes' && (readOnly
              ? <p className="notes-text">{w.notes}</p>
              : <NotesPanel workout={w} onSaved={setW} />)}
            {/* Lazy, and mounted only while its tab is open: the photos are the
                heaviest thing on the page and nobody should pay for them by
                opening a workout. The same goes for the thread. */}
            {activeTab === 'gallery' && (
              <Suspense fallback={<div className="detail-loading"><LoaderCircle size={16} className="spin" /></div>}>
                <WorkoutGallery workoutId={w.id} canEdit={!readOnly} onCount={onPhotoCount} />
              </Suspense>
            )}
            {activeTab === 'social' && (
              <Suspense fallback={<div className="detail-loading"><LoaderCircle size={16} className="spin" /></div>}>
                <WorkoutSocial
                  kind="workout"
                  workoutId={w.id}
                  isOwner={!readOnly}
                  onCount={onCommentCount}
                  focusCommentId={focusComment}
                  onFocused={() => setFocusComment(null)}
                />
              </Suspense>
            )}
          </TabPanel>
        </div>
      </div>

      {/* Rendered once, wherever mapHolder currently is. The maximize button is
          dropped while it is open — the modal's own header closes it.

          Not rendered at all when the hero is something else: mapHolder is
          never attached to the document then, and mounting a MapLibre instance
          into a detached node is a GL context and a style download spent on a
          map nobody will see. */}
      {hero === 'map' && createPortal(
        hydrating && w.route.length < 2 ? (
          <div className="detail-loading">
            <LoaderCircle size={18} className="spin" />
            Loading route…
          </div>
        ) : mapCard('100%', expanded === 'map' ? undefined : (
          <button
            className="btn-icon"
            onClick={() => setExpanded('map')}
            title="Expand map"
            aria-label="Expand map"
            style={{ position: 'absolute', top: 10, right: 10, zIndex: 'var(--z-map-panel)', background: 'var(--bg-2)', border: '1px solid var(--border)' }}
          >
            <Maximize2 size={14} />
          </button>
        )),
        mapHolder,
      )}

      {/*
        * The transport, docked to the bottom of the page on every width.
        *
        * It used to be a card beside the map that a copy tried to follow you
        * down the page, appearing and disappearing on scroll. That was fiddly
        * to get right and worse to use — a control that comes and goes is one
        * you have to hunt for — so there is now exactly one of them and it
        * never moves. On a desktop it clears the sidebar (see .playback-dock);
        * on a phone it sits above the bottom bar.
        *
        * Fixed rather than portalled: this page is inside the swipe pager, but
        * the bar is fixed to the viewport and is not an overlay competing with
        * dialogs. `.page-content` reserves the height so the last card is not
        * left underneath it.
        */}
      {playable && (
        <div className="playback-dock">
          <PlaybackBar {...playbackProps} />
        </div>
      )}

      {sharing && (
        <ShareDialog
          kind="workout"
          id={w.id}
          noun="workout"
          subject={{
            icon: <TypeIcon type={w.type} />,
            name: w.name,
            meta: [
              new Date(w.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
              w.distance > 0 ? fmtDist(w.distance) : null,
              w.duration > 0 ? fmtDuration(w.duration) : null,
            ].filter(Boolean).join(' · '),
            accent: color,
          }}
          onClose={() => setSharing(false)}
          /*
           * Sharing a workout is what brings its Social tab into existence, so
           * the page has to hear about it. Without this the tab appeared or
           * vanished only on the next full read of the workout — go back, pull
           * to refresh, open it again — which reads as the share not having
           * taken.
           *
           * Adopted from the dialog's own response rather than refetched: the
           * mutation has already been to the server and back, and `shared` is
           * a rule over these two fields (workouts.go's handleGetWorkout
           * computes exactly this) rather than a fact only the server holds.
           */
          onChange={next => setW(prev => ({
            ...prev,
            visibility: next.visibility,
            sharedWithCount: next.sharedWith.length,
            shared: next.sharedWith.length > 0 || next.visibility === 'public',
          }))}
        />
      )}

      {cardOpen && (
        <ShareCardDialog workout={w} onClose={() => setCardOpen(false)} />
      )}

      {showInfo && <WorkoutInfoDialog workout={w} onClose={() => setShowInfo(false)} />}

      {expanded === 'map' && (
        <ExpandModal title="Route" onClose={() => setExpanded(null)} variant="map">
          <div ref={setModalHost} className="modal-immersive-map" />
          <div className="modal-immersive-foot">
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {/* The routeless hero, full size. The same panel with its expand button
          dropped — the modal's own header closes it — beside the transport,
          exactly as the map's is. */}
      {expanded === 'session' && (
        // The map's immersive treatment, because this is standing in for the
        // map: edge to edge, the whole viewport on a phone, and the transport
        // on its own foot below.
        <ExpandModal title="The session" onClose={() => setExpanded(null)} variant="map">
          <div className="modal-immersive-map session-expanded">
          <SessionProfile
            id={w.id}
            duration={w.duration}
            hrTimeline={w.hrTimeline}
            cadenceTimeline={cadenceTimeline}
            maxHR={effectiveMaxHR}
            pauses={pauses}
            playhead={playhead}
            tint={tint}
            hideHeader
            onTintChange={setTint}
            onScrub={handleScrub}
            avatarUrl={routeAvatar}
            cadenceLabel={cadenceUnit(w.type)}
          />
          </div>
          <div className="modal-immersive-foot">
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'hr' && (
        <ExpandModal title="Heart Rate" onClose={() => setExpanded(null)}>
          {hrChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'pace' && (
        <ExpandModal title="Pace" onClose={() => setExpanded(null)}>
          {paceChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'speed' && (
        <ExpandModal title="Speed" onClose={() => setExpanded(null)}>
          {speedChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'elevation' && (
        <ExpandModal title="Elevation" onClose={() => setExpanded(null)}>
          {elevChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'cadence' && (
        <ExpandModal title="Cadence" onClose={() => setExpanded(null)}>
          {cadenceChart(400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {typeof expanded === 'string' && expanded.startsWith('extra:') && (
        <ExpandModal
          title={extraSeriesMeta(expanded.slice(6)).label}
          onClose={() => setExpanded(null)}
        >
          {extraChart(expanded.slice(6), 400)}
          <div style={{ marginTop: 12 }}>
            <PlaybackBar {...playbackProps} />
          </div>
        </ExpandModal>
      )}
      {expanded === 'hrzones' && (
        <ExpandModal title="Heart Rate Zones" onClose={() => setExpanded(null)}>
          {hrZoneChart(320)}
          {w.hrTimeline.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <PlaybackBar {...playbackProps} />
            </div>
          )}
        </ExpandModal>
      )}
    </div>
  )
}
