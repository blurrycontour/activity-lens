import { Globe, Users } from 'lucide-react'

/** The three fields any shareable thing — a workout, a plan, a session —
 *  carries about its own sharing. Structural rather than `Workout` itself,
 *  so the same badge draws on a plan or a session without importing a type
 *  that means something narrower. */
interface Shareable {
  visibility?: 'private' | 'public'
  sharedWithCount?: number
  /** Set on a workout's detail response; plans and sessions have no
   *  equivalent and simply never carry it — sharedWithCount already covers
   *  the case it exists for. */
  shared?: boolean
}

/**
 * Marks something you have made public or shared with someone.
 *
 * Shared by the list and the detail page, which know slightly different things
 * about the same fact: a list row carries the recipient count, computed for the
 * whole library in one grouped query, while the detail response carries a plain
 * `shared` flag because counting recipients per page view would be a query
 * bought for a number nobody reads there. Both mean "somebody else can see
 * this", so both get the same mark — with the count when there is one.
 *
 * It lived inside the list page and was invisible on the workout itself, which
 * is the one place you would go to check.
 */
export default function ShareBadge({ workout: w }: { workout: Shareable }) {
  const count = w.sharedWithCount ?? 0
  const isPublic = w.visibility === 'public'
  if (!isPublic && count === 0 && !w.shared) return null
  return (
    <span
      className="share-badge"
      title={[
        isPublic ? 'Visible to everyone on this instance' : null,
        count > 0
          ? `Shared with ${count} ${count === 1 ? 'person' : 'people'}`
          : !isPublic ? 'Shared with someone' : null,
      ].filter(Boolean).join(' · ')}
    >
      {isPublic ? <Globe size={10} /> : <Users size={10} />}
      {count > 0 && count}
    </span>
  )
}
