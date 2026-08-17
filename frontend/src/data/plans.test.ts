import { describe, expect, it } from 'vitest'
import {
  blockLabel, clockLabel, leadingDone, requiredPhrase, setTappable,
  type PlanBlock, type PlanExercise, type SetLog,
} from './plans'

function ex(name: string): PlanExercise {
  return { id: name, name, kind: 'weight', sets: 3, reps: '10', durationSec: 0, weightKg: 0, restSec: 0, note: '' }
}

function block(required: number, ...names: string[]): PlanBlock {
  return { id: 'b', required, restSec: 0, options: names.map(ex) }
}

function sets(...done: boolean[]): SetLog[] {
  return done.map(d => ({ done: d, weightKg: 0 }))
}

describe('requiredPhrase', () => {
  it('says nothing about a block holding one exercise', () => {
    expect(requiredPhrase(1, 1)).toBe('')
  })

  it('reads the same wherever a block is described', () => {
    expect(requiredPhrase(1, 3)).toBe('Choose 1 of 3')
    expect(requiredPhrase(2, 4)).toBe('Choose 2 of 4')
    expect(requiredPhrase(3, 3)).toBe('Superset · all 3')
  })

  // The editor's picker, the read view and the runner all print this. They
  // used to phrase it three different ways for the same block.
  it('agrees with blockLabel', () => {
    expect(blockLabel(block(2, 'Pull-ups', 'Rows', 'Chins'))).toBe(requiredPhrase(2, 3))
  })

  it('survives a required count the data should not hold', () => {
    expect(blockLabel(block(0, 'Bench', 'Push-ups'))).toBe('Choose 1 of 2')
    expect(blockLabel(block(9, 'Bench', 'Push-ups'))).toBe('Superset · all 2')
  })
})

describe('leadingDone and setTappable', () => {
  it('counts an unbroken run from the start', () => {
    expect(leadingDone(sets(true, true, false))).toBe(2)
    expect(leadingDone(sets(false, true, true))).toBe(0)
    expect(leadingDone([])).toBe(0)
  })

  // The whole point: ticking set 3 first recorded a session nobody performed,
  // and every timing derived from the stamps described nothing.
  it('offers only the next set and the last one done', () => {
    const s = sets(true, false, false)
    expect(setTappable(s, 0)).toBe(true)   // undo the last one done
    expect(setTappable(s, 1)).toBe(true)   // the next one
    expect(setTappable(s, 2)).toBe(false)  // skipping ahead
  })

  it('opens the first set of an untouched exercise', () => {
    expect(setTappable([], 0)).toBe(true)
    expect(setTappable([], 1)).toBe(false)
  })

  it('lets the last set of a finished exercise be undone', () => {
    const s = sets(true, true, true)
    expect(setTappable(s, 2)).toBe(true)
    expect(setTappable(s, 1)).toBe(false)
  })
})

describe('clockLabel', () => {
  it('reads as a clock, not as a rounded number of minutes', () => {
    expect(clockLabel(0)).toBe('0:00')
    expect(clockLabel(65)).toBe('1:05')
    expect(clockLabel(2440)).toBe('40:40')
    expect(clockLabel(3600)).toBe('1:00:00')
    expect(clockLabel(3925)).toBe('1:05:25')
  })

  it('does not go backwards on a clock that is slightly out', () => {
    expect(clockLabel(-5)).toBe('0:00')
  })
})
