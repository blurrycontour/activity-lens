import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartCard, { EmptyPlot } from './ChartCard'
import { denseXAxis, useChartSpace } from './ChartAxis'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL } from '../lib/chartColors'
import { api } from '../lib/api'
import { type PlanSession } from '../data/plans'

/**
 * Training sessions per week, and the sets done in them.
 *
 * Sits on the Consistency page beside the activity calendar because it answers
 * the same question for the half of training that leaves no GPS trace. Gym work
 * is invisible in every other chart in this app unless the user has switched on
 * "record sessions as workouts" — and even then it appears as an hour of
 * strength with no sense of whether it was a heavy week.
 *
 * Weeks rather than days: strength training is programmed by the week, and a
 * daily bar chart of three sessions is mostly gaps.
 */
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

  const data = useMemo(() => {
    if (!sessions) return []
    const cutoff = rangeDays > 0 ? Date.now() - rangeDays * 86400000 : 0
    const byWeek = new Map<string, { label: string; sessions: number; sets: number }>()

    for (const s of sessions) {
      if (!s.finishedAt) continue
      const at = new Date(s.startedAt)
      if (Number.isNaN(at.getTime()) || at.getTime() < cutoff) continue
      // Week starting Monday, which is how training weeks are written.
      const monday = new Date(at)
      monday.setHours(0, 0, 0, 0)
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
      const key = monday.toISOString().slice(0, 10)
      const row = byWeek.get(key) ?? {
        label: monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        sessions: 0, sets: 0,
      }
      row.sessions += 1
      row.sets += s.doneSets
      byWeek.set(key, row)
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
  }, [sessions, rangeDays])

  return (
    <ChartCard
      title="Training Sessions"
      description="Sessions run from your plans each week, and the sets done in them."
      info="Counts finished sessions by the week they started, Monday to Sunday. The bar height is sets ticked, which counts a bodyweight or held exercise the same as a loaded one — a week of pull-ups and planks is a week of training."
      style={{ marginTop: 16 }}
    >
      {data.length === 0 ? (
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
                const d = payload[0].payload as typeof data[number]
                return (
                  <div className="custom-tooltip">
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Week of {label}</div>
                    <div>{d.sessions} session{d.sessions === 1 ? '' : 's'} · {d.sets} sets</div>
                  </div>
                )
              }}
            />
            <Bar dataKey="sets" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill="var(--strength)" opacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
