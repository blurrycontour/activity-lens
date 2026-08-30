import { describe, expect, it } from 'vitest'
import { formatMeasuredNumber } from '../formatNumber'

describe('formatMeasuredNumber', () => {
  it('caps precision and removes trailing zeroes', () => {
    expect(formatMeasuredNumber(123.456789)).toBe('123.46')
    expect(formatMeasuredNumber(42)).toBe('42')
  })

  it('supports integer-only measurements', () => {
    expect(formatMeasuredNumber(314.9, 0)).toBe('315')
  })

  it('does not expose non-finite values', () => {
    expect(formatMeasuredNumber(Number.NaN)).toBe('—')
  })
})