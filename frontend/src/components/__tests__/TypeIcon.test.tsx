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
import { ALL_WORKOUT_TYPES, TYPE_COLOR } from '../../data/workouts'

test('every sport renders a distinct svg in its own colour', () => {
  const seen = new Set<string>()
  for (const t of ALL_WORKOUT_TYPES) {
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
  expect(seen.size).toBe(ALL_WORKOUT_TYPES.length)   // no two sports share a mark
})

test('the sport picker offers every sport and no filter-only value', () => {
  const html = renderToStaticMarkup(<SportDropdown value="Run" onChange={() => {}} />)
  // A workout is one of the five; "All" belongs to the filter, not here.
  expect(html).not.toContain('All')
  // Nor is "Other" on offer: it is what an unclassifiable import gets, and a
  // bucket people can pick fills up with things that had a real answer.
  expect(html).not.toContain('Other')
})

// ...but a workout can already be one, and a picker must never quietly change
// the value it was given. Without Other in the list the dropdown falls back to
// its first option, so opening the edit form on an unclassified import would
// show "Run" and saving would make that true.
test('the sport picker keeps a value it cannot otherwise offer', () => {
  const html = renderToStaticMarkup(<SportDropdown value="Other" onChange={() => {}} />)
  expect(html).toContain('Other')
  // Closed, only the trigger renders — so the label shown is the whole story.
  expect(html).not.toContain('Run')
})

test('explicit size overrides the inherited one', () => {
  expect(renderToStaticMarkup(<TypeIcon type="Run" size={12} />)).toContain('width="12"')
})
