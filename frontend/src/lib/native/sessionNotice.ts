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
export interface SessionNotice {
  sessionId: string
  /** The day being trained. */
  title: string
  /** The row of numbers beside the running clock. */
  body: string
  /** Sets done and the day's total, drawn as a ring in the icon slot. */
  done: number
  total: number
  /** The day and the plan, shown small in the header beside the app's name. */
  subText: string
  startedAt: string
  /**
   * One more line, shown only when the notification is pulled open: what comes
   * after the thing you are on. Collapsed has two lines and both are spoken
   * for; this is the question you open a notification to answer.
   */
  nextUp?: string
  /**
   * When the rest now running ends, in epoch milliseconds — **as a string**.
   *
   * A string because the bridge carries JSON and Capacitor reads a number back
   * out by asking what Java type it landed as: an epoch in milliseconds is far
   * past the range of an int, so it arrives as a Long, and `getDouble` returns
   * null for those rather than converting. The countdown silently never
   * started, while `startedAt` — which has always been an ISO string — worked
   * the whole time. Digits in a string have no such opinion.
   *
   * Android ticks it down on its own once it has it, so nothing is re-posted
   * for the countdown.
   */
  restEndsAt?: string
}

export interface SessionNoticePlugin {
  show(options: SessionNotice): Promise<void>
  clear(): Promise<void>
}

const SessionNotice = registerPlugin<SessionNoticePlugin>('SessionNotice')

/**
 * The notice currently standing, so it can be put back.
 *
 * Android 14 lets a person swipe away even an ongoing notification, and one
 * swiped away stays away — there is no event for it and no way to ask whether
 * it is still there. So the last one posted is remembered, and re-posted every
 * time the app comes back to the foreground: whatever happened to it while we
 * were not looking, opening the app puts it right. Posting an identical
 * notification under the same id is free when it is already showing.
 */
let standing: SessionNotice | null = null

/** Puts the ongoing notification up, or updates the one already showing. */
export async function showSessionNotice(notice: SessionNotice): Promise<void> {
  standing = notice
  if (!isNative()) return
  try {
    await SessionNotice.show(notice)
  } catch {
    // An older app build has no such plugin, and a denied notification
    // permission is the user's answer. Neither is a reason to interrupt a
    // workout — the session itself is unaffected.
  }
}

/**
 * Whether the session runner is on screen and owns what the shade says.
 *
 * The runner posts a far better notice than anything else can — the exercise,
 * what is next, the rest counting down — but only while it is mounted. Leave
 * the page and its last notice is a snapshot that ages: re-posting it on the
 * next resume would put a finished exercise back in the shade. So it claims
 * ownership while it is there, and the app-wide watcher builds a fresh plain
 * notice whenever nothing is claiming.
 */
let claimed = false

/** Called by the runner while it is mounted; the return value releases it. */
export function claimSessionNotice(): () => void {
  claimed = true
  return () => { claimed = false }
}

export const sessionNoticeClaimed = () => claimed && standing !== null

/** Puts the remembered notice back, if there is one. */
export async function repostSessionNotice(): Promise<void> {
  if (standing) await showSessionNotice(standing)
}

/** Takes it down, on finish or discard. */
export async function clearSessionNotice(): Promise<void> {
  standing = null
  if (!isNative()) return
  try {
    await SessionNotice.clear()
  } catch {
    // Same as above. Android also clears it when the app is uninstalled or the
    // notification is swiped, so a failure here is not a leak.
  }
}
