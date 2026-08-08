import { describe, expect, it } from 'vitest'
import { fmtRate } from '../../data/workouts'

describe('fmtRate', () => {
  it('reports pace where a pace was measured', () => {
    expect(fmtRate({ avgPace: 330, avgSpeed: 10.9 })).toEqual({ value: '5:30', unit: '/km' })
  })

  it('falls back to speed when there is no pace', () => {
    expect(fmtRate({ avgPace: 0, avgSpeed: 28.4 })).toEqual({ value: '28.4', unit: 'km/h' })
  })

  /**
   * The bug this exists for: a strength session or a treadmill import with no
   * distance has neither, and falling through to avgSpeed.toFixed(1) rendered
   * "0.0 km/h" — a measurement that was never taken.
   */
  it('reports nothing when neither was measured', () => {
    expect(fmtRate({ avgPace: 0, avgSpeed: 0 })).toEqual({ value: '—', unit: '' })
  })
})
