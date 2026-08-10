import { describe, expect, it } from 'vitest'
import {
  everyDayBetween, everyMonthBetween, everyWeekBetween, fillGaps, keySpan,
} from '../timeGaps'

describe('everyDayBetween', () => {
  it('is inclusive at both ends', () => {
    expect(everyDayBetween('2026-07-30', '2026-08-02'))
      .toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'])
  })

  it('handles a single day', () => {
    expect(everyDayBetween('2026-07-30', '2026-07-30')).toEqual(['2026-07-30'])
  })

  it('does not hang on a reversed pair', () => {
    // A bad span must fail small rather than spin forever building an array.
    expect(everyDayBetween('2026-08-02', '2026-07-30')).toEqual(['2026-08-02'])
  })

  it('crosses a DST boundary without dropping or repeating a day', () => {
    // Stepping a local Date by one day lands on the same wall-clock midnight
    // either side of a clock change; a naive +86400000 would drift an hour and
    // eventually double up a date key.
    const days = everyDayBetween('2026-03-27', '2026-04-01')
    expect(days).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01'])
    expect(new Set(days).size).toBe(days.length)
  })
})

describe('everyWeekBetween', () => {
  it('steps Mondays', () => {
    expect(everyWeekBetween('2026-07-06', '2026-07-27'))
      .toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'])
  })
})

describe('everyMonthBetween', () => {
  it('rolls over the year', () => {
    expect(everyMonthBetween('2025-11', '2026-02'))
      .toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('handles a single month', () => {
    expect(everyMonthBetween('2026-02', '2026-02')).toEqual(['2026-02'])
  })
})

describe('fillGaps', () => {
  type Row = { key: string; value: number | null }
  const blank = (key: string): Row => ({ key, value: null })

  it('inserts a placeholder only where a key is missing', () => {
    const rows: Row[] = [{ key: 'a', value: 1 }, { key: 'c', value: 3 }]
    expect(fillGaps(rows, ['a', 'b', 'c'], r => r.key, blank)).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: null },
      { key: 'c', value: 3 },
    ])
  })

  it('keeps every row when a key holds more than one', () => {
    // Two activities on the same day are two points, not one — filling gaps
    // must not quietly deduplicate the data it is padding.
    const rows: Row[] = [{ key: 'a', value: 1 }, { key: 'a', value: 2 }, { key: 'c', value: 3 }]
    const out = fillGaps(rows, ['a', 'b', 'c'], r => r.key, blank)
    expect(out).toHaveLength(4)
    expect(out.filter(r => r.key === 'a')).toEqual([{ key: 'a', value: 1 }, { key: 'a', value: 2 }])
  })

  it('leaves an empty series alone', () => {
    expect(fillGaps([] as Row[], ['a', 'b'], r => r.key, blank)).toEqual([])
  })
})

describe('keySpan', () => {
  it('finds the lowest and highest key regardless of order', () => {
    const rows = [{ d: '2026-07-15' }, { d: '2026-07-01' }, { d: '2026-07-31' }]
    expect(keySpan(rows, r => r.d)).toEqual(['2026-07-01', '2026-07-31'])
  })

  it('is null for no rows', () => {
    expect(keySpan([], (r: { d: string }) => r.d)).toBeNull()
  })
})
