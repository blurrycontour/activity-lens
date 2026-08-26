import { useEffect, useMemo, useState } from 'react'
import { useWorkouts } from '../context/WorkoutsContext'
import { fmtDuration, fmtDist, fmtRate, fmtTotal, fmtCompact, TYPE_COLOR, type Workout, type WorkoutType } from '../data/workouts'
import TypeIcon from '../components/TypeIcon'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  RadialBarChart, RadialBar,
} from 'recharts'
import { TrendingUp, Zap, Flame, Clock, Mountain, Heart, Trophy, Target, Activity, Footprints, ChartColumnBig, Play } from 'lucide-react'
import SpeedDial from '../components/SpeedDial'
import { PAGE_META } from '../components/Sidebar'
import Confetti from '../components/Confetti'
import GoalSportMark, { goalColor } from '../components/GoalSportMark'
import { buzz } from '../lib/sessionFeedback'
import { dayMonth, fromDateKey, longDate } from '../lib/date'
import { useLocalStorage } from '../lib/useLocalStorage'
import { useIsMobile } from '../lib/useIsMobile'
import InfoTip from '../components/InfoTip'
import Sparkline from '../components/Sparkline'
import { api, type Equipment } from '../lib/api'
import { clockLabel, elapsedSec } from '../data/plans'
import { useActiveSession } from '../context/ActiveSessionContext'
import useTicker from '../lib/useTicker'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL, recencyRamp } from '../lib/chartColors'
import { END_PADDING } from '../components/ChartAxis'
import { useThemeTokens } from '../lib/useThemeTokens'
import {
  DASHBOARD_CFG_KEY, defaultDashboardConfig, resolveGoalStyle, windowLabel,
  type DashboardConfig, type GoalStyle, type StatCardId,
} from '../lib/dashboardConfig'
import {
  deltaPct, describeGoal, describeGoalMinimum, formatGoalAmount, formReading, gearNudges, goalFromApi, goalProgress,
  goalUnit, periodLabel, recentPersonalBests, recentWeekStarts, sparkAverages, sparkBuckets, totalsOf, weekdayMatrix,
  windowSlices, type Goal, type GoalProgress,
} from '../lib/insights'

/** Weeks shown in the dashboard's compact weekly-trend chart. */
const TREND_WEEKS = 3
/** Marks that this app session already celebrated a full set of goals. */
const CELEBRATED_KEY = 'al_goals_celebrated'
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
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{dayMonth(fromDateKey(w.date))}</div>
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
          {longDate(fromDateKey(w.date))}
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

/** Display options the goals card reads, bundled so styles share one signature. */
interface GoalViewOpts {
  style: GoalStyle
  showHistory: boolean
  showPeriods: boolean
}

/** The unit a streak is counted in — a week, a month, or a run of either. */
function streakUnit(g: GoalProgress['goal']): string {
  return g.span > 1 ? 'period' : g.period
}

/** The full sentence for a goal, minimums included — for tooltips, not tiles. */
function goalTitle(g: GoalProgress['goal']): string {
  const min = describeGoalMinimum(g)
  return min ? `${describeGoal(g)} — ${min}` : describeGoal(g)
}

/**
 * The trophy and the streak, in that order, for every style.
 *
 * Both were previously Classic's alone, which made the other three feel like
 * downgrades rather than alternatives — the streak in particular is the one
 * number people come back for, and it has no reason to depend on which layout
 * is selected.
 */
/**
 * Timings for one medal, from its place in the list.
 *
 * Two offsets, because the two animations want opposite things from a stagger.
 *
 * The flip is an arrival: a short cascade down the card reads as one gesture,
 * and anything longer reads as medals that forgot to show up — at 0.7s apiece
 * the third was still waiting most of a second after the first had landed.
 * A tenth of a second each keeps the run under half a second whatever the
 * count.
 *
 * The shine is a loop, and wants the opposite: the offsets should be spread as
 * widely as possible inside its three-second period so no two medals flash
 * together. The step is deliberately not a factor of that period, or every
 * fourth medal would come back into step with the first.
 *
 * Inline custom properties rather than nth-child rules, which is what this
 * replaced: those keyed on a row's position inside three named containers, so
 * any other layout silently fell back to no offset and everything flashed in
 * unison.
 */
function awardPhase(index: number): React.CSSProperties {
  return {
    '--award-in-delay': `${(index * 0.1).toFixed(2)}s`,
    '--award-delay': `${((index * 0.77) % 3).toFixed(2)}s`,
  } as React.CSSProperties
}

function GoalBadges({ p, compact, index = 0 }: { p: GoalProgress; compact?: boolean; index?: number }) {
  const met = p.current >= p.goal.target
  const unit = streakUnit(p.goal)
  if (!met && p.streak <= 0) return null
  return (
    <span className="goal-badges">
      {met && (
        <span
          className="goal-award"
          title={`Target met this ${unit}`}
          aria-label="Target met"
          style={awardPhase(index)}
        >
          <Trophy size={compact ? 11 : 13} strokeWidth={2.25} />
        </span>
      )}
      {p.streak > 0 && (
        <span className="goal-flame" title={`${p.streak} ${p.streak === 1 ? unit : `${unit}s`} in a row`}>
          <Flame size={compact ? 10 : 12} /> {p.streak}
        </span>
      )}
    </span>
  )
}

/**
 * The progress bar, with the optional "where you should be today" needle.
 *
 * One component for Classic and Pace: they draw the same bar, and the needle is
 * useful in both — a reference point is what lets a bar say "behind" at all,
 * which is not a thing only one layout should be able to do.
 */
function GoalBar({ p, needle }: { p: GoalProgress; needle: boolean }) {
  const met = p.current >= p.goal.target
  const pct = p.goal.target > 0 ? Math.min(1, p.current / p.goal.target) : 0
  // Suppressed at the very start of a window, where the marker sits against the
  // left edge and reads as failure rather than as "nothing has happened yet".
  const showNeedle = needle && p.elapsed > 0.06 && !met
  return (
    <div
      className="goal-pace-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={p.goal.target}
      aria-valuenow={Math.round(p.current * 10) / 10}
      aria-label={describeGoal(p.goal)}
    >
      <span className="goal-pace-fill" style={{ width: `${pct * 100}%`, background: goalColor(p.goal.type) }} />
      {showNeedle && (
        <span
          className="goal-pace-needle"
          style={{ left: `${p.elapsed * 100}%` }}
          title="Where you would be exactly on schedule"
        />
      )}
    </div>
  )
}

/** How far past target a period must go to earn its "+". */
const OVERSHOOT = 1.25

/**
 * The run of recent windows: pass/fail per period, with a "+" where the target
 * was clearly beaten. Shared by every style, at two densities — the compact one keeps
 * the ledger and the rings from turning into a chart.
 */
function GoalHistory({ p, showPeriods, compact }: {
  p: GoalProgress
  showPeriods: boolean
  compact?: boolean
}) {
  return (
    <div className={`goal-history${compact ? ' compact' : ''}`}>
      {p.history.map(h => {
        // A period that comfortably beat its target is worth more than a filled
        // bar, so it is marked — but only comfortably. Any margin at all put a
        // "+" on almost every met period, which made the mark mean "met", which
        // the filled bar already said. A quarter again is a week you would
        // notice having had.
        const over = p.goal.target > 0 && h.value >= p.goal.target * OVERSHOOT
        return (
          <span className="goal-history-cell" key={h.key}>
            <span
              className={`goal-history-bar${h.met ? ' met' : ''}${over ? ' over' : ''}`}
              style={{ '--goal-hue': goalColor(p.goal.type) } as React.CSSProperties}
              title={`From ${h.key}: ${formatGoalAmount(p.goal, h.value)}${
                p.goal.metric === 'count' ? (h.value === 1 ? ' activity' : ' activities') : ''
              }${over ? ' — target beaten by a quarter or more' : ''}`}
            >
              {over && !compact ? '+' : ''}
            </span>
            {showPeriods && !compact && (
              <span className="goal-history-label">{periodLabel(h.key, p.goal.period)}</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

/**
 * How the current window is going, against how far through it you are.
 *
 * Returned as a short phrase because that is all there is room for, and because
 * "1.4 km to go" is a task while "47%" is a grade. The dead band matters:
 * without it the tile would flip between "ahead" and "behind" on rounding, and
 * a panel that changes its verdict while you look at it is not trusted.
 */
function paceVerdict(p: GoalProgress): { text: string; tone: 'done' | 'ahead' | 'on' | 'behind' } {
  if (p.current >= p.goal.target) return { text: 'done', tone: 'done' }
  if (p.elapsed <= 0.06) return { text: 'just started', tone: 'on' }
  const expected = p.goal.target * p.elapsed
  const diff = p.current - expected
  if (Math.abs(diff) <= p.goal.target * 0.04) return { text: 'on pace', tone: 'on' }
  if (diff > 0) return { text: `${formatGoalAmount(p.goal, diff)} ahead`, tone: 'ahead' }
  return { text: `${formatGoalAmount(p.goal, -diff)} to go`, tone: 'behind' }
}

/** Days remaining in the window, for copy that has to feel concrete. */
function daysLeft(p: GoalProgress): number {
  const span = (p.goal.period === 'week' ? 7 : 30) * p.goal.span
  return Math.max(0, Math.round(span * (1 - p.elapsed)))
}

/**
 * Standard: the merge of what were Classic and Pace.
 *
 * Four rows: the mark, the figures and the verdict; then the description with
 * the trophy and streak; then the bar; then the history.
 */
function GoalTileStandard({ p, opts, index = 0 }: { p: GoalProgress; opts: GoalViewOpts; index?: number }) {
  const met = p.current >= p.goal.target
  const v = paceVerdict(p)
  return (
    <div className={`goal-tile${met ? ' met' : ''}`}>
      {/* One grid, not two rows: the description and the verdict sit on the
          first line, the figure and the badges on the second, and the sport
          mark spans both. The figure can then be as large as it likes — it
          grows into its own row rather than stretching the line the verdict
          is on, so nothing beside it moves. */}
      <div className="goal-std-head">
        <GoalSportMark type={p.goal.type} size={17} disc />
        <span className="goal-std-desc" title={goalTitle(p.goal)}>
          {describeGoal(p.goal)} · {daysLeft(p)}d left
        </span>
        <span className={`goal-verdict ${v.tone}`}>{v.text}</span>

        <span className="goal-std-fig">
          <span className="goal-std-cur mono" style={{ color: goalColor(p.goal.type) }}>
            {formatGoalAmount(p.goal, p.current, true)}
          </span>
          <span className="goal-std-slash mono" aria-hidden="true">/</span>
          <span className="goal-std-tot mono">{formatGoalAmount(p.goal, p.goal.target)}</span>
        </span>
        <GoalBadges p={p} index={index} />
      </div>

      <GoalBar p={p} needle />

      {opts.showHistory && <GoalHistory p={p} showPeriods={opts.showPeriods} />}
    </div>
  )
}

/**
 * Today's move: what to do now, rather than what has happened.
 *
 * The only style that is useful before a workout instead of after one. It reads
 * the goal furthest off pace and turns the arithmetic nobody does in their head
 * — target, progress, days left — into one sentence.
 */
function GoalToday({ progress, opts }: { progress: GoalProgress[]; opts: GoalViewOpts }) {
  const unmet = progress.filter(p => p.current < p.goal.target)
  // Furthest behind where it should be by now, not simply least complete: a
  // monthly goal at 40% on the 3rd is fine, a weekly one at 40% on Saturday is
  // not, and only the ratio against `elapsed` tells them apart.
  const worst = unmet.slice().sort((a, b) => {
    const ratio = (p: GoalProgress) => (p.goal.target * p.elapsed > 0
      ? p.current / (p.goal.target * p.elapsed) : 1)
    return ratio(a) - ratio(b)
  })[0]

  let headline: React.ReactNode
  let because = ''
  if (!worst) {
    headline = <>Every goal is <span className="hl">met</span>. Go out because you want to.</>
    because = progress.length > 0
      ? `All ${progress.length} done, with ${daysLeft(progress[0])} days still on the clock.`
      : ''
  } else {
    const left = worst.goal.target - worst.current
    const days = Math.max(1, daysLeft(worst))
    if (worst.goal.metric === 'count') {
      const n = Math.ceil(left)
      const noun = worst.goal.type
        ? `${worst.goal.type.toLowerCase()}${n === 1 ? '' : 's'}`
        : (n === 1 ? 'activity' : 'activities')
      headline = <><span className="hl">{n} more {noun}</span> in {days} day{days === 1 ? '' : 's'} keeps every goal alive.</>
      because = `${describeGoal(worst.goal)} is the one at risk — ${formatGoalAmount(worst.goal, worst.current)} of ${formatGoalAmount(worst.goal, worst.goal.target)}.`
    } else {
      const perDay = Math.round((left / days) * 10) / 10
      headline = (
        <>
          <span className="hl">{perDay} {goalUnit(worst.goal.metric)}</span> a day
          {worst.goal.type ? ` of ${worst.goal.type.toLowerCase()}` : ''} and you finish on target.
        </>
      )
      because = `${formatGoalAmount(worst.goal, left)} still to go across ${days} day${days === 1 ? '' : 's'}. It is the goal furthest off pace.`
    }
  }

  return (
    <div className="goal-today">
      <span className="goal-today-kicker mono">Your move</span>
      <p className="goal-today-line">{headline}</p>
      {because && <p className="goal-today-because">{because}</p>}

      <div className="goal-today-strip">
        {progress.map((p, i) => {
          const v = paceVerdict(p)
          return (
            <div className="goal-today-item" key={p.goal.id} title={goalTitle(p.goal)}>
              <GoalSportMark type={p.goal.type} size={13} />
              <span className="goal-today-name">{describeGoal(p.goal)}</span>
              <GoalBadges p={p} compact index={i} />
              <span className={`goal-verdict ${v.tone}`}>{v.text}</span>
              <span className="goal-today-amt mono">
                {formatGoalAmount(p.goal, p.current, true)}/{formatGoalAmount(p.goal, p.goal.target)}
              </span>
              {opts.showHistory && <GoalHistory p={p} showPeriods={false} compact />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Rings: one dial per goal, sized to be read across a room. */
function GoalRings({ progress, opts }: { progress: GoalProgress[]; opts: GoalViewOpts }) {
  return (
    <div className="goal-rings">
      {progress.map((p, i) => {
        const met = p.current >= p.goal.target
        const pct = p.goal.target > 0 ? Math.min(1, p.current / p.goal.target) : 0
        const R = 46
        const C = 2 * Math.PI * R
        const colour = goalColor(p.goal.type)
        // The pace tick, same reference the bar styles draw as a needle.
        const angle = (p.elapsed * 360) - 90
        const rad = (angle * Math.PI) / 180
        return (
          <div className={`goal-ring-cell${met ? ' met' : ''}`} key={p.goal.id}>
            <div className="goal-ring-wrap">
              <svg viewBox="0 0 112 112" role="img" aria-label={`${formatGoalAmount(p.goal, p.current)} of ${describeGoal(p.goal)}`}>
                <circle cx="56" cy="56" r={R} fill="none" stroke="var(--bg-3)" strokeWidth="9" />
                <circle
                  cx="56" cy="56" r={R} fill="none" stroke={colour} strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
                  transform="rotate(-90 56 56)" className="goal-ring-arc"
                />
                {p.elapsed > 0.06 && !met && (
                  <line
                    x1={56 + Math.cos(rad) * (R - 9)} y1={56 + Math.sin(rad) * (R - 9)}
                    x2={56 + Math.cos(rad) * (R + 9)} y2={56 + Math.sin(rad) * (R + 9)}
                    stroke="var(--text)" strokeWidth="2" strokeLinecap="round" opacity="0.8"
                  />
                )}
              </svg>
              <span className="goal-ring-mid">
                <span className="goal-ring-num mono" style={{ color: colour }}>
                  {formatGoalAmount(p.goal, p.current, true)}
                </span>
                <span className="goal-ring-of mono">of {formatGoalAmount(p.goal, p.goal.target)}</span>
              </span>
              {met && (
                <span className="goal-ring-award" title={`Target met this ${streakUnit(p.goal)}`} style={awardPhase(i)}>
                  <Trophy size={11} strokeWidth={2.25} />
                </span>
              )}
            </div>
            {/* Both badges sit inside the cell's existing rows — as their own
                row they were optional height, so one goal with a streak and one
                without pushed their histories out of line with each other. */}
            <span className="goal-ring-cap" title={goalTitle(p.goal)}>
              <GoalSportMark type={p.goal.type} size={11} />
              <span className="goal-ring-name">{p.goal.type || 'Any'}</span>
              {p.streak > 0 && (
                <span
                  className="goal-ring-streak mono"
                  title={`${p.streak} ${p.streak === 1 ? streakUnit(p.goal) : `${streakUnit(p.goal)}s`} in a row`}
                >
                  <Flame size={9} />{p.streak}
                </span>
              )}
            </span>
            {opts.showHistory && <GoalHistory p={p} showPeriods={false} compact />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Ledger: a monospace statement of account. No bars — the style for someone
 * tracking ten goals who wants them all on screen at once.
 */
function GoalLedger({ progress, opts }: { progress: GoalProgress[]; opts: GoalViewOpts }) {
  const met = progress.filter(p => p.current >= p.goal.target).length
  // A card can hold weekly and monthly goals at once, so there is no single
  // "days left" — the footer names the window that closes first instead.
  const soonest = progress.reduce<GoalProgress | null>(
    (a, p) => (a === null || daysLeft(p) < daysLeft(a) ? p : a), null,
  )
  return (
    <div className="goal-ledger">
      {progress.map((p, i) => {
        const v = paceVerdict(p)
        return (
          <div className="goal-ledger-row" key={p.goal.id}>
            <span className="goal-ledger-key" title={goalTitle(p.goal)}>
              <GoalSportMark type={p.goal.type} size={13} />
              <span className="goal-ledger-name">{describeGoal(p.goal)}</span>
            </span>
            {/* One cluster packed against the right edge rather than three
                shared columns. Sharing them reserved the widest streak and the
                widest verdict on every row, so a goal with neither sat beside
                two holes; the figure keeps a fixed width of its own, which is
                all that has to line up down the card. */}
            <span className="goal-ledger-right">
              <GoalBadges p={p} compact index={i} />
              <span className={`goal-verdict ${v.tone}`}>{v.text}</span>
              <span className="goal-ledger-val mono">
                {formatGoalAmount(p.goal, p.current, true)}/{formatGoalAmount(p.goal, p.goal.target)}
              </span>
            </span>
            {opts.showHistory && (
              <span className="goal-ledger-hist"><GoalHistory p={p} showPeriods={false} compact /></span>
            )}
          </div>
        )
      })}
      <div className="goal-ledger-foot mono">
        <span>{met} of {progress.length} met</span>
        {soonest && (
          <span title={`${describeGoal(soonest.goal)} closes first`}>
            next closes in {daysLeft(soonest)}d
          </span>
        )}
      </div>
    </div>
  )
}

/** The goals card body, in whichever style the user picked. */
function GoalPanel({ progress, opts }: { progress: GoalProgress[]; opts: GoalViewOpts }) {
  if (opts.style === 'rings') return <GoalRings progress={progress} opts={opts} />
  if (opts.style === 'ledger') return <GoalLedger progress={progress} opts={opts} />
  if (opts.style === 'today') return <GoalToday progress={progress} opts={opts} />
  return (
    <div className="goal-panel-stack">
      {progress.map((p, i) => <GoalTileStandard key={p.goal.id} p={p} opts={opts} index={i} />)}
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

export default function Dashboard({ onSelect, onResumeSession, onImport, onCreate }: {
  onSelect: (w: Workout) => void
  /** Opens the training session that is currently running. */
  onResumeSession: (id: string) => void
  /** Opens the import window, the same one the library's own button opens. */
  onImport: () => void
  /**
   * Starts making something on the page that owns it.
   *
   * The dashboard offers the actions; it does not implement them. Equipment
   * and plans each have a creation flow of their own — a form, a name dialog,
   * and what happens after saving — and a second copy here would be a second
   * thing to keep right. The page is opened with the flow already running.
   */
  onCreate: (what: 'equipment' | 'plan') => void
}) {
  const { workouts, loading } = useWorkouts()
  const [cfg] = useLocalStorage<DashboardConfig>(DASHBOARD_CFG_KEY, defaultDashboardConfig())
  const [goals, setGoals] = useState<Goal[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])
  // A training session left running, so the dashboard can offer the way back
  // into it. Undefined until asked; null once the answer is "none".
  // App-wide rather than fetched here: the nav shows the same thing, and two
  // copies of "is a session running" could disagree after one was finished.
  const { active: running } = useActiveSession()
  // The resume card shows a clock; without this it only moved when something
  // else on the page happened to re-render.
  useTicker(1000, !!running)

  useEffect(() => {
    let active = true
    api.getPreferences()
      .then(p => {
        if (!active) return
        setGoals((p.goals ?? []).map(goalFromApi).filter(g => g.target > 0))
      })
      .catch(() => { /* goal tile simply stays hidden */ })
    api.listEquipment().then(e => { if (active) setEquipment(e) }).catch(() => {})
    return () => { active = false }
  }, [])

  const goalOpts: GoalViewOpts = {
    style: resolveGoalStyle(cfg.goalStyle),
    showHistory: cfg.showGoalHistory !== false,
    showPeriods: cfg.showGoalPeriods === true,
  }
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

  /**
   * Every goal met, in every current window.
   *
   * Needs at least one goal: "all zero of your goals are met" is not a thing to
   * celebrate, and would rain on everyone who has never set one.
   */
  const allGoalsMet = progress.length > 0 && progress.every(p => p.current >= p.goal.target)
  const [celebrating, setCelebrating] = useState(false)
  useEffect(() => {
    if (!allGoalsMet) return
    // Once per app open rather than once per visit to this page: the dashboard
    // is the app's home and mounts again every time you navigate back to it,
    // and a confetti burst on each of those turns a reward into an obstacle.
    // sessionStorage is exactly the lifetime wanted — it ends with the tab, and
    // on Android the WebView starts a fresh one each launch.
    if (sessionStorage.getItem(CELEBRATED_KEY)) return
    sessionStorage.setItem(CELEBRATED_KEY, '1')
    setCelebrating(true)
    // The confetti is silent on a phone in a pocket. `complete` is the pattern
    // the session runner uses for finishing one, which is the same event.
    void buzz('complete')
  }, [allGoalsMet])
  const bests = useMemo(() => recentPersonalBests(workouts), [workouts])
  const form = useMemo(() => formReading(workouts), [workouts])
  const nudges = useMemo(
    () => gearNudges(equipment, t => DEFAULT_RETIRE_KM[t] ?? 0),
    [equipment],
  )
  // Recomputed when the theme or accent changes: the ramp resolves tokens to
  // literal colours, and a literal cannot follow a token it has already been
  // read from. See useThemeTokens.
  const themeTokens = useThemeTokens()
  const trendRamp = useMemo(
    () => recencyRamp(d.trendWeeks.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.trendWeeks.length, themeTokens],
  )

  const caption = windowLabel(cfg.windowDays)
  const spark = (valueOf: (w: Workout) => number) =>
    showSparklines ? sparkBuckets(workouts, cfg.windowDays, 8, valueOf) : undefined
  // Heart rate is the one stat that is an average rather than a total, so its
  // sparkline has to be one too — see sparkAverages. It had no sparkline at
  // all, because the summing version would have drawn a meaningless line.
  const sparkAvg = (valueOf: (w: Workout) => number) =>
    showSparklines ? sparkAverages(workouts, cfg.windowDays, 8, valueOf) : undefined
  const delta = (pick: (t: typeof d.now) => number) =>
    showDeltas && d.before ? deltaPct(pick(d.now), pick(d.before)) : undefined

  const allCards: Record<StatCardId, React.ReactNode> = {
    distance: <StatCard key="distance" icon={<TrendingUp size={14} />} label="Total Distance" {...fmtTotal(d.now.distance)} sub={caption} delta={delta(t => t.distance)} spark={spark(w => w.distance)} />,
    time: <StatCard key="time" icon={<Clock size={14} />} label="Total Time" value={Math.floor(d.now.duration / 3600).toString()} unit="hrs" sub={caption} delta={delta(t => t.duration)} spark={spark(w => w.duration)} color="var(--purple)" />,
    elevation: <StatCard key="elevation" icon={<Mountain size={14} />} label="Elevation" {...fmtTotal(d.now.elevation)} sub={`total gain · ${caption}`} delta={delta(t => t.elevation)} spark={spark(w => w.elevationGain)} color="var(--hike)" />,
    calories: <StatCard key="calories" icon={<Flame size={14} />} label="Calories" value={fmtCompact(d.now.calories)} unit="kcal" sub={`energy expended · ${caption}`} delta={delta(t => t.calories)} spark={spark(w => w.calories)} color="var(--accent)" />,
    avgHr: <StatCard key="avgHr" icon={<Heart size={14} />} label="Avg Heart Rate" value={d.now.avgHR.toString()} unit="bpm" sub={caption} delta={delta(t => t.avgHR)} spark={sparkAvg(w => w.avgHR)} color="var(--danger)" />,
    activities: <StatCard key="activities" icon={<Zap size={14} />} label="Activities" value={d.now.count.toString()} unit="" sub={`${Object.keys(d.typeCount).length} sport types · ${caption}`} delta={delta(t => t.count)} spark={spark(() => 1)} color="var(--blue)" />,
  }

  return (
    <div>
      {celebrating && <Confetti onDone={() => setCelebrating(false)} />}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 className="page-header-title">Dashboard</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {d.now.count} activities · {caption}
          </span>
        </div>
      </div>

      {/* The one page that is about everything, so its button has to ask what.
          Workouts land in the import window, which has its own way of ending —
          a batch has no single thing to open — while the other two hand over
          to the page that owns them and end up on what they just made. */}
      <SpeedDial
        label="Add"
        actions={[
          /* The same marks the navigation uses for the three pages these
             land on, read from the one place that owns them. A plus here was
             the toggle's own icon repeated, which named nothing. */
          { id: 'workout', label: 'Workout', icon: PAGE_META.workouts?.icon(19), onSelect: onImport },
          { id: 'equipment', label: 'Equipment', icon: PAGE_META.equipment?.icon(19), onSelect: () => onCreate('equipment') },
          { id: 'plan', label: 'Plan', icon: PAGE_META.plans?.icon(19), onSelect: () => onCreate('plan') },
        ]}
      />

      <div className="page-content with-fab">
        {/* Above everything, including the empty state: a session in progress
            is the only thing on this page that is happening right now. */}
        {running && (
          <button className="card plan-resume" onClick={() => onResumeSession(running.id)}>
            <span className="plan-resume-dot" aria-hidden />
            <div className="plan-resume-text">
              <span className="field-label">Session in progress</span>
              <strong>{running.dayName}</strong>
              <span className="plan-resume-meta plan-num">
                {running.planName} · {clockLabel(elapsedSec(running.startedAt))}
              </span>
            </div>
            <span className="btn btn-primary plan-resume-cta"><Play size={14} /> Resume</span>
          </button>
        )}

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
              /* Laid out in index.css rather than here. It was a flex row of
                 inline styles with `flexWrap: 'wrap'` and no breakpoint, which
                 held together only while the text stayed short: naming the
                 sport in the subtitle was enough to push the figure onto a
                 second line, where it sat orphaned under the heading. The
                 wrapping is now the design rather than the failure mode. */
              <div className="pb-banner">
                <span className="pb-mark">
                  {/* The sport's own mark, in the sport's own colour. It says
                      what the subtitle used to spell out, and a trophy on the
                      one card that already says "personal best" was the least
                      informative glyph on the page. */}
                  <TypeIcon type={bests[0].workout.type} size={20} />
                </span>
                <div className="pb-head">
                  <div className="pb-title">
                    {bests.length === 1 ? 'New personal best' : `${bests.length} new personal bests`}
                  </div>
                  <div className="pb-sub">
                    {bests[0].workout.name} · {dayMonth(fromDateKey(bests[0].workout.date))}
                  </div>
                </div>
                <div className="pb-figures">
                  {bests.map(b => (
                    <span key={b.kind} className="pb-figure">
                      <span className="pb-figure-label">{b.label}</span>
                      <span className="pb-figure-value">{b.value}</span>
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
                    text="Every goal from Settings → Training goals, in the order you put them there. The marker on each bar is where you would be exactly on schedule, so past it means ahead. The bars below are recent windows — filled where you met the target, marked + where you beat it — and a streak counts consecutive windows met, which the one in progress can extend but never break. Card styles and labels live in the same settings page."
                  />
                </div>
                {progress.length === 0 ? (
                  <p className="chart-card-desc" style={{ marginBottom: 0 }}>
                    No goals set. Add one under Settings → Training Goals — two runs a week, or
                    40 km of hiking a month — and this tile will track your streak.
                  </p>
                ) : (
                  <GoalPanel progress={progress} opts={goalOpts} />
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
                  </div>
                  <p className="chart-card-desc" style={{ marginBottom: 10 }}>7-day load against your 28-day average.</p>

                  {/* The ratio is what this card is for, so it is the biggest
                      thing on it rather than a 12px chip in the corner beside
                      the title — where it sat, at the size of an axis label,
                      as far from its own explanation as the card allowed.
                      The word beside it carries the same verdict the colour
                      does, so the reading never depends on telling red from
                      accent. */}
                  <div className="load-figure">
                    <span className={`load-ratio ${form.verdict}`}>{form.ratio.toFixed(2)}</span>
                    <span className="load-figure-text">
                      <span className={`load-verdict ${form.verdict}`}>{form.headline}</span>
                      <span className="load-figure-unit">acute / chronic load</span>
                    </span>
                  </div>
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

              {/* Radial type breakdown: legend on the left, chart on the right (desktop) */}
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
                    <XAxis dataKey="day" padding={END_PADDING} tick={AXIS_TICK} axisLine={false} tickLine={false} label={{ value: 'Day of week', position: 'insideBottom', offset: -12, fontSize: 10, fill: 'var(--text-3)' }} />
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
                    {/* Oldest on the left, this week on the right, because
                        that is the direction time runs on every other chart in
                        the app — and the eye lands on the newest bar last,
                        which is where a trend is read.

                        The colour is picked by the week's recency and not by
                        its position, so reversing the order did not repaint
                        anything: this week stays the strongest step wherever
                        it sits. trendWeeks is newest-first, which is the
                        ramp's own order. */}
                    {[...d.trendWeeks].reverse().map((week, i) => (
                      <Bar
                        key={week}
                        dataKey={week}
                        fill={trendRamp[d.trendWeeks.length - 1 - i]}
                        radius={[3, 3, 0, 0]}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
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
