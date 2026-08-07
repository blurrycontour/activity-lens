import { describe, expect, it } from 'vitest'
import { HR_ZONE_COLORS, hrZoneColor } from '../hrZones'

/*
 * Zone 4 was `var(--danger)`, which every consumer resolved correctly except
 * the one that matters most visually: the shaded track. MapLibre is given these
 * as a `line-color` paint value and parses colours itself, with no DOM to
 * resolve a custom property against — so that zone drew black on the map while
 * looking right in every chart beside it.
 */
describe('HR_ZONE_COLORS', () => {
  it('are literal colours MapLibre can parse', () => {
    for (const c of HR_ZONE_COLORS) {
      expect(c, `${c} cannot be resolved outside the DOM`).not.toMatch(/var\(/)
      expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('gives every zone its own colour', () => {
    expect(new Set(HR_ZONE_COLORS).size).toBe(5)
  })
})

describe('hrZoneColor', () => {
  it('maps a heart rate to its zone', () => {
    // Boundaries are 60/70/80/90 % of max.
    expect(hrZoneColor(100, 200)).toBe(HR_ZONE_COLORS[0])   // 50%
    expect(hrZoneColor(130, 200)).toBe(HR_ZONE_COLORS[1])   // 65%
    expect(hrZoneColor(150, 200)).toBe(HR_ZONE_COLORS[2])   // 75%
    expect(hrZoneColor(170, 200)).toBe(HR_ZONE_COLORS[3])   // 85%
    expect(hrZoneColor(190, 200)).toBe(HR_ZONE_COLORS[4])   // 95%
  })

  // A user who has not set a max HR still gets a drawable track rather than an
  // undefined colour, which is the same black by another route.
  it('answers with a real colour when max HR is unknown', () => {
    expect(hrZoneColor(150, 0)).toBe(HR_ZONE_COLORS[0])
  })
})
