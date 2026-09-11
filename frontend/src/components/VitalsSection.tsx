import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceDot,
} from 'recharts'
import { Scale, HeartPulse, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import ChartCard, { EmptyPlot } from './ChartCard'
import Segmented from './Segmented'
import SpeedDial from './SpeedDial'
import ConfirmDialog from './ConfirmDialog'
import { PeakGlyph } from './PeakMarker'
import VitalQuickAdd, { type VitalMode } from './VitalQuickAdd'
import { AXIS_TICK, GRID_PROPS, DATA_LINE, TREND_LINE, HOVER_FILL } from '../lib/chartColors'
import { api, type Vital } from '../lib/api'
import { usePreferences } from '../context/PreferencesContext'

const WEIGHT_COLOR = 'var(--blue)'
const TARGET_COLOR = 'var(--success)'
const SYSTOLIC_COLOR = 'var(--danger)'
const DIASTOLIC_COLOR = 'var(--purple)'
const PULSE_COLOR = 'var(--warning)'

type YMode = 'fit' | 'zero'

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The local calendar day of a timestamp, as a sortable YYYY-MM-DD key. */
function dayKey(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Least-squares slope over (t, y); returns a(intercept) and b(slope) or null. */
function fit(points: Array<{ t: number; y: number }>): { a: number; b: number } | null {
  const n = points.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const p of points) { sx += p.t; sy += p.y; sxx += p.t * p.t; sxy += p.t * p.y }
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const b = (n * sxy - sx * sy) / denom
  const a = (sy - b * sx) / n
  return { a, b }
}

/**
 * A y-axis domain that always frames the data — and any extra reference values,
 * like the weight target — with a little breathing room, or runs from zero.
 */
function axisDomain(values: number[], mode: YMode): [number, number] {
  const clean = values.filter(v => Number.isFinite(v))
  if (clean.length === 0) return [0, 1]
  const lo = Math.min(...clean)
  const hi = Math.max(...clean)
  const pad = Math.max((hi - lo) * 0.08, 0.5)
  return [mode === 'zero' ? 0 : Math.floor(lo - pad), Math.ceil(hi + pad)]
}

/** Groups readings by calendar day and averages each field, ascending by day. */
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length

/** The min and max of one field across rows carrying a `label` x-position. */
function peaks(rows: Array<{ label: string }>, get: (r: { label: string }) => number | undefined):
  { minKey: string; minVal: number; maxKey: string; maxVal: number } | null {
  let min = Infinity, max = -Infinity, minKey = '', maxKey = ''
  for (const row of rows) {
    const v = get(row)
    if (typeof v !== 'number' || Number.isNaN(v)) continue
    if (v < min) { min = v; minKey = row.label }
    if (v > max) { max = v; maxKey = row.label }
  }
  return min === Infinity ? null : { minKey, minVal: min, maxKey, maxVal: max }
}

/**
 * Body vitals: manually logged weight and blood pressure over time.
 *
 * The weight chart carries the target as a reference line and a dotted
 * least-squares trend, matching the other time charts on this page. Several
 * readings on the same day are averaged into one point.
 */
export default function VitalsSection({ openAdd, onAddHandled }: {
  /** When set, opens the quick-add straight away (e.g. from an app shortcut). */
  openAdd?: VitalMode | null
  onAddHandled?: () => void
}) {
  const { prefs } = usePreferences()
  const [vitals, setVitals] = useState<Vital[] | null>(null)
  const [adding, setAdding] = useState<VitalMode | null>(null)
  const [weightYMode, setWeightYMode] = useState<YMode>('fit')
  const [bpYMode, setBpYMode] = useState<YMode>('fit')
  const [showAllRecent, setShowAllRecent] = useState(false)
  const [deleting, setDeleting] = useState<Vital | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api.listVitals().then(v => { if (alive) setVitals(v) }).catch(() => { if (alive) setVitals([]) })
    return () => { alive = false }
  }, [])

  // A deep link asked for the add sheet; open it once the section is mounted.
  useEffect(() => {
    if (openAdd) {
      setAdding(openAdd)
      onAddHandled?.()
    }
  }, [openAdd, onAddHandled])

  function onAdded(v: Vital) {
    setVitals(prev => [v, ...(prev ?? [])])
  }

  async function onDelete(id: string) {
    const prev = vitals ?? []
    setVitals(prev.filter(v => v.id !== id))
    try {
      await api.deleteVital(id)
    } catch {
      setVitals(prev) // put it back on failure
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    await onDelete(deleting.id)
    setDeleteBusy(false)
    setDeleting(null)
  }

  const target = prefs?.targetWeightKg ?? 0

  // One point per day (averaged), ascending, with a dotted trend on the weight.
  const weightData = useMemo(() => {
    const groups = new Map<string, { t: number; label: string; vals: number[] }>()
    for (const v of vitals ?? []) {
      if (typeof v.weightKg !== 'number') continue
      const key = dayKey(v.measuredAt)
      const g = groups.get(key)
      if (g) g.vals.push(v.weightKg)
      else groups.set(key, { t: new Date(v.measuredAt).getTime(), label: fmtDay(v.measuredAt), vals: [v.weightKg] })
    }
    const daily = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, g]) => ({ t: g.t, label: g.label, weight: mean(g.vals) }))
    const line = fit(daily.map(r => ({ t: r.t, y: r.weight })))
    return daily.map(r => ({ ...r, trend: line ? line.a + line.b * r.t : undefined }))
  }, [vitals])

  const bpData = useMemo(() => {
    const groups = new Map<string, { t: number; label: string; sys: number[]; dia: number[]; pul: number[] }>()
    for (const v of vitals ?? []) {
      if (typeof v.systolic !== 'number' || typeof v.diastolic !== 'number') continue
      const key = dayKey(v.measuredAt)
      const g = groups.get(key) ?? { t: new Date(v.measuredAt).getTime(), label: fmtDay(v.measuredAt), sys: [], dia: [], pul: [] }
      g.sys.push(v.systolic)
      g.dia.push(v.diastolic)
      if (typeof v.pulse === 'number') g.pul.push(v.pulse)
      groups.set(key, g)
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, g]) => ({
      t: g.t, label: g.label,
      systolic: mean(g.sys), diastolic: mean(g.dia),
      pulse: g.pul.length ? mean(g.pul) : undefined as number | undefined,
    }))
  }, [vitals])

  const weightDomain = useMemo(
    () => axisDomain([...weightData.map(d => d.weight), ...(target > 0 ? [target] : [])], weightYMode),
    [weightData, target, weightYMode],
  )
  const bpDomain = useMemo(
    () => axisDomain(bpData.flatMap(d => [d.systolic, d.diastolic, d.pulse].filter((v): v is number => Number.isFinite(v))), bpYMode),
    [bpData, bpYMode],
  )

  const weightPeaks = useMemo(() => peaks(weightData, r => (r as typeof weightData[number]).weight), [weightData])
  const systolicPeaks = useMemo(() => peaks(bpData, r => (r as typeof bpData[number]).systolic), [bpData])
  const diastolicPeaks = useMemo(() => peaks(bpData, r => (r as typeof bpData[number]).diastolic), [bpData])

  const RECENT_PAGE = 10
  const allRecent = vitals ?? []
  const recent = showAllRecent ? allRecent : allRecent.slice(0, RECENT_PAGE)

  return (
    <>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <ChartCard
          title="Body weight"
          icon={<Scale size={14} color={WEIGHT_COLOR} />}
          description="Every weigh-in, with your target and a trend line."
          info="Days with more than one weigh-in are averaged. The dashed line is the direction of travel; the flat line is your target. Log a new weight with the + button."
          actions={<Segmented value={weightYMode} onChange={setWeightYMode} options={[{ id: 'fit', label: 'Fit' }, { id: 'zero', label: 'Zero' }]} />}
        >
          {weightData.length === 0 ? (
            <EmptyPlot height={220}>No weight logged yet</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={weightData} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={weightDomain} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: HOVER_FILL }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as { label: string; weight: number }
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.label}</div>
                        <div style={{ color: WEIGHT_COLOR }}>{d.weight.toFixed(1)} kg</div>
                      </div>
                    )
                  }}
                />
                {target > 0 && (
                  <ReferenceLine y={target} stroke={TARGET_COLOR} strokeDasharray="4 4" strokeOpacity={0.8}
                    label={{ value: `Target ${target} kg`, position: 'insideTopRight', fill: TARGET_COLOR, fontSize: 10 }} />
                )}
                <Line type="monotone" dataKey="weight" stroke={WEIGHT_COLOR} {...DATA_LINE} dot={{ r: 3, fill: WEIGHT_COLOR, strokeWidth: 0 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="trend" stroke={WEIGHT_COLOR} {...TREND_LINE} connectNulls isAnimationActive={false} />
                {weightPeaks && [
                  <ReferenceDot key="w_mx" x={weightPeaks.maxKey} y={weightPeaks.maxVal} r={0} ifOverflow="extendDomain" shape={<PeakGlyph dir="up" color={WEIGHT_COLOR} />} />,
                  <ReferenceDot key="w_mn" x={weightPeaks.minKey} y={weightPeaks.minVal} r={0} ifOverflow="extendDomain" shape={<PeakGlyph dir="down" color={WEIGHT_COLOR} />} />,
                ]}
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Blood pressure"
          icon={<HeartPulse size={14} color={SYSTOLIC_COLOR} />}
          description="Systolic and diastolic, with pulse when recorded."
          info="Each point is a day's average. The two lines are the pressures in mmHg; pulse, when you entered it, shares the axis in bpm."
          actions={<Segmented value={bpYMode} onChange={setBpYMode} options={[{ id: 'fit', label: 'Fit' }, { id: 'zero', label: 'Zero' }]} />}
        >
          {bpData.length === 0 ? (
            <EmptyPlot height={220}>No blood pressure logged yet</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={bpData} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={bpDomain} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: HOVER_FILL }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as { label: string; systolic: number; diastolic: number; pulse?: number }
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.label}</div>
                        <div style={{ color: SYSTOLIC_COLOR }}>{Math.round(d.systolic)}/{Math.round(d.diastolic)} mmHg</div>
                        {typeof d.pulse === 'number' && <div style={{ color: PULSE_COLOR }}>{Math.round(d.pulse)} bpm</div>}
                      </div>
                    )
                  }}
                />
                <Line type="monotone" dataKey="systolic" stroke={SYSTOLIC_COLOR} {...DATA_LINE} dot={{ r: 3, fill: SYSTOLIC_COLOR, strokeWidth: 0 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="diastolic" stroke={DIASTOLIC_COLOR} {...DATA_LINE} dot={{ r: 3, fill: DIASTOLIC_COLOR, strokeWidth: 0 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="pulse" stroke={PULSE_COLOR} {...DATA_LINE} dot={{ r: 2, fill: PULSE_COLOR, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
                {systolicPeaks && [
                  <ReferenceDot key="s_mx" x={systolicPeaks.maxKey} y={systolicPeaks.maxVal} r={0} ifOverflow="extendDomain" shape={<PeakGlyph dir="up" color={SYSTOLIC_COLOR} />} />,
                  <ReferenceDot key="s_mn" x={systolicPeaks.minKey} y={systolicPeaks.minVal} r={0} ifOverflow="extendDomain" shape={<PeakGlyph dir="down" color={SYSTOLIC_COLOR} />} />,
                ]}
                {diastolicPeaks && [
                  <ReferenceDot key="d_mx" x={diastolicPeaks.maxKey} y={diastolicPeaks.maxVal} r={0} ifOverflow="extendDomain" shape={<PeakGlyph dir="up" color={DIASTOLIC_COLOR} />} />,
                  <ReferenceDot key="d_mn" x={diastolicPeaks.minKey} y={diastolicPeaks.minVal} r={0} ifOverflow="extendDomain" shape={<PeakGlyph dir="down" color={DIASTOLIC_COLOR} />} />,
                ]}
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {allRecent.length > 0 && (
        <ChartCard title="Recent readings" description="Your latest measurements.">
          <div className="vitals-list">
            {recent.map(v => (
              <div key={v.id} className="vitals-row">
                <span className="vitals-row-date">{fmtDay(v.measuredAt)}</span>
                <span className="vitals-row-value">
                  {typeof v.weightKg === 'number' && <span><Scale size={12} /> {v.weightKg.toFixed(1)} kg</span>}
                  {typeof v.systolic === 'number' && (
                    <span><HeartPulse size={12} /> {v.systolic}/{v.diastolic} mmHg{typeof v.pulse === 'number' ? ` · ${v.pulse} bpm` : ''}</span>
                  )}
                </span>
                {v.note && <span className="vitals-row-note">{v.note}</span>}
                <button className="btn-icon vitals-row-del" onClick={() => setDeleting(v)} aria-label="Delete measurement" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          {allRecent.length > RECENT_PAGE && (
            <button className="btn btn-ghost vitals-show-more" onClick={() => setShowAllRecent(s => !s)}>
              {showAllRecent ? <><ChevronUp size={14} /> Show less</> : <><ChevronDown size={14} /> Show all {allRecent.length}</>}
            </button>
          )}
        </ChartCard>
      )}

      <SpeedDial
        label="Add measurement"
        actions={[
          { id: 'weight', label: 'Weight', icon: <Scale size={19} />, onSelect: () => setAdding('weight') },
          { id: 'bp', label: 'Blood pressure', icon: <HeartPulse size={19} />, onSelect: () => setAdding('bp') },
        ]}
      />

      {adding && (
        <VitalQuickAdd mode={adding} onClose={() => setAdding(null)} onAdded={onAdded} />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this measurement?"
          message={
            typeof deleting.weightKg === 'number'
              ? <>Delete this weight reading: <strong>{deleting.weightKg.toFixed(1)} kg</strong> on {fmtDay(deleting.measuredAt)}?</>
              : <>Delete this blood pressure reading: <strong>{deleting.systolic}/{deleting.diastolic} mmHg</strong> on {fmtDay(deleting.measuredAt)}?</>
          }
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          busyLabel="Deleting…"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  )
}
