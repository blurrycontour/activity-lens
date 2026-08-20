import type { SessionProgress } from '../../data/plans'

/**
 * The in-progress session's ticks, kept on the device.
 *
 * Phones kill backgrounded apps, and they do it mid-workout. The server copy
 * is written on a debounce, so the last few ticks before the app went away may
 * never have left the device — this is what makes reopening land on the
 * session as it was rather than as the server last heard.
 *
 * localStorage rather than a cookie: cookies ride along on every request to
 * the server, and this is client state the server already has a better copy
 * of most of the time. It is small, one session at a time, and cleared on
 * finish or discard.
 */
const KEY = 'al_session_progress'

interface Cached {
  id: string
  progress: SessionProgress
  at: number
}

/**
 * How long a cached tick outranks the server's copy.
 *
 * The cache exists to cover a crash, which is minutes. Beyond a day it is more
 * likely to be a stale copy on a device that has been sitting in a drawer
 * while the session was finished elsewhere, and preferring it would resurrect
 * work the user has already moved past.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export function cacheProgress(sessionId: string, progress: SessionProgress): void {
  try {
    const payload: Cached = { id: sessionId, progress, at: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // A full or disabled store is not a reason to fail a tick — the server
    // copy is still being written, and it is the one that matters.
  }
}

/** The cached progress for this session, if it is this session's and fresh. */
export function readCachedProgress(sessionId: string): SessionProgress | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as Cached
    if (cached.id !== sessionId) return null
    if (Date.now() - cached.at > MAX_AGE_MS) return null
    if (!cached.progress?.blocks) return null
    return cached.progress
  } catch {
    return null
  }
}

export function clearCachedProgress(sessionId?: string): void {
  try {
    if (sessionId) {
      const raw = localStorage.getItem(KEY)
      if (raw && (JSON.parse(raw) as Cached).id !== sessionId) return
    }
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do: the entry expires on its own.
  }
}
