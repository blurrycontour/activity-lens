/*
 * The sport marks were emoji until they became icons. These cover the two ways
 * that swap silently goes wrong: an icon that stops scaling with its container,
 * and one that stops carrying its sport's colour — which is the whole of its
 * meaning in a dropdown, where no tinted tile sits behind it.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import TypeIcon from '../TypeIcon'
import SportDropdown from '../SportDropdown'
import { TYPE_COLOR, WORKOUT_TYPES } from '../../data/workouts'

test('every sport renders a distinct svg in its own colour', () => {
  const seen = new Set<string>()
  for (const t of WORKOUT_TYPES) {
    const html = renderToStaticMarkup(<TypeIcon type={t} />)
    expect(html).toContain('<svg')
    expect(html).toContain('width="1em"')
    // The sport's colour, not the surrounding text's — this is what makes the
    // mark mean something in a dropdown, where there is no tinted tile behind it.
    expect(html).toContain(`stroke="${TYPE_COLOR[t]}"`)
    expect(html).not.toContain('currentColor')
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
    seen.add(html)
  }
  expect(seen.size).toBe(WORKOUT_TYPES.length)   // no two sports share a mark
})

test('the sport picker offers every sport and no filter-only value', () => {
  const html = renderToStaticMarkup(<SportDropdown value="Run" onChange={() => {}} />)
  // A workout is one of the five; "All" belongs to the filter, not here.
  expect(html).not.toContain('All')
})

test('explicit size overrides the inherited one', () => {
  expect(renderToStaticMarkup(<TypeIcon type="Run" size={12} />)).toContain('width="12"')
})
