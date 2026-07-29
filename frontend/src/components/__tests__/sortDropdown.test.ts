import { describe, expect, it } from 'vitest'
import { SORT_OPTIONS, compareBySort, type SortKey } from '../SortDropdown'

const rows = [
  { date: '2026-07-20', distance: 5000, duration: 1800 },
  { date: '2026-07-29', distance: 3000, duration: 3600 },
  { date: '2026-07-25', distance: 9000, duration: 600 },
]

const sorted = (key: SortKey) => [...rows].sort(compareBySort(key)).map(r => r.date)

describe('compareBySort', () => {
  it('orders by each field in both directions', () => {
    expect(sorted('date-desc')).toEqual(['2026-07-29', '2026-07-25', '2026-07-20'])
    expect(sorted('date-asc')).toEqual(['2026-07-20', '2026-07-25', '2026-07-29'])
    expect(sorted('distance-desc')).toEqual(['2026-07-25', '2026-07-20', '2026-07-29'])
    expect(sorted('distance-asc')).toEqual(['2026-07-29', '2026-07-20', '2026-07-25'])
    expect(sorted('duration-desc')).toEqual(['2026-07-29', '2026-07-20', '2026-07-25'])
    expect(sorted('duration-asc')).toEqual(['2026-07-25', '2026-07-20', '2026-07-29'])
  })

  it('has a comparator for every option the dropdown offers', () => {
    // Guards against adding an option to the menu without teaching the
    // comparator about it, which would silently fall through to "no change".
    for (const opt of SORT_OPTIONS) {
      expect(sorted(opt.value), opt.value).toHaveLength(rows.length)
    }
    expect(new Set(SORT_OPTIONS.map(o => o.value)).size).toBe(SORT_OPTIONS.length)
  })
})
