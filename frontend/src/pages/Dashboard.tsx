import { useEffect, useMemo, useState } from 'react'
import { useWorkouts } from '../context/WorkoutsContext'
import { fmtDuration, fmtDist, fmtRate, TYPE_COLOR, type Workout, type WorkoutType } from '../data/workouts'
import TypeIcon from '../components/TypeIcon'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  RadialBarChart, RadialBar,
} from 'recharts'
import { TrendingUp, Zap, Flame, Clock, Mountain, Heart, Trophy, Target, Activity, Footprints, ChartColumnBig } from 'lucide-react'
import { useLocalStorage } from '../lib/useLocalStorage'
import { useIsMobile } from '../lib/useIsMobile'
import InfoTip from '../components/InfoTip'
import Sparkline from '../components/Sparkline'
import { api, type Equipment } from '../lib/api'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL, recencyRamp } from '../lib/chartColors'
import {
  DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG, windowLabel,
  type DashboardConfig, type StatCardId,
} from '../lib/dashboardConfig'
import {
  deltaPct, describeGoal, formReading, gearNudges, goalProgress, recentPersonalBests,
  recentWeekStarts, sparkBuckets, totalsOf, weekdayMatrix, windowSlices,
  type Goal, type GoalProgress,
} from '../lib/insights'

/** Weeks shown in the dashboard's compact weekly-trend chart. */
const TREND_WEEKS = 3
/** Replacement distance per equipment type; mirrors the backend default. */
const DEFAULT_RETIRE_KM: Record<string, number> = { shoes: 600 }

function DeltaBadge({ pct, invert }: { pct: number | null; invert?: boolean }) {
  if (pct == null || pct === 0) return null
  // For most metrics more is progress; for pace-like ones less is better.
  const good = invert ? pct < 0 : pct > 0
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
      color: good ? 'var(--success)' : 'var(--danger)',
    }}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

function StatCard({ icon, label, value, unit, sub, delta, spark, color }: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  sub?: string
  delta?: number | null
  spark?: number[]
  color?: string
}) {
  // The sparkline is a fixed-size SVG, so the size has to be chosen here rather
  // than by CSS — hence the hook in a presentational component.
  const isMobile = useIsMobile()

  return (
    <div className="card stat-card">
      <div className="stat-card-head">
        {icon}
        <span className="stat-card-label">{label}</span>
      </div>
      <div className="stat-card-value-row">
        <span className="stat-card-value">{value}</span>
        {unit && <span className="stat-card-unit">{unit}</span>}
        {delta !== undefined && <span className="stat-card-delta"><DeltaBadge pct={delta} /></span>}
      </div>
      {spark && spark.length > 1 && (
        <span className="stat-card-spark">
          <Sparkline
            values={spark}
            color={color ?? 'var(--primary)'}
            width={isMobile ? 68 : 110}
            height={isMobile ? 16 : 22}
          />
        </span>
      )}
      {sub && <span className="stat-card-sub">{sub}</span>}
    </div>
  )
}

function WorkoutRow({ w, onOpen }: { w: Workout; onOpen: () => void }) {
  return (
    <button className="dash-workout-row" onClick={onOpen}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: `${TYPE_COLOR[w.type]}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        <TypeIcon type={w.type} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{new Date(`${w.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{fmtDist(w.distance)}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>{fmtDuration(w.duration)}</div>
      </div>
    </button>
  )
}

/** The most recent workout, with the headline numbers and a way into it. */
function LatestActivity({ w, onOpen }: { w: Workout; onOpen: () => void }) {
  const rate = fmtRate(w)
  const stats = [
    { label: 'Distance', value: fmtDist(w.distance) },
    { label: 'Duration', value: fmtDuration(w.duration) },
    { label: 'Avg HR', value: `${w.avgHR} bpm` },
    { label: 'Elevation', value: `${Math.round(w.elevationGain)} m` },
    { label: 'Calories', value: `${w.calories} kcal` },
    // Labelled by what it actually is: a ride reports speed, not pace, and a
    // strength session reports neither.
    {
      label: rate.unit === 'km/h' ? 'Avg Speed' : 'Avg Pace',
      value: [rate.value, rate.unit].filter(Boolean).join(' '),
    },
  ]

  return (
    <div className="card" style={{ background: 'var(--bg-2)', position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 120, height: 120,
        background: `radial-gradient(circle at 80% 20%, ${TYPE_COLOR[w.type]}18 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      {/* The same title row as every other panel. This card used to lead with a
          mono micro-label and put the workout name in the heading slot, which
          made it the odd one out. */}
      <div className="chart-card-head">
        <h3 className="chart-card-title">Latest Activity</h3>
        <span className={`badge tag-${w.type.toLowerCase()}`} style={{ marginLeft: 'auto' }}>
          <TypeIcon type={w.type} size={12} /> {w.type}
        </span>
      </div>
      <button className="latest-activity-link" onClick={onOpen}>
        <span className="latest-activity-name">{w.name}</span>
        <span className="latest-activity-date">
          {new Date(`${w.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {stats.map(s => (
          <div key={s.label} className="stat-chip">
            <span className="label">{s.label}</span>
            <span className="value" style={{ fontSize: 14 }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One goal's progress. The count is the point of the tile — it leads at full
 * size, and the description and streak sit behind a divider in muted type so
 * the eye lands on the number first.
 */
function GoalRow({ progress: p }: { progress: GoalProgress }) {
  const met = p.current >= p.goal.count
  const unit = p.goal.period === 'month' ? 'month' : 'week'
  return (
    <div className={`goal-tile${met ? ' met' : ''}`}>
      <div className="goal-tile-head">
        <span
          className="goal-figure"
          aria-label={`${p.current} of ${p.goal.count} ${describeGoal(p.goal)}`}
        >
          <span className="goal-figure-current">{p.current}</span>
          <span className="goal-figure-total">/{p.goal.count}</span>
        </span>

        <span className="goal-divider" aria-hidden="true" />

        <span className="goal-meta">
          {describeGoal(p.goal)}
          <span className="goal-meta-streak">
            best {p.bestStreak} {p.bestStreak === 1 ? unit : `${unit}s`}
          </span>
        </span>

        {p.streak > 0 && (
          <span className="goal-flame" title={`${p.streak} ${p.streak === 1 ? unit : `${unit}s`} in a row`}>
            <Flame size={12} /> {p.streak}
          </span>
        )}
      </div>

      <div className="goal-history">
        {p.history.map(h => (
          <span
            key={h.key}
            className={h.met ? 'met' : undefined}
            title={`${unit === 'month' ? 'Month' : 'Week'} of ${h.key}: ${h.count} ${h.count === 1 ? 'activity' : 'activities'}`}
          />
        ))}
      </div>
    </div>
  )
}

/** One "this week vs your usual week" row: a value, a norm, and a bar. */
function CompareRow({ label, value, average, format }: {
  label: string
  value: number
  average: number
  format: (v: number) => string
}) {
  const pct = average > 0 ? Math.min(value / average, 2) / 2 : value > 0 ? 1 : 0
  const ahead = average > 0 && value >= average
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
        <span style={{ color: 'var(--text-3)' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{format(value)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>vs {format(average)}</span>
      </div>
      <div style={{ position: 'relative', background: 'var(--bg-3)', borderRadius: 99, height: 5 }}>
        {/* The midpoint marks a typical week, so a bar past halfway is ahead. */}
        <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--border-strong)' }} />
        <div style={{ width: `${pct * 100}%`, height: '100%', background: ahead ? 'var(--primary)' : 'var(--text-3)', borderRadius: 99, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

export default function Dashboard({ onSelect }: { onSelect: (w: Workout) => void }) {
  const { workouts, loading } = useWorkouts()
  const [cfg] = useLocalStorage<DashboardConfig>(DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG)
  const [goals, setGoals] = useState<Goal[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])

  useEffect(() => {
    let active = true
    api.getPreferences()
      .then(p => {
        if (!active) return
        setGoals((p.goals ?? []).filter(g => g.count > 0).map(g => ({
          id: g.id || `${g.period}-${g.type}-${g.count}`,
          count: g.count,
          period: g.period === 'month' ? 'month' : 'week',
          type: g.type as WorkoutType | '',
          minKm: g.minKm,
        })))
      })
      .catch(() => { /* goal tile simply stays hidden */ })
    api.listEquipment().then(e => { if (active) setEquipment(e) }).catch(() => {})
    return () => { active = false }
  }, [])

  const showDeltas = cfg.showDeltas !== false && cfg.windowDays > 0
  const showSparklines = cfg.showSparklines !== false

  const d = useMemo(() => {
    const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date))
    const { current, previous } = windowSlices(workouts, cfg.windowDays)
    const now = totalsOf(current)
    const before = previous ? totalsOf(previous) : null

    const typeCount: Record<string, number> = {}
    for (const w of current) typeCount[w.type] = (typeCount[w.type] || 0) + 1

    const radialData = (['Run', 'Ride', 'Hike', 'Swim', 'Strength'] as WorkoutType[]).map(t => ({
      name: t, value: typeCount[t] || 0, fill: `var(--${t.toLowerCase()})`,
    }))

    // Weekday × week matrix, the compact sibling of the Consistency page's
    // week-over-week chart.
    const weeks = recentWeekStarts(TREND_WEEKS)
    const trendData = weekdayMatrix(workouts, weeks, w => w.duration / 3600)
      .map(row => {
        const out: Record<string, string | number> = { day: row.day }
        for (const w of weeks) out[w] = Math.round((row[w] as number) * 10) / 10
        return out
      })

    // "This week vs your usual week": the current week against the mean of the
    // twelve completed weeks before it, which smooths out one-off big weeks.
    const allWeeks = recentWeekStarts(13)
    const thisWeekKey = allWeeks[allWeeks.length - 1]
    const priorKeys = allWeeks.slice(0, -1)
    const perWeek = new Map<string, { days: Set<string>; hours: number; km: number }>()
    for (const key of allWeeks) perWeek.set(key, { days: new Set(), hours: 0, km: 0 })
    for (const w of workouts) {
      const key = recentWeekStarts(1, new Date(`${w.date}T00:00:00`))[0]
      const bucket = perWeek.get(key)
      if (!bucket) continue
      bucket.days.add(w.date)
      bucket.hours += w.duration / 3600
      bucket.km += w.distance / 1000
    }
    const thisWeek = perWeek.get(thisWeekKey)!
    const mean = (pick: (b: { days: Set<string>; hours: number; km: number }) => number) =>
      priorKeys.reduce((a, k) => a + pick(perWeek.get(k)!), 0) / priorKeys.length

    return {
      sorted,
      latest: sorted[0],
      current,
      now,
      before,
      typeCount,
      radialData,
      trendData,
      trendWeeks: [...weeks].reverse(),
      thisWeek: { days: thisWeek.days.size, hours: thisWeek.hours, km: thisWeek.km },
      usualWeek: { days: mean(b => b.days.size), hours: mean(b => b.hours), km: mean(b => b.km) },
    }
  }, [workouts, cfg.windowDays])

  const progress = useMemo(() => goals.map(g => goalProgress(workouts, g)), [workouts, goals])
  const bests = useMemo(() => recentPersonalBests(workouts), [workouts])
  const form = useMemo(() => formReading(workouts), [workouts])
  const nudges = useMemo(
    () => gearNudges(equipment, t => DEFAULT_RETIRE_KM[t] ?? 0),
    [equipment],
  )
  const trendRamp = recencyRamp(d.trendWeeks.length)

  const caption = windowLabel(cfg.windowDays)
  const spark = (valueOf: (w: Workout) => number) =>
    showSparklines ? sparkBuckets(workouts, cfg.windowDays, 8, valueOf) : undefined
  const delta = (pick: (t: typeof d.now) => number) =>
    showDeltas && d.before ? deltaPct(pick(d.now), pick(d.before)) : undefined

  const allCards: Record<StatCardId, React.ReactNode> = {
    distance: <StatCard key="distance" icon={<TrendingUp size={14} />} label="Total Distance" value={(d.now.distance / 1000).toFixed(0)} unit="km" sub={caption} delta={delta(t => t.distance)} spark={spark(w => w.distance)} />,
    time: <StatCard key="time" icon={<Clock size={14} />} label="Total Time" value={Math.floor(d.now.duration / 3600).toString()} unit="hrs" sub={caption} delta={delta(t => t.duration)} spark={spark(w => w.duration)} color="var(--purple)" />,
    elevation: <StatCard key="elevation" icon={<Mountain size={14} />} label="Elevation" value={(d.now.elevation / 1000).toFixed(1)} unit="km" sub={`total gain · ${caption}`} delta={delta(t => t.elevation)} spark={spark(w => w.elevationGain)} color="var(--hike)" />,
    calories: <StatCard key="calories" icon={<Flame size={14} />} label="Calories" value={(d.now.calories / 1000).toFixed(1)} unit="kcal ×1k" sub={`energy expended · ${caption}`} delta={delta(t => t.calories)} spark={spark(w => w.calories)} color="var(--accent)" />,
    avgHr: <StatCard key="avgHr" icon={<Heart size={14} />} label="Avg Heart Rate" value={d.now.avgHR.toString()} unit="bpm" sub={caption} delta={delta(t => t.avgHR)} />,
    activities: <StatCard key="activities" icon={<Zap size={14} />} label="Activities" value={d.now.count.toString()} unit="" sub={`${Object.keys(d.typeCount).length} sport types · ${caption}`} delta={delta(t => t.count)} spark={spark(() => 1)} color="var(--blue)" />,
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Dashboard</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {d.now.count} activities · {caption}
          </span>
        </div>
      </div>

      <div className="page-content">
        {loading && workouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
        ) : workouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
            <ChartColumnBig size={32} style={{ margin: '0 auto 12px' }} strokeWidth={1.5} />
            <p style={{ fontSize: 14 }}>No workouts yet — import a file or add one manually to get started.</p>
          </div>
        ) : (
          <>
            {/* Personal best banner — only when the newest activity actually
                beat every previous one of its type. */}
            {bests.length > 0 && (
              <div
                className="card"
                style={{
                  marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                  borderColor: 'var(--primary)', background: 'var(--primary-dim)',
                }}
              >
                <Trophy size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>
                    {bests.length === 1 ? 'New personal best' : `${bests.length} new personal bests`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                    {bests[0].workout.name} · {new Date(`${bests[0].workout.date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {bests.map(b => (
                    <span key={b.kind} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 10px', borderRadius: 8, background: 'var(--bg-2)' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{b.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{b.value}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stats grid (configurable) */}
            {cfg.cards.length > 0 && (
              <div className="stat-cards">
                {cfg.cards.map(id => allCards[id])}
              </div>
            )}

            {/* Goal / this week / form */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div className="card">
                <div className="chart-card-head">
                  <Target size={14} style={{ color: 'var(--primary)' }} />
                  <h3 className="chart-card-title">Goals</h3>
                  <InfoTip
                    label="Goals"
                    text="Progress against each goal you set under Settings → Training Goals, weekly and monthly tracked separately. A streak counts consecutive periods that met the target; the period in progress extends a streak once you hit it but never breaks one, so a quiet Monday costs you nothing. The bars show the last eight periods, oldest on the left. Distance minimums are matched against the figure shown on the workout, so a run listed as 5.0 km counts toward a 5 km goal."
                  />
                </div>
                {progress.length === 0 ? (
                  <p className="chart-card-desc" style={{ marginBottom: 0 }}>
                    No goals set. Add one under Settings → Training Goals — for example two runs of
                    at least 5 km a week — and this tile will track your streak.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {progress.map(p => <GoalRow key={p.goal.id} progress={p} />)}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="chart-card-head">
                  <Activity size={14} style={{ color: 'var(--blue)' }} />
                  <h3 className="chart-card-title">This Week</h3>
                  <InfoTip
                    label="This Week"
                    text="The week so far against your usual week, where 'usual' is the mean of the twelve completed weeks before this one. The tick in the middle of each bar marks that average, so a bar past halfway means you're ahead of your normal pace. Early in the week everything sits low by definition — it's most useful from midweek on."
                  />
                </div>
                <p className="chart-card-desc">Compared with your average of the last 12 weeks.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <CompareRow label="Days trained" value={d.thisWeek.days} average={d.usualWeek.days} format={v => v.toFixed(v < 10 ? 1 : 0)} />
                  <CompareRow label="Hours" value={d.thisWeek.hours} average={d.usualWeek.hours} format={v => `${v.toFixed(1)}h`} />
                  <CompareRow label="Distance" value={d.thisWeek.km} average={d.usualWeek.km} format={v => `${v.toFixed(1)} km`} />
                </div>
              </div>

              {form && (
                <div className="card">
                  <div className="chart-card-head">
                    <Flame size={14} style={{ color: form.verdict === 'ramping' ? 'var(--danger)' : 'var(--primary)' }} />
                    <h3 className="chart-card-title">Training Load</h3>
                    <InfoTip
                      label="Training Load"
                      text="Compares your average daily effort over the last 7 days with the last 28. Around 1.0 means this week matches what your body is used to; higher means you're building, lower means you're easing off. It only appears once you have six weeks of history and a dozen heart-rate activities, because below that a single session swings it wildly. Treat it as a description of your load, not a medical verdict — the injury-risk thresholds this metric is known for are debated in the research."
                    />
                    <span className="chart-card-actions" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: form.verdict === 'ramping' ? 'var(--danger)' : form.verdict === 'detraining' ? 'var(--text-3)' : 'var(--primary)' }}>
                      {form.ratio.toFixed(2)}
                    </span>
                  </div>
                  <p className="chart-card-desc" style={{ marginBottom: 10 }}>7-day load against your 28-day average.</p>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{form.headline}</div>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>{form.detail}</p>
                </div>
              )}
            </div>

            {/* Gear nudge */}
            {nudges.length > 0 && (
              <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <Footprints size={18} style={{ color: nudges[0].overdue ? 'var(--warning)' : 'var(--text-3)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {nudges[0].name} · {nudges[0].km.toLocaleString()} km
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                    {nudges[0].overdue
                      ? `Past its ${nudges[0].limitKm.toLocaleString()} km replacement distance — worth checking the wear.`
                      : `Approaching its ${nudges[0].limitKm.toLocaleString()} km replacement distance.`}
                    {nudges.length > 1 && ` (${nudges.length - 1} more)`}
                  </div>
                </div>
                <InfoTip
                  label="Gear wear"
                  text="Total distance across every workout this gear is linked to, against its replacement distance. That threshold is per-item and editable on the Equipment page; shoes default to 600 km when you haven't set one. Only unretired gear with a distance-based wear limit appears here, and the most worn item is always the one shown."
                />
              </div>
            )}

            <div className="grid-dash" style={{ marginBottom: 16 }}>
              {/* Weekly trend: the compact sibling of Consistency → Compare. */}
              <div className="card">
                <div className="chart-card-head">
                  <h3 className="chart-card-title">Weekly Trend</h3>
                  <InfoTip
                    label="Weekly Trend"
                    text={`Training hours by weekday for the last ${TREND_WEEKS} weeks, this week in the strongest colour. Reading down a weekday shows whether that slot is a habit; reading across shows whether your week is holding its shape. Consistency → Compare has the same chart over five weeks, plus activity counts.`}
                  />
                  <span className="chart-card-actions" style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>hours</span>
                </div>
                <p className="chart-card-desc">The last {TREND_WEEKS} weeks, day by day.</p>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={d.trendData} margin={{ top: 8, right: 8, left: 4, bottom: 18 }} barCategoryGap="20%" barGap={2}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} label={{ value: 'Day of week', position: 'insideBottom', offset: -12, fontSize: 10, fill: 'var(--text-3)' }} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} label={{ value: 'Hours', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--text-3)', style: { textAnchor: 'middle' } }} />
                    <Tooltip
                      cursor={{ fill: HOVER_FILL, opacity: 0.5 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const shown = payload.filter(p => Number(p.value) > 0)
                        return (
                          <div className="custom-tooltip">
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                            {shown.length === 0
                              ? <div style={{ color: 'var(--text-3)' }}>Rest day</div>
                              : shown.map(p => (
                                <div key={p.dataKey as string} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                                  w/c {String(p.dataKey).slice(5)}: {Number(p.value).toFixed(1)}h
                                </div>
                              ))}
                          </div>
                        )
                      }}
                    />
                    <Legend
                      verticalAlign="top" align="right" height={24}
                      wrapperStyle={{ fontSize: 10, paddingBottom: 4 }}
                      formatter={value => String(value) === d.trendWeeks[0] ? 'This week' : `w/c ${String(value).slice(5)}`}
                    />
                    {d.trendWeeks.map((week, i) => (
                      <Bar key={week} dataKey={week} fill={trendRamp[i]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Radial type breakdown: legend on the left, chart on the right (desktop) */}
              <div className="card">
                <div className="chart-card-head">
                  <h3 className="chart-card-title">Activity Mix</h3>
                  <InfoTip
                    label="Activity Mix"
                    text="How many activities of each type you logged in the dashboard's time window, which you can change under Settings → Dashboard. Ring length is proportional to the count, so it shows the balance of your training rather than how much time or distance each sport took."
                  />
                  <span className="chart-card-actions" style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{caption}</span>
                </div>
                <p className="chart-card-desc">Share of activities by sport over the {caption}.</p>
                <div className="activity-mix-body">
                  <div className="activity-mix-legend">
                    {d.radialData.map(r => (
                      <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: r.fill, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        </div>
                        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="activity-mix-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart innerRadius="34%" outerRadius="92%" data={d.radialData} startAngle={90} endAngle={-270}>
                        <RadialBar dataKey="value" background={{ fill: 'var(--bg-3)' }} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Latest workout + recent list */}
            <div className="grid-2">
              {d.latest && <LatestActivity w={d.latest} onOpen={() => onSelect(d.latest)} />}

              {/* Recent list */}
              <div className="card">
                <div className="chart-card-head" style={{ marginBottom: 4 }}>
                  <h3 className="chart-card-title">Recent Activities</h3>
                  <InfoTip label="Recent Activities" text="Your most recently recorded activities, newest first, by activity date rather than import date. Open one from the Workouts page to see its full detail view with charts and route map." />
                </div>
                <div>
                  {d.sorted.slice(0, 5).map(w => <WorkoutRow key={w.id} w={w} onOpen={() => onSelect(w)} />)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
