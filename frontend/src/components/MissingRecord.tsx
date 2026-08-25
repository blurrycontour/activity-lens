import { CloudOff, SearchX, ArrowLeft } from 'lucide-react'
import { ApiError } from '../lib/api'
import { useOnlineStatus } from '../lib/network'

/**
 * What a page shows when the record it was opened for did not come back.
 *
 * Five routes used to answer this five different ways: a spinner that never
 * ended, the backend's own lowercase error string as body text, and three
 * silent redirects. None of them said the thing you asked for is not there,
 * which is the one fact the reader needs.
 *
 * The distinction that matters is *why*, because the two have opposite
 * recoveries: a 404 means it is gone and you should go back, an unreachable
 * backend means try again in a minute. Deciding that here rather than at each
 * call site is the point — otherwise the next page to need this invents a sixth
 * answer.
 */
export default function MissingRecord({ noun, error, onBack, backLabel, onRetry }: {
  /** What was being opened, as it would appear mid-sentence: "workout", "profile". */
  noun: string
  /** Whatever the fetch rejected with. */
  error: unknown
  onBack: () => void
  /** Where back goes, named: "All equipment", "Discover". */
  backLabel: string
  onRetry?: () => void
}) {
  const online = useOnlineStatus()
  // 404 is the ordinary case; 400 is an id that was never valid, which to the
  // reader is the same thing. Anything else — a 500, a dropped connection —
  // is the app's problem rather than the record's, and retrying is fair.
  const status = error instanceof ApiError ? error.status : 0
  const gone = status === 404 || status === 400
  const offline = !online && !gone

  return (
    <div className="missing-record">
      {offline ? <CloudOff size={26} /> : <SearchX size={26} />}
      <h2>
        {offline ? `Can’t load this ${noun}` : `This ${noun} isn’t here`}
      </h2>
      <p>
        {offline
          ? 'You are offline, so it could not be fetched. It will be here when you reconnect.'
          : gone
            ? 'It may have been deleted, or it was never shared with you.'
            : 'Something went wrong fetching it.'}
      </p>
      <div className="missing-record-actions">
        {!gone && onRetry && (
          <button className="btn" onClick={onRetry}>Try again</button>
        )}
        <button className="btn btn-primary" onClick={onBack}>
          <ArrowLeft size={14} /> {backLabel}
        </button>
      </div>
    </div>
  )
}
