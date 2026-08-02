/*
 * Dropdown's two non-obvious modes.
 *
 * `glyph` used to be a string interpolated into a template, which renders an
 * element as "[object Object]" rather than failing. `placeholder` turns the
 * menu into something that acts rather than holds a value, which the trigger
 * has to reflect — an empty value would otherwise select the first option.
 *
 * These render the closed control, so they cover the trigger only; the menu
 * needs a click, and there is no DOM environment configured here. Assertions
 * about menu contents would pass whatever the component did, so there are none.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import Dropdown from '../Dropdown'
import TypeIcon from '../TypeIcon'

const GEAR = [
  { value: 'a', label: 'Nike Pegasus 40' },
  { value: 'b', label: 'Garmin Forerunner' },
]

test('renders a node glyph instead of interpolating it', () => {
  const html = renderToStaticMarkup(
    <Dropdown value="Run" onChange={() => {}}
      options={[{ value: 'Run', label: 'Run', glyph: <TypeIcon type="Run" size={14} /> }]} />,
  )
  expect(html).toContain('<svg')
  expect(html).not.toContain('[object Object]')
  expect(html).toContain('Run')
})

test('an option carrying a glyph gets no colour dot as well', () => {
  const withGlyph = renderToStaticMarkup(
    <Dropdown value="Run" onChange={() => {}}
      options={[{ value: 'Run', label: 'Run', color: 'var(--run)', glyph: <TypeIcon type="Run" size={14} /> }]} />,
  )
  const withoutGlyph = renderToStaticMarkup(
    <Dropdown value="Run" onChange={() => {}}
      options={[{ value: 'Run', label: 'Run', color: 'var(--run)' }]} />,
  )
  // The trigger's dot: present when the colour is the only mark, gone once an
  // icon carries it.
  expect(withGlyph).not.toContain('border-radius:50%')
  expect(withoutGlyph).toContain('border-radius:50%')
})

test('placeholder mode shows itself rather than any option', () => {
  const html = renderToStaticMarkup(
    <Dropdown value="" placeholder="Add equipment…" onChange={() => {}} options={GEAR} />,
  )
  expect(html).toContain('Add equipment…')
  // Must not fall back to the first option, which is what an empty value
  // otherwise resolves to.
  expect(html).not.toContain('Nike Pegasus 40')
})

test('dropUp is opt-in', () => {
  const up = renderToStaticMarkup(<Dropdown value="a" dropUp onChange={() => {}} options={GEAR} />)
  const down = renderToStaticMarkup(<Dropdown value="a" onChange={() => {}} options={GEAR} />)
  expect(up).toContain('drop-up')
  expect(down).not.toContain('drop-up')
})
