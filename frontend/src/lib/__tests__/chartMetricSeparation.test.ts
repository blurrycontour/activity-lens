import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * The workout-detail metric lines, checked rather than eyeballed.
 *
 * HR, pace, speed, elevation and cadence are drawn together on one page, so the
 * five must be told apart at a glance. They used to borrow sport and status
 * tokens — pace took the workout's own sport colour, identical to --hike used
 * for elevation on a Hike, and HR's red sat beside cadence's pink --strength.
 * This is the floor that keeps the dedicated set apart, in both themes.
 */

const CSS = readFileSync(join(import.meta.dirname, '../../index.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} not found`).toBeGreaterThan(-1)
  const body = CSS.slice(start, CSS.indexOf('\n}', start))
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]),
  )
}

function lin(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function lab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)))
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

function relLum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [lo, hi] = [relLum(a), relLum(b)].sort((x, y) => x - y)
  return (hi + 0.05) / (lo + 0.05)
}

const METRICS = ['metric-hr', 'metric-pace', 'metric-speed', 'metric-elev', 'metric-cadence']
const MIN_SEPARATION = 20

describe.each([
  ['dark', ':root', '#111318'],
  ['light', ':root.light', '#ffffff'],
])('%s theme metric lines', (_name, selector, card) => {
  const tokens = selector === ':root' ? block(':root') : { ...block(':root'), ...block(':root.light') }

  it('keeps every metric line apart from the others', () => {
    for (let i = 0; i < METRICS.length; i++) {
      for (let j = i + 1; j < METRICS.length; j++) {
        const a = tokens[METRICS[i]], b = tokens[METRICS[j]]
        expect(a, `--${METRICS[i]} missing`).toBeTruthy()
        expect(b, `--${METRICS[j]} missing`).toBeTruthy()
        const d = deltaE(a, b)
        expect(d, `--${METRICS[i]} (${a}) vs --${METRICS[j]} (${b})`).toBeGreaterThan(MIN_SEPARATION)
      }
    }
  })

  it('keeps every metric line readable on a card', () => {
    for (const name of METRICS) {
      expect(contrast(tokens[name], card), `--${name} on ${card}`).toBeGreaterThan(3)
    }
  })
})
