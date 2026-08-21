import { describe, expect, it } from 'vitest'
import { ringRemaining } from '../PingRow'

/*
 * The ring around a sent ping is drawn with a one-second CSS transition, so
 * what it is told is where it should be a second from now, not where it is.
 * Told the current value instead, it trailed the clock by a tick and vanished
 * with a slice still drawn — which at a 15-second cooldown is most of a tenth
 * of the circle.
 */
describe('ringRemaining', () => {
  it('is nearly full at the moment a ping is sent', () => {
    expect(ringRemaining(60, 60)).toBeCloseTo(59 / 60)
  })

  it('reaches empty a second before the wait does', () => {
    // The last second is the one the transition spends animating to zero, so
    // the ring lands on empty exactly as the cooldown ends.
    expect(ringRemaining(1, 60)).toBe(0)
    expect(ringRemaining(0, 60)).toBe(0)
  })

  it('tracks the clock in between', () => {
    expect(ringRemaining(31, 60)).toBeCloseTo(0.5)
    expect(ringRemaining(8, 15)).toBeCloseTo(7 / 15)
  })

  // A server that sends nonsense, or one too old to send a cooldown at all,
  // must not produce a NaN offset — SVG draws nothing at all for one.
  it('answers zero rather than nonsense', () => {
    expect(ringRemaining(30, 0)).toBe(0)
    expect(ringRemaining(-5, 60)).toBe(0)
    expect(ringRemaining(600, 60)).toBe(1)
  })
})
