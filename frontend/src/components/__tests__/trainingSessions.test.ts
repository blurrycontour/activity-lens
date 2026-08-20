import { describe, expect, it } from 'vitest'
import { weekRows } from '../TrainingSessionsChart'
import type { PlanSession } from '../../data/plans'

/** A finished session `weeksAgo` weeks back, with `sets` ticked. */
function session(weeksAgo: number, sets: number): PlanSession {
  const at = new Date()
  at.setDate(at.getDate() - weeksAgo * 7)
  return {
    id: `s${weeksAgo}-${sets}`,
    startedAt: at.toISOString(),
    finishedAt: at.toISOString(),
    doneSets: sets,
  } as PlanSession
}

describe('weekRows', () => {
  it('draws the weeks with nothing in them', () => {
    // Four weeks apart, so the three weeks between them must still appear —
    // the gap is the thing a consistency chart is read for.
    const { data } = weekRows([session(4, 10), session(0, 20)], 0)
    expect(data).toHaveLength(5)
    expect(data.map(r => r.sessions)).toEqual([1, 0, 0, 0, 1])
  })

  it('splits a week into one segment per session', () => {
    const { data, maxSessions } = weekRows([session(0, 12), session(0, 8)], 0)
    expect(maxSessions).toBe(2)
    const week = data[data.length - 1]
    expect(week.segments).toEqual([12, 8])
    expect(week.sets).toBe(20)
    expect(week.sessions).toBe(2)
  })

  it('ignores sessions still running, and ones before the range', () => {
    const running = { ...session(0, 30), finishedAt: undefined } as PlanSession
    const { data, maxSessions } = weekRows([running, session(20, 10)], 14)
    expect(maxSessions).toBe(0)
    // Two weeks of range, and neither session counted towards them.
    expect(data.every(r => r.sessions === 0)).toBe(true)
  })

  it('has nothing to draw without a finished session', () => {
    expect(weekRows([], 30)).toEqual({ data: [], maxSessions: 0 })
  })
})
