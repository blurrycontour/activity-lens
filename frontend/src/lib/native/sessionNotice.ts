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
  /** How far in, and what is being done — the shade's one useful line. */
  body: string
  /** The day and the plan, shown small in the header beside the app's name. */
  subText: string
  startedAt: string
  /**
   * The expanded view: several lines, shown when the notification is pulled
   * open. Where the collapsed line has to choose one fact, this can say what
   * is being done, what is next and how far in the session is.
   */
  bigText?: string
  /**
   * When the rest now running ends, in epoch milliseconds. Android turns it
   * into a countdown in the notification's header — the one number worth
   * having from a glance at the shade mid-rest — and the app posts nothing
   * further for it, because the platform ticks it down on its own.
   */
  restEndsAt?: number
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
