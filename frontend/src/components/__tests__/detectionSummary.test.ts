import { describe, expect, it } from 'vitest'
import { detectionSummary } from '../ImportModal'

/*
 * The sentence under the import window's sport picker. It is the only place
 * that says what the files claim to be, so a wrong or missing one leaves
 * someone choosing an override without knowing what they are overriding.
 */
describe('detectionSummary', () => {
  it('says nothing before there is anything to describe', () => {
    expect(detectionSummary([], '')).toBeNull()
  })

  it('names what a single file said', () => {
    expect(detectionSummary(['Hike'], '')).toBe('Detected Hike from the file.')
  })

  // A fifty-file archive is a distribution, not a sentence.
  it('counts a batch, commonest first', () => {
    expect(detectionSummary(['Run', 'Hike', 'Hike', 'Hike', 'Run', 'Ride'], ''))
      .toBe('Detected 3 Hike · 2 Run · 1 Ride from the files.')
  })

  // Other is the absence of a detection, and saying so is what tells someone
  // the picker is worth using here.
  it('treats Other as "the file does not say"', () => {
    expect(detectionSummary(['Other'], '')).toMatch(/does not say/)
    expect(detectionSummary(['Other', 'Other'], '')).toMatch(/None of these files say/)
    // ...but not when it is only part of the picture.
    expect(detectionSummary(['Other', 'Run'], '')).toBe('Detected 1 Other · 1 Run from the files.')
  })

  // The override has to be stated alongside the detection, not instead of it:
  // "importing as Ride" with no mention of what the file said would leave the
  // user unable to tell whether the override was needed.
  it('states both when a sport is chosen', () => {
    expect(detectionSummary(['Hike'], 'Ride')).toBe('The file says Hike — importing as Ride.')
    expect(detectionSummary(['Hike', 'Run'], 'Ride')).toBe('Files say 1 Hike · 1 Run — importing as Ride.')
  })

  it('describes an override even before any file is read', () => {
    expect(detectionSummary([], 'Ride')).toMatch(/saved as Ride/)
  })
})
