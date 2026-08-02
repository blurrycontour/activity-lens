/*
 * The sport marks were emoji until they became icons. These cover the two ways
 * that swap silently goes wrong: an icon that stops scaling with its container,
 * and a glyph that gets interpolated into a string — which is what `Dropdown`
 * used to do, and which renders "[object Object]" rather than failing.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import TypeIcon from '../TypeIcon'
import Dropdown from '../Dropdown'
import { WORKOUT_TYPES } from '../../data/workouts'

test('every sport renders a distinct sized svg', () => {
  const seen = new Set<string>()
  for (const t of WORKOUT_TYPES) {
    const html = renderToStaticMarkup(<TypeIcon type={t} />)
    expect(html).toContain('<svg')
    expect(html).toContain('width="1em"')
    expect(html).toContain('currentColor')
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
    seen.add(html)
  }
  expect(seen.size).toBe(WORKOUT_TYPES.length)   // no two sports share a mark
})

test('explicit size overrides the inherited one', () => {
  expect(renderToStaticMarkup(<TypeIcon type="Run" size={12} />)).toContain('width="12"')
})

test('dropdown renders a node glyph instead of interpolating it', () => {
  const html = renderToStaticMarkup(
    <Dropdown value="Run" onChange={() => {}}
      options={[{ value: 'Run', label: 'Run', glyph: <TypeIcon type="Run" size={14} /> }]} />,
  )
  expect(html).toContain('<svg')
  expect(html).not.toContain('[object Object]')
  expect(html).toContain('Run')
})
