import { describe, expect, it } from 'vitest'
import { downsample } from './downsample'

const series = (values: number[]) => values.map((v, t) => ({ t, v }))
const val = (d: { v: number }) => d.v

describe('downsample', () => {
  it('leaves a series shorter than the target alone', () => {
    const data = series([1, 2, 3])
    expect(downsample(data, val, 400)).toBe(data)
  })

  it('reduces to about the target and keeps both endpoints', () => {
    const data = series(Array.from({ length: 3600 }, (_, i) => Math.sin(i / 40) * 50 + 120))
    const out = downsample(data, val, 400)
    // "About" the target: a bucket that comes out empty is skipped rather than
    // padded, so this is a ceiling.
    expect(out.length).toBeLessThanOrEqual(400)
    expect(out.length).toBeGreaterThan(350)
    expect(out[0]).toBe(data[0])
    expect(out[out.length - 1]).toBe(data[data.length - 1])
  })

  it('keeps time strictly increasing', () => {
    const data = series(Array.from({ length: 2000 }, (_, i) => i % 7))
    const out = downsample(data, val, 300)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].t).toBeGreaterThan(out[i - 1].t)
    }
  })

  // The whole reason for LTTB over "every Nth point": a single spike is the
  // interesting part of a heart-rate or elevation trace, and it sits between
  // strides more often than not.
  it('preserves an isolated peak that stride sampling would drop', () => {
    const values = new Array(2000).fill(100)
    values[997] = 190
    const data = series(values)

    const out = downsample(data, val, 200)
    expect(out.some(d => d.v === 190)).toBe(true)

    // Show the naive alternative really would have lost it.
    const stride = data.filter((_, i) => i % 10 === 0)
    expect(stride.some(d => d.v === 190)).toBe(false)
  })

  it('handles a flat series without collapsing it', () => {
    const data = series(new Array(1000).fill(42))
    const out = downsample(data, val, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out.every(d => d.v === 42)).toBe(true)
  })
})
