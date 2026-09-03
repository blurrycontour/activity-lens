import { describe, it, expect } from 'vitest'
import { estimateAvgCyclingPower } from '../power'

describe('estimateAvgCyclingPower', () => {
  it('needs distance and time', () => {
    expect(estimateAvgCyclingPower(0, 3600, 0, 75)).toBeNull()
    expect(estimateAvgCyclingPower(30000, 0, 0, 75)).toBeNull()
  })

  it('gives a plausible flat-ride figure', () => {
    // 30 km in 1 h (8.33 m/s), no climbing, 75 kg rider — a steady endurance
    // pace lands in the ~120-180 W range for a road bike.
    const w = estimateAvgCyclingPower(30000, 3600, 0, 75)!
    expect(w).toBeGreaterThan(110)
    expect(w).toBeLessThan(200)
  })

  it('adds power for climbing', () => {
    const flat = estimateAvgCyclingPower(30000, 3600, 0, 75)!
    const hilly = estimateAvgCyclingPower(30000, 3600, 600, 75)!
    expect(hilly).toBeGreaterThan(flat)
  })

  it('grows with speed', () => {
    const slow = estimateAvgCyclingPower(20000, 3600, 0, 75)!
    const fast = estimateAvgCyclingPower(40000, 3600, 0, 75)!
    expect(fast).toBeGreaterThan(slow)
  })
})
