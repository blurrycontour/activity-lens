import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartCard, { EmptyPlot } from './ChartCard'
import { denseXAxis, useChartSpace } from './ChartAxis'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL } from '../lib/chartColors'
import { api } from '../lib/api'
import { type PlanSession } from '../data/plans'

/**
 * Training sessions per week: how much was done, and how often.
 *
 * Sits on the Consistency page beside the activity calendar because it answers
 * the same question for the half of training that leaves no GPS trace. Gym work
 * is invisible in every other chart in this app unless the user has switched on
 * "record sessions as workouts" — and even then it appears as an hour of
 * strength with no sense of whether it was a heavy week.
 *
 * Weeks rather than days: strength training is programmed by the week, and a
 * daily bar chart of three sessions is mostly gaps.
 *
 * Two things it is careful about, both of which it used to get wrong:
 *
 *   Every week in the range is drawn, including the ones with nothing in them.
 *   The chart was built from a map keyed by weeks that had a session, so a
 *   fortnight off collapsed into two adjacent bars and the axis read as a
 *   timeline it was not. On a page about consistency the gaps are the point.
 *
 *   The bar is divided into one segment per session, so its height is the
 *   week's sets and the bands in it are how many times you trained. Three
 *   twenties and one sixty are the same bar otherwise, and they are not the
 *   same week. Deliberately not a second y-axis for the session count: two
 *   scales on one plot invite readings of where the line crosses the bars,
 *   which means nothing.
 */
interface WeekRow {
  label: string
  sessions: number
  sets: number
  /** Sets done in each session that week, in the order they were run. */
  segments: number[]
}

/** The Monday of a date's week — how training weeks are written. */
function mondayOf(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

const key = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The weeks to draw, and the most sessions any one of them holds.
 *
 * Exported for its own test: the zero-filling is the part that was wrong
 * before, and "a week with nothing in it is still a week" is exactly the kind
 * of thing that quietly regresses.
 */
export function weekRows(sessions: PlanSession[], rangeDays: number): { data: WeekRow[]; maxSessions: number } {
  const finished = sessions.filter(s => s.finishedAt && !Number.isNaN(new Date(s.startedAt).getTime()))
  const cutoff = rangeDays > 0 ? mondayOf(new Date(Date.now() - rangeDays * 86400000)) : null
  // With no range set the chart starts at the first session there is, rather
  // than at the epoch.
  const firstSession = finished.reduce<number | null>((min, s) => {
    const t = mondayOf(new Date(s.startedAt)).getTime()
    return min === null || t < min ? t : min
  }, null)
  if (firstSession === null) return { data: [], maxSessions: 0 }

  const start = cutoff && cutoff.getTime() > firstSession ? cutoff : new Date(firstSession)
  const end = mondayOf(new Date())

  // Every week from the first to this one, the empty ones included.
  const rows = new Map<string, WeekRow>()
  for (const week = new Date(start); week <= end; week.setDate(week.getDate() + 7)) {
    rows.set(key(week), {
      label: week.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      sessions: 0, sets: 0, segments: [],
    })
  }

  for (const s of finished) {
    const row = rows.get(key(mondayOf(new Date(s.startedAt))))
    if (!row) continue // before the range
    row.sessions += 1
    row.sets += s.doneSets
    row.segments.push(s.doneSets)
  }

  const data = [...rows.values()]
  return { data, maxSessions: data.reduce((m, r) => Math.max(m, r.segments.length), 0) }
}

export default function TrainingSessionsChart({ rangeDays }: { rangeDays: number }) {
  const [sessions, setSessions] = useState<PlanSession[] | null>(null)
  const space = useChartSpace()

  useEffect(() => {
    let active = true
    api.listPlanSessions(200)
      .then(list => { if (active) setSessions(list) })
      // A server without training plans answers 404 here; an empty chart is
      // the right outcome, not an error on an unrelated page.
      .catch(() => { if (active) setSessions([]) })
    return () => { active = false }
  }, [])

  const { data, maxSessions } = useMemo(() => weekRows(sessions ?? [], rangeDays), [sessions, rangeDays])

  return (
    <ChartCard
      title="Training Sessions"
      description="Sets done each week, split into the sessions they came from."
      info="Counts finished sessions by the week they started, Monday to Sunday. The bar height is sets ticked and each band in it is one session, so three bands of twenty and one of sixty tell themselves apart. A set counts the same whether it was loaded or bodyweight — a week of pull-ups and planks is a week of training. Weeks with nothing in them are drawn empty rather than skipped, which is the whole point of reading this on a consistency page."
      style={{ marginTop: 16 }}
    >
      {maxSessions === 0 ? (
        <EmptyPlot height={200}>No finished sessions in this range</EmptyPlot>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={space.margin(18, 4)}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...denseXAxis(11)} />
            <YAxis
              tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto"
              label={{
                value: 'Sets',
                angle: -90, position: 'insideLeft',
                style: { ...AXIS_TICK, textAnchor: 'middle' },
              }}
            />
            <Tooltip
              cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as WeekRow
                return (
                  <div className="custom-tooltip">
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Week of {label}</div>
                    {d.sessions === 0
                      ? <div>No sessions</div>
                      : <div>{d.sessions} session{d.sessions === 1 ? '' : 's'} · {d.sets} sets</div>}
                  </div>
                )
              }}
            />
            {/* One band per session in the week, stacked. The accent, not the
                strength colour it used to wear: a session is training in
                general — a plan of pull-ups and planks is not a Strength
                workout — and every other chart on this page follows the colour
                the user chose. All the same colour, because
                they are not different things, they are the same thing counted
                — the separation is the 2px of surface between them, which is
                what makes them countable without a legend nobody could read.
                The top band is the only one with rounded corners, so a week's
                bar still reads as one bar. */}
            {Array.from({ length: maxSessions }, (_, i) => (
              <Bar
                key={i}
                dataKey={(row: WeekRow) => row.segments[i] ?? 0}
                stackId="sets"
                maxBarSize={44}
                isAnimationActive={false}
                fill="var(--primary)"
                fillOpacity={0.85}
                stroke="var(--bg-2)"
                strokeWidth={2}
              >
                {/* The top band of each week gets the rounded end; the ones
                    under it are interior and stay square. */}
                {data.map((row, j) => (
                  <Cell key={j} radius={i === row.segments.length - 1 ? 4 : 0} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
