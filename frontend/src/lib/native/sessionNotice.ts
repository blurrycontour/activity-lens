import { registerPlugin } from '@capacitor/core'
import { isNative } from '../serverConfig'

/**
 * The phone's ongoing notification for a training session.
 *
 * A session is the one thing in this app that is happening *now* and outlives
 * looking at the screen: the app goes in a pocket between sets, and Android
 * will kill it. An ongoing notification is how the platform expects that to be
 * represented — it survives the app being backgrounded, shows the elapsed
 * time, and taps straight back into the session.
 *
 * Built on the app's own notification code rather than a plugin dependency:
 * UnifiedPushReceiver already creates channels and tap intents, so this is a
 * second use of machinery that exists, not a new one.
 *
 * Every call is a no-op on the web, where there is no such thing as an ongoing
 * notification and a service worker one would be a worse version of the same
 * idea.
 */
export interface SessionNoticePlugin {
  show(options: { sessionId: string; title: string; body: string; startedAt: string }): Promise<void>
  clear(): Promise<void>
}

const SessionNotice = registerPlugin<SessionNoticePlugin>('SessionNotice')

/** Puts the ongoing notification up, or updates the one already showing. */
export async function showSessionNotice(
  sessionId: string,
  dayName: string,
  planName: string,
  startedAt: string,
): Promise<void> {
  if (!isNative()) return
  try {
    await SessionNotice.show({ sessionId, title: dayName, body: planName, startedAt })
  } catch {
    // An older app build has no such plugin, and a denied notification
    // permission is the user's answer. Neither is a reason to interrupt a
    // workout — the session itself is unaffected.
  }
}

/** Takes it down, on finish or discard. */
export async function clearSessionNotice(): Promise<void> {
  if (!isNative()) return
  try {
    await SessionNotice.clear()
  } catch {
    // Same as above. Android also clears it when the app is uninstalled or the
    // notification is swiped, so a failure here is not a leak.
  }
}
