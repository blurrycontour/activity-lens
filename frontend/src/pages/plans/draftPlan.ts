import type { PlanBlock, PlanDay } from '../../data/plans'

/**
 * Reconciling what is on screen with what the server accepted.
 *
 * The editor holds rows that are not plans yet: "Add exercise" creates a row
 * before there is anything to type into it. The server drops those — a block
 * with no named exercise is not something to store — so the editor cannot
 * simply adopt the saved tree back, or the row vanishes the instant it is
 * created. That was the bug: adding an exercise removed it immediately, which
 * made the editor unusable.
 *
 * These two functions are the seam. One decides what to send, the other takes
 * only the ids back.
 */

/** A block with nothing named in it — on screen, but not yet a plan. */
export function isDraft(b: PlanBlock): boolean {
  return !b.options.some(o => o.name.trim())
}

/** The tree as the server should see it: drafts and unnamed options removed. */
export function withoutDrafts(days: PlanDay[]): PlanDay[] {
  return days.map(d => ({
    ...d,
    blocks: d.blocks.filter(b => !isDraft(b)).map(b => ({
      ...b,
      options: b.options.filter(o => o.name.trim()),
    })),
  }))
}

/**
 * Copies server-issued ids onto the rows they belong to, changing nothing else.
 *
 * The saved tree is the local one with drafts removed, in the same order, so
 * the two can be walked together: each saved row lines up with the next
 * non-draft local row. Anything still being typed keeps its empty id and gets
 * a real one on the save after it has a name.
 *
 * Ids matter because they are what lets the next save update a row rather than
 * insert a second copy of it — and what lets a running session still match its
 * blocks after the plan behind it is edited.
 */
export function adoptIds(local: PlanDay[], saved: PlanDay[]): PlanDay[] {
  return local.map((d, di) => {
    const sd = saved[di]
    if (!sd) return d
    let si = 0
    const blocks = d.blocks.map(b => {
      if (isDraft(b)) return b
      const sb = sd.blocks[si++]
      if (!sb) return b
      let oi = 0
      return {
        ...b,
        id: sb.id,
        options: b.options.map(o => (o.name.trim() ? { ...o, id: sb.options[oi++]?.id ?? o.id } : o)),
      }
    })
    return { ...d, id: sd.id, blocks }
  })
}

/** Every exercise name in the tree, for the suggestion list. */
export function namesIn(days: PlanDay[]): string[] {
  return days.flatMap(d => d.blocks.flatMap(b => b.options.map(o => o.name)))
}
