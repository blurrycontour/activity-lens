import { describe, expect, it } from 'vitest'
import { fmtClock, fmtRate } from '../../data/workouts'

describe('fmtRate', () => {
  it('reports pace where a pace was measured', () => {
    expect(fmtRate({ type: 'Run', avgPace: 330, avgSpeed: 10.9 })).toEqual({ value: '5:30', unit: '/km' })
  })

  it('keeps cycling speed-based when pace is also available', () => {
    expect(fmtRate({ type: 'Ride', avgPace: 127, avgSpeed: 28.4 })).toEqual({ value: '28.4', unit: 'km/h' })
  })

  /**
   * The bug this exists for: a strength session or a treadmill import with no
   * distance has neither, and falling through to avgSpeed.toFixed(1) rendered
   * "0.0 km/h" — a measurement that was never taken.
   */
  it('reports nothing when neither was measured', () => {
    expect(fmtRate({ type: 'Strength', avgPace: 0, avgSpeed: 0 })).toEqual({ value: '—', unit: '' })
  })
})

/*
 * The time axis on every workout chart. Minutes alone stopped reading as a
 * time on anything long, and the failure was quiet: "97m" is a legible number
 * that nobody converts.
 */
describe('fmtClock', () => {
  it('reads as a clock, unpadded hours', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(300)).toBe('0:05')
    expect(fmtClock(3600)).toBe('1:00')
    expect(fmtClock(5820)).toBe('1:37')
  })

  // Recharts hands a tick whatever the domain produces, which on an empty or
  // malformed series can be below zero.
  it('does not render a negative time', () => {
    expect(fmtClock(-90)).toBe('0:00')
  })
})
