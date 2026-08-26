import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCENTS } from '../theme'

/*
 * The palette, checked rather than eyeballed.
 *
 * Every sport colour used to be the exact hex of one of the six accents — --run
 * was Electric Green, --swim was Cyan, --strength was Violet, --session was
 * Rose. ui-design.md says sport colours always mean the sport and the accent
 * never means anything, and the palette made those two rules contradict each
 * other: picking Cyan drew every swim in the interface's own highlight colour.
 *
 * This is the floor that keeps it fixed. It reads the real stylesheet, so a
 * token edited back to a colliding value fails here rather than in someone's
 * eyes six months from now.
 */

const CSS = readFileSync(join(import.meta.dirname, '../../index.css'), 'utf8')

/** The declarations inside one top-level rule, as a token → hex map. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} not found`).toBeGreaterThan(-1)
  const body = CSS.slice(start, CSS.indexOf('\n}', start))
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]),
  )
}

function lab(hex: string): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)))
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE76 colour difference. Perceptually, 2.3 is "just noticeable". */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

function contrast(a: string, b: string): number {
  const rel = (hex: string) => lab(hex) && (() => {
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const [r, g, bl] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  })()
  const [lo, hi] = [rel(a), rel(b)].sort((x, y) => x - y)
  return (hi + 0.05) / (lo + 0.05)
}

/** Colours that must all be told apart within one theme. */
const MEANINGFUL = ['run', 'ride', 'hike', 'swim', 'strength', 'other', 'plan', 'session', 'danger', 'success', 'warning']

/** Well past "just noticeable", and short of what the palette actually achieves. */
const MIN_SEPARATION = 20

describe.each([
  ['dark', ':root', '#0a0b0e', 4.5],
  ['light', ':root.light', '#ffffff', 3],
])('%s theme', (_name, selector, bg, minContrast) => {
  // The light block only overrides what changes, so it inherits the rest.
  const tokens = selector === ':root' ? block(':root') : { ...block(':root'), ...block(':root.light') }

  /*
   * One pair is allowed to coincide, and only this one.
   *
   * --success is green because success is green, and one of the six accents is
   * green for the same reason. Someone on Electric Green seeing their
   * completed goals in very nearly their accent colour has lost nothing: both
   * readings of the colour are "good". The alternative is a success colour that
   * is not green, which would be worse.
   *
   * --danger got no such pass. It sat 14.7 ΔE from the Rose accent, which meant
   * a delete button and the interface's ordinary highlight were the same red —
   * and that is precisely the confusion the status palette exists to prevent.
   * Rose moved.
   */
  const ALLOWED_COINCIDENCE = new Set(['success:Electric Green'])

  it('keeps every meaningful colour apart from every accent', () => {
    for (const name of MEANINGFUL) {
      const value = tokens[name]
      expect(value, `--${name} missing`).toBeTruthy()
      for (const accent of ACCENTS) {
        if (ALLOWED_COINCIDENCE.has(`${name}:${accent.name}`)) continue
        const d = deltaE(value, accent.value)
        expect(d, `--${name} (${value}) vs ${accent.name} (${accent.value})`).toBeGreaterThan(MIN_SEPARATION)
      }
    }
  })

  it('keeps every meaningful colour apart from the others', () => {
    for (let i = 0; i < MEANINGFUL.length; i++) {
      for (let j = i + 1; j < MEANINGFUL.length; j++) {
        const [a, b] = [MEANINGFUL[i], MEANINGFUL[j]]
        expect(deltaE(tokens[a], tokens[b]), `--${a} vs --${b}`).toBeGreaterThan(MIN_SEPARATION)
      }
    }
  })

  // A sport is drawn as an icon, a chart line and a row rail. All of those are
  // "large text" by WCAG's reckoning, so 3:1 is the bar — and the old palette
  // missed it on white by a wide margin.
  it('stays legible against its own background', () => {
    for (const name of MEANINGFUL) {
      expect(contrast(tokens[name], bg), `--${name} on ${bg}`).toBeGreaterThan(minContrast)
    }
  })
})
