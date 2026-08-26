import { useEffect } from 'react'

/** The bit of the Screen Wake Lock API this needs, without a DOM lib upgrade. */
interface WakeLockSentinel { release(): Promise<void> }
type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> }
}

/**
 * Keeps the screen awake while `active`.
 *
 * A session runner is the one screen in this app you are not touching. You set
 * it down, do the work, and look back at it — by which time the phone has
 * locked, and the rest timer that was the whole point is behind a passcode.
 * Every timer app on every platform holds this lock; it is not an optimisation,
 * it is the feature working at all.
 *
 * Re-acquired on visibility change, because the browser drops the lock whenever
 * the tab is hidden and does *not* give it back when you return — so without
 * this, one glance at a notification would silently cost you the lock for the
 * rest of the session.
 *
 * Absent on some browsers and refused in some contexts (it needs a secure
 * origin). Both are fine: the failure is that the screen dims as it did before,
 * which is not worth an error to anyone.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const api = (navigator as WakeLockNavigator).wakeLock
    if (!active || !api) return

    let sentinel: WakeLockSentinel | null = null
    let dropped = false

    const acquire = async () => {
      if (dropped || document.visibilityState !== 'visible') return
      try {
        sentinel = await api.request('screen')
      } catch {
        // Denied, or the document was hidden between the check and the call.
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire() }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      dropped = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
