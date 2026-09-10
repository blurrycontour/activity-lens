import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import { Scale, HeartPulse, Trash2 } from 'lucide-react'
import ChartCard, { EmptyPlot } from './ChartCard'
import VitalQuickAdd, { type VitalMode } from './VitalQuickAdd'
import { AXIS_TICK, GRID_PROPS, DATA_LINE, TREND_LINE, HOVER_FILL } from '../lib/chartColors'
import { api, type Vital } from '../lib/api'
import { usePreferences } from '../context/PreferencesContext'

const WEIGHT_COLOR = 'var(--blue)'
const TARGET_COLOR = 'var(--success)'
const SYSTOLIC_COLOR = 'var(--danger)'
const DIASTOLIC_COLOR = 'var(--purple)'
const PULSE_COLOR = 'var(--warning)'

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
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
 * Body vitals: manually logged weight and blood pressure over time.
 *
 * Weight is the profile weight's own history — logging one here is the same as
 * changing it in Settings. The weight chart carries the target as a reference
 * line and a dotted least-squares trend, matching the other time charts on this
 * page.
 */
export default function VitalsSection({ openAdd, onAddHandled }: {
  /** When set, opens the quick-add straight away (e.g. from an app shortcut). */
  openAdd?: VitalMode | null
  onAddHandled?: () => void
}) {
  const { prefs } = usePreferences()
  const [vitals, setVitals] = useState<Vital[] | null>(null)
  const [adding, setAdding] = useState<VitalMode | null>(null)

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

  const target = prefs?.targetWeightKg ?? 0

  // Ascending by time, split into the two series each chart draws.
  const weightData = useMemo(() => {
    const rows = (vitals ?? [])
      .filter(v => typeof v.weightKg === 'number')
      .map(v => ({ t: new Date(v.measuredAt).getTime(), label: fmtDay(v.measuredAt), weight: v.weightKg as number }))
      .sort((a, b) => a.t - b.t)
    const line = fit(rows.map(r => ({ t: r.t, y: r.weight })))
    return rows.map(r => ({ ...r, trend: line ? line.a + line.b * r.t : undefined }))
  }, [vitals])

  const bpData = useMemo(() => (vitals ?? [])
    .filter(v => typeof v.systolic === 'number' && typeof v.diastolic === 'number')
    .map(v => ({
      t: new Date(v.measuredAt).getTime(), label: fmtDay(v.measuredAt),
      systolic: v.systolic as number, diastolic: v.diastolic as number,
      pulse: typeof v.pulse === 'number' ? v.pulse : undefined,
    }))
    .sort((a, b) => a.t - b.t), [vitals])

  const recent = (vitals ?? []).slice(0, 12)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setAdding('weight')}>
          <Scale size={14} /> Log weight
        </button>
        <button className="btn" onClick={() => setAdding('bp')}>
          <HeartPulse size={14} /> Log blood pressure
        </button>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <ChartCard
          title="Body weight"
          icon={<Scale size={14} color={WEIGHT_COLOR} />}
          description="Every weigh-in, with your target and a trend line."
          info="Logging a weight here updates your profile weight, and changing that weight in Settings appears here — they are the same number. The dashed line is the direction of travel; the flat line is your target."
        >
          {weightData.length === 0 ? (
            <EmptyPlot height={220}>No weight logged yet</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={weightData} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={['auto', 'auto']} unit=" kg" />
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
                  <ReferenceLine y={target} stroke={TARGET_COLOR} strokeDasharray="4 4" strokeOpacity={0.7}
                    label={{ value: `Target ${target} kg`, position: 'insideTopRight', fill: TARGET_COLOR, fontSize: 10 }} />
                )}
                <Line type="monotone" dataKey="weight" stroke={WEIGHT_COLOR} {...DATA_LINE} dot={{ r: 3, fill: WEIGHT_COLOR, strokeWidth: 0 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="trend" stroke={WEIGHT_COLOR} {...TREND_LINE} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Blood pressure"
          icon={<HeartPulse size={14} color={SYSTOLIC_COLOR} />}
          description="Systolic and diastolic, with pulse when recorded."
          info="Each point is one reading. The two lines are the pressures in mmHg; pulse, when you entered it, shares the axis in bpm."
        >
          {bpData.length === 0 ? (
            <EmptyPlot height={220}>No blood pressure logged yet</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={bpData} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={['auto', 'auto']} />
                <Tooltip
                  cursor={{ stroke: HOVER_FILL }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as { label: string; systolic: number; diastolic: number; pulse?: number }
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.label}</div>
                        <div style={{ color: SYSTOLIC_COLOR }}>{d.systolic}/{d.diastolic} mmHg</div>
                        {typeof d.pulse === 'number' && <div style={{ color: PULSE_COLOR }}>{d.pulse} bpm</div>}
                      </div>
                    )
                  }}
                />
                <Line type="monotone" dataKey="systolic" stroke={SYSTOLIC_COLOR} {...DATA_LINE} dot={{ r: 3, fill: SYSTOLIC_COLOR, strokeWidth: 0 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="diastolic" stroke={DIASTOLIC_COLOR} {...DATA_LINE} dot={{ r: 3, fill: DIASTOLIC_COLOR, strokeWidth: 0 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="pulse" stroke={PULSE_COLOR} {...DATA_LINE} dot={{ r: 2, fill: PULSE_COLOR, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {recent.length > 0 && (
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
                <button className="btn-icon vitals-row-del" onClick={() => onDelete(v.id)} aria-label="Delete measurement" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {adding && (
        <VitalQuickAdd mode={adding} onClose={() => setAdding(null)} onAdded={onAdded} />
      )}
    </>
  )
}
