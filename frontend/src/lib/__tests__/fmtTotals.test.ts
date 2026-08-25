import { describe, it, expect } from 'vitest'
import { fmtTotal, fmtCompact } from '../../data/workouts'

// Both of these existed to fix a dashboard that divided by 1000 unconditionally,
// so the cases worth pinning are the small ones — the ones a new account sees.
describe('fmtTotal', () => {
  it('keeps metres below a kilometre', () => {
    expect(fmtTotal(80)).toEqual({ value: '80', unit: 'm' })
    expect(fmtTotal(999)).toEqual({ value: '999', unit: 'm' })
  })

  it('switches to kilometres at one', () => {
    expect(fmtTotal(1000)).toEqual({ value: '1.0', unit: 'km' })
    expect(fmtTotal(2600)).toEqual({ value: '2.6', unit: 'km' })
  })

  // A decimal on a four-figure distance is noise, not precision.
  it('drops the decimal past ten kilometres', () => {
    expect(fmtTotal(41000)).toEqual({ value: '41', unit: 'km' })
  })

  it('does not round a real value away to zero', () => {
    expect(fmtTotal(500).value).not.toBe('0')
  })
})

describe('fmtCompact', () => {
  it('writes the number out below ten thousand', () => {
    expect(fmtCompact(400)).toBe('400')
    expect(fmtCompact(5700)).toBe('5,700')
  })

  it('abbreviates once the digits stop mattering', () => {
    expect(fmtCompact(12400)).toBe('12.4k')
    expect(fmtCompact(250000)).toBe('250k')
    expect(fmtCompact(2500000)).toBe('2.5M')
  })
})
