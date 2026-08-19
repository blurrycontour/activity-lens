/**
 * Haptic feedback for a training session.
 *
 * A session is the one place in this app you are not looking at the screen —
 * your hands are on a bar, the phone is on the floor or in a pocket, and the
 * things worth knowing (that a set registered, that the rest is over) are
 * exactly the things you cannot see. A short buzz says them without asking you
 * to pick the phone up.
 *
 * Stored per device rather than on the account, deliberately. This is a
 * property of the hardware in your hand: `navigator.vibrate` does nothing at
 * all on any desktop browser, and a single account-wide flag would mean
 * turning it off on the laptop where it never worked also turned it off on the
 * phone where it did. localStorage is the same place the theme and the sidebar
 * width live, for the same reason.
 */

/** Whether session events buzz at all. */
const ENABLED_KEY = 'al_haptics'
/** Whether a long rest ending buzzes. Separate — see longTimerSec. */
const TIMERS_KEY = 'al_haptic_timers'
/** Where the "long enough to be worth a buzz" threshold is kept. */
const TIMER_SEC_KEY = 'al_haptic_timer_sec'

/**
 * How long a timer has to be before its end is worth a buzz.
 *
 * A rest between sets is often twenty or thirty seconds, and you spend it
 * standing over the bar watching the clock — a buzz there tells you something
 * you are already looking at. Past a minute you have put the phone down and
 * started doing something else, which is the case this exists for.
 */
export const LONG_TIMER_SEC = 60

/** The thresholds offered in settings, in seconds. */
export const LONG_TIMER_CHOICES = [30, 60, 90, 120, 180] as const

/** The threshold this device is set to, defaulting to LONG_TIMER_SEC. */
export function longTimerSec(): number {
  try {
    const n = Number(localStorage.getItem(TIMER_SEC_KEY))
    // Anything unrecognised — a hand-edited value, a key from an older
    // build — falls back rather than silently disabling the buzz.
    return LONG_TIMER_CHOICES.includes(n as typeof LONG_TIMER_CHOICES[number]) ? n : LONG_TIMER_SEC
  } catch {
    return LONG_TIMER_SEC
  }
}

export function setLongTimerSec(sec: number) {
  try {
    localStorage.setItem(TIMER_SEC_KEY, String(sec))
  } catch { /* nothing depends on it */ }
}

/**
 * What each event feels like.
 *
 * Deliberately distinct rather than one buzz reused: they are felt, not read,
 * and "did that register?" is the question a single undifferentiated pulse
 * leaves you with. Length carries the weight — a set is the lightest thing
 * that happens and a finished session the heaviest.
 */
const PATTERNS = {
  /** One set ticked. The lightest touch that is still felt through a pocket. */
  set: [18],
  /** Every set of an exercise done. */
  exercise: [28, 45, 28],
  /** A session started, after the countdown. */
  start: [40, 70, 40],
  /** A session finished. */
  finish: [55, 70, 55, 70, 110],
  /** Every set in the session done — the confetti moment. */
  complete: [40, 60, 40, 60, 40, 60, 140],
  /** A session discarded. One flat pulse: nothing to celebrate. */
  discard: [140],
  /** A long rest is over. The one that has to reach you across a room. */
  timer: [180, 90, 180],
} as const

export type Haptic = keyof typeof PATTERNS

function readFlag(key: string): boolean {
  try {
    // Default on: the feature is only reachable where it works, and a phone
    // that stays silent through a whole session reads as broken rather than
    // as unconfigured.
    return localStorage.getItem(key) !== 'off'
  } catch {
    // Private mode, or storage disabled. Not worth failing a session over.
    return true
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch { /* nothing to do, and nothing that depends on it */ }
}

export const hapticsEnabled = () => readFlag(ENABLED_KEY)
export const setHapticsEnabled = (on: boolean) => writeFlag(ENABLED_KEY, on)
export const timerHapticsEnabled = () => readFlag(TIMERS_KEY)
export const setTimerHapticsEnabled = (on: boolean) => writeFlag(TIMERS_KEY, on)

/** Whether this device can vibrate at all, for hiding the settings that say it can. */
export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

/**
 * Buzzes, if this device can and the user has not turned it off.
 *
 * Never throws and never reports: a failed vibration is not a failure of
 * whatever the user was actually doing, and every caller is in the middle of
 * recording a set.
 */
export function haptic(kind: Haptic) {
  if (!canVibrate() || !hapticsEnabled()) return
  // The long-timer switch gates only the long-timer buzz; everything else
  // follows the main one.
  if (kind === 'timer' && !timerHapticsEnabled()) return
  try {
    navigator.vibrate(PATTERNS[kind] as unknown as number[])
  } catch { /* see above */ }
}
