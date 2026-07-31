import { FolderDown } from 'lucide-react'
import { type Workout } from '../data/workouts'

/**
 * A small mark on a workout's type icon saying it arrived on its own.
 *
 * Only auto-import is marked, deliberately. Marking every origin — a badge for
 * "you uploaded this", another for "you typed this in" — would put a decoration
 * on every row in the library to tell the user something they already know, and
 * the one case that is genuinely worth noticing would be lost among them. A mark
 * that appears on two rows out of two hundred is information; a mark on all two
 * hundred is texture.
 *
 * Renders nothing for every other source, including workouts old enough to have
 * none recorded.
 */
export default function SourceMark({ source }: { source?: Workout['source'] }) {
  if (source !== 'autoimport') return null
  return (
    <span className="origin-mark" title="Imported automatically from your watched folder">
      <FolderDown size={9} strokeWidth={2.5} />
    </span>
  )
}
