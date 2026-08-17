import { describe, expect, it } from 'vitest'
import { adoptIds, isDraft, namesIn, withoutDrafts } from './draftPlan'
import type { PlanDay, PlanExercise } from '../../data/plans'

function ex(name: string, id = ''): PlanExercise {
  return { id, name, kind: 'weight', sets: 3, reps: '10', durationSec: 0, weightKg: 0, restSec: 0, note: '' }
}

describe('withoutDrafts', () => {
  it('drops a row that has no name yet', () => {
    const days: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [
        { id: 'pb_1', required: 1, restSec: 0, options: [ex('Bench press', 'pe_1')] },
        { id: '', required: 1, restSec: 0, options: [ex('')] },
      ],
    }]
    expect(withoutDrafts(days)[0].blocks).toHaveLength(1)
  })

  it('drops an unnamed alternative without dropping its group', () => {
    const days: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [{ id: 'pb_1', required: 1, restSec: 0, options: [ex('Bench press', 'pe_1'), ex('  ')] }],
    }]
    const out = withoutDrafts(days)
    expect(out[0].blocks).toHaveLength(1)
    expect(out[0].blocks[0].options.map(o => o.name)).toEqual(['Bench press'])
  })

  it('keeps a break that belongs to a real block', () => {
    const days: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [{ id: 'pb_1', required: 1, restSec: 180, options: [ex('Bench press', 'pe_1')] }],
    }]
    expect(withoutDrafts(days)[0].blocks[0].restSec).toBe(180)
  })
})

describe('adoptIds', () => {
  // The regression this whole module exists for: tapping "Add exercise"
  // created a row, the autosave dropped it as nameless, and adopting the
  // server's answer deleted it from the screen a moment later.
  it('keeps a half-typed row that the server did not store', () => {
    const local: PlanDay[] = [{
      id: '',
      name: 'Chest',
      blocks: [
        { id: '', required: 1, restSec: 0, options: [ex('Bench press')] },
        { id: '', required: 1, restSec: 0, options: [ex('')] },
      ],
    }]
    const saved: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [{ id: 'pb_1', required: 1, restSec: 0, options: [ex('Bench press', 'pe_1')] }],
    }]

    const out = adoptIds(local, saved)
    expect(out[0].blocks).toHaveLength(2)
    expect(out[0].blocks[1].options[0].name).toBe('')
  })

  it('gives the saved rows their server ids', () => {
    const local: PlanDay[] = [{
      id: '',
      name: 'Chest',
      blocks: [{ id: '', required: 1, restSec: 0, options: [ex('Bench press'), ex('Push-ups')] }],
    }]
    const saved: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [{ id: 'pb_1', required: 1, restSec: 0, options: [ex('Bench press', 'pe_1'), ex('Push-ups', 'pe_2')] }],
    }]

    const out = adoptIds(local, saved)
    expect(out[0].id).toBe('pd_1')
    expect(out[0].blocks[0].id).toBe('pb_1')
    expect(out[0].blocks[0].options.map(o => o.id)).toEqual(['pe_1', 'pe_2'])
  })

  it('lines rows up past a draft in the middle', () => {
    const local: PlanDay[] = [{
      id: '',
      name: 'Chest',
      blocks: [
        { id: '', required: 1, restSec: 0, options: [ex('Bench press')] },
        { id: '', required: 1, restSec: 0, options: [ex('')] },
        { id: '', required: 1, restSec: 0, options: [ex('Cable fly')] },
      ],
    }]
    const saved: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [
        { id: 'pb_1', required: 1, restSec: 0, options: [ex('Bench press', 'pe_1')] },
        { id: 'pb_2', required: 1, restSec: 0, options: [ex('Cable fly', 'pe_2')] },
      ],
    }]

    const out = adoptIds(local, saved)
    // The draft must not swallow the id meant for the row after it, or the
    // next save inserts a duplicate of the cable fly.
    expect(out[0].blocks[0].id).toBe('pb_1')
    expect(out[0].blocks[1].id).toBe('')
    expect(out[0].blocks[2].id).toBe('pb_2')
  })

  it('keeps what is typed rather than taking the server text back', () => {
    const local: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [{ id: 'pb_1', required: 1, restSec: 0, options: [{ ...ex('Bench press throw', 'pe_1'), sets: 5 }] }],
    }]
    const saved: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [{ id: 'pb_1', required: 1, restSec: 0, options: [ex('Bench press', 'pe_1')] }],
    }]

    const out = adoptIds(local, saved)
    expect(out[0].blocks[0].options[0].name).toBe('Bench press throw')
    expect(out[0].blocks[0].options[0].sets).toBe(5)
  })

  it('leaves the tree alone when the server answered with nothing', () => {
    const local: PlanDay[] = [{ id: '', name: 'Chest', blocks: [{ id: '', required: 1, restSec: 0, options: [ex('Row')] }] }]
    expect(adoptIds(local, [])).toEqual(local)
  })
})

describe('isDraft and namesIn', () => {
  it('treats whitespace as no name', () => {
    expect(isDraft({ id: '', required: 1, restSec: 0, options: [ex('   ')] })).toBe(true)
    expect(isDraft({ id: '', required: 1, restSec: 0, options: [ex('Row')] })).toBe(false)
  })

  it('collects every name for the suggestion list', () => {
    const days: PlanDay[] = [{
      id: 'pd_1',
      name: 'Chest',
      blocks: [{ id: 'pb_1', required: 1, restSec: 0, options: [ex('Bench press'), ex('Push-ups')] }],
    }]
    expect(namesIn(days)).toEqual(['Bench press', 'Push-ups'])
  })
})
