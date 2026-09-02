import { describe, expect, it } from 'vitest'
import {
  blockLabel, clockLabel, currentBlockId, leadingDone, requiredPhrase, setState, setTappable,
  type PlanBlock, type PlanExercise, type PlanSession, type SetLog,
} from './plans'

function ex(name: string): PlanExercise {
  return { id: name, name, kind: 'weight', sets: 3, reps: '10', durationSec: 0, distanceM: 0, weightKg: 0, restSec: 0, breakSec: 0, note: '' }
}

function block(required: number, ...names: string[]): PlanBlock {
  return { id: 'b', required, restSec: 0, section: '', durationSec: 0, options: names.map(ex) }
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

describe('setState', () => {
  // Two taps, three states. A single tick could only say whether a set had
  // happened, which left a plank's timer nothing to start from.
  it('reads the three states a set can be in', () => {
    const logs: SetLog[] = [
      { done: true, weightKg: 0, startedAt: 'x', at: 'y' },
      { done: false, weightKg: 0, startedAt: 'x' },
      { done: false, weightKg: 0 },
    ]
    expect(setState(logs, 0)).toBe('done')
    expect(setState(logs, 1)).toBe('running')
    expect(setState(logs, 2)).toBe('idle')
    expect(setState(logs, 9)).toBe('idle')
  })

  it('treats a done set as done even if it was never started', () => {
    // Sessions recorded before sets had a start still read correctly.
    expect(setState([{ done: true, weightKg: 0 }], 0)).toBe('done')
  })

  it('keeps a set under way out of the done count', () => {
    const logs: SetLog[] = [{ done: true, weightKg: 0 }, { done: false, weightKg: 0, startedAt: 'x' }]
    expect(leadingDone(logs)).toBe(1)
    // The one under way is still the head of the queue, so it stays tappable.
    expect(setTappable(logs, 1)).toBe(true)
  })
})

describe('currentBlockId', () => {
  function session(blocks: PlanBlock[]): PlanSession {
    return {
      id: 's', planName: 'P', dayName: 'D',
      snapshot: { id: 'd', name: 'D', blocks },
      progress: { blocks: {} },
      startedAt: '2026-01-01T00:00:00Z',
      doneSets: 0, totalSets: 0, volumeKg: 0, notes: '',
    }
  }

  it('is the first block with work left in it', () => {
    const a: PlanBlock = { id: 'a', required: 1, restSec: 0, section: '', durationSec: 0, options: [ex('Squat')] }
    const b: PlanBlock = { id: 'b', required: 1, restSec: 0, section: '', durationSec: 0, options: [ex('Bench')] }
    const s = session([a, b])
    expect(currentBlockId(s, { blocks: {} })).toBe('a')

    const done = { blocks: { a: { picks: [], sets: { Squat: [
      { done: true, weightKg: 0 }, { done: true, weightKg: 0 }, { done: true, weightKg: 0 },
    ] } } } }
    expect(currentBlockId(s, done)).toBe('b')
  })

  it('is nothing once the whole day is finished', () => {
    const a: PlanBlock = { id: 'a', required: 1, restSec: 0, section: '', durationSec: 0, options: [ex('Squat')] }
    const done = { blocks: { a: { picks: [], sets: { Squat: [
      { done: true, weightKg: 0 }, { done: true, weightKg: 0 }, { done: true, weightKg: 0 },
    ] } } } }
    expect(currentBlockId(session([a]), done)).toBe('')
  })
})
