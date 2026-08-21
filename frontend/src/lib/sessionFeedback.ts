/**
 * How a training session tells you something happened.
 *
 * A session is the one place in this app you are not looking at the screen —
 * your hands are on a bar, the phone is on the floor or in a pocket, and the
 * things worth knowing (that a set registered, that the rest is over) are
 * exactly the things you cannot see.
 *
 * Two ways of saying it, and which one arrives depends on where the phone
 * ended up rather than on anything the app can know: a buzz reaches you
 * through a pocket, a sound reaches you across a room. So they are one
 * vocabulary with two switches rather than two features — every moment worth
 * announcing can do both, and each is optional on its own.
 *
 * Both are stored per device rather than on the account. Vibration is a
 * property of the hardware in your hand, `navigator.vibrate` does nothing at
 * all on a desktop, and whether a noise is welcome depends on the room you are
 * standing in — a single account-wide flag would mean turning it off on the
 * laptop where it never worked also turned it off in the gym.
 */

import { vibrateNative } from './native/shell'
import { isNative } from './serverConfig'

const BUZZ_KEY = 'al_haptics'
const SOUND_KEY = 'al_chime'
/** Where the "long enough to be worth announcing" threshold is kept. */
const TIMER_SEC_KEY = 'al_haptic_timer_sec'

/**
 * The moments a session announces.
 *
 * Deliberately distinct rather than one signal reused: they are felt and heard
 * rather than read, and "did that register?" is the question a single
 * undifferentiated pulse leaves you with. Weight follows importance — a set is
 * the lightest thing that happens and a finished session the heaviest.
 */
export type Signal =
  /** One set ticked. */
  | 'set'
  /** Every set of an exercise done. */
  | 'exercise'
  /** A session started, after the countdown. */
  | 'start'
  /** A session finished. */
  | 'finish'
  /** Every set in the session done — the confetti moment. */
  | 'complete'
  /** A session discarded. */
  | 'discard'
  /** A rest is over. The one that has to reach you across a room. */
  | 'timer'
  /**
   * A nudge sent to someone. The one signal here that is not about a session
   * at all — it lives here because a second copy of the audio device, the
   * envelope and the two switches, kept somewhere else, would be the same code
   * drifting apart.
   */
  | 'ping'

/** Vibration patterns, in milliseconds: buzz, pause, buzz… */
const PATTERNS: Record<Signal, number[]> = {
  set: [18],
  exercise: [28, 45, 28],
  start: [40, 70, 40],
  finish: [55, 70, 55, 70, 110],
  complete: [40, 60, 40, 60, 40, 60, 140],
  /** One flat pulse: nothing to celebrate. */
  discard: [140],
  timer: [180, 90, 180],
  /** Barely there: this is a receipt, not an event. */
  ping: [14],
}

/**
 * Tones, as [frequency in hertz, start offset, length] in seconds.
 *
 * Quiet and short for the things that happen constantly, and only the end of a
 * rest gets something that carries — a set ticking should be a tick, not an
 * alarm, or a session becomes forty interruptions.
 */
const TONES: Record<Signal, [number, number, number][]> = {
  set: [[880, 0, 0.05]],
  exercise: [[880, 0, 0.07], [1175, 0.09, 0.09]],
  start: [[660, 0, 0.09], [990, 0.11, 0.14]],
  finish: [[880, 0, 0.1], [1175, 0.12, 0.1], [1568, 0.25, 0.22]],
  complete: [[880, 0, 0.09], [1175, 0.11, 0.09], [1568, 0.22, 0.09], [2093, 0.33, 0.26]],
  /** Falling, and low: the one signal that is not good news. */
  discard: [[440, 0, 0.14], [330, 0.16, 0.2]],
  timer: [[880, 0, 0.12], [1320, 0.16, 0.18]],
  /** Two quick notes, up a fifth: the sound of something small being sent. */
  ping: [[1046, 0, 0.06], [1568, 0.07, 0.11]],
}

/**
 * How long a rest has to be before its end is worth announcing.
 *
 * A rest between sets is often twenty seconds, and you spend it standing over
 * the bar watching the clock — announcing that tells you something you are
 * already looking at. Past a minute you have put the phone down and started
 * doing something else, which is the case this exists for.
 */
export const LONG_TIMER_SEC = 60

/**
 * The thresholds offered in settings, in seconds.
 *
 * Fifteen is here because "long" is a matter of what you are doing: a fifteen
 * second rest between drop sets is still long enough to look away, and someone
 * who wants every rest to reach them should be able to say so.
 */
export const LONG_TIMER_CHOICES = [15, 30, 60, 90, 120, 180] as const

export function longTimerSec(): number {
  try {
    const n = Number(localStorage.getItem(TIMER_SEC_KEY))
    // Anything unrecognised — a hand-edited value, a key from an older build —
    // falls back rather than silently going quiet.
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

function readFlag(key: string, fallback = true): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v !== 'off'
  } catch {
    // Private mode, or storage disabled. Not worth failing a session over.
    return fallback
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch { /* nothing that depends on it */ }
}

export const buzzEnabled = () => readFlag(BUZZ_KEY)
export const setBuzzEnabled = (on: boolean) => writeFlag(BUZZ_KEY, on)
export const soundEnabled = () => readFlag(SOUND_KEY)
export const setSoundEnabled = (on: boolean) => writeFlag(SOUND_KEY, on)

/**
 * Whether this device can vibrate at all, for hiding a switch that would lie.
 *
 * True in the native app whatever the WebView says: the buzz goes through the
 * system Vibrator there, and `navigator.vibrate` being absent from a WebView
 * says nothing about whether the phone has a motor.
 */
export const canBuzz = () =>
  isNative() || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')

type Ctor = typeof AudioContext

function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  // webkitAudioContext for older iOS, which is also where the resume dance
  // below matters most.
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ?? null
}

/** Whether this device can make a sound at all. */
export const canSound = () => audioCtor() !== null

let ctx: AudioContext | null = null

/**
 * Opens the audio device, from inside a user gesture.
 *
 * Browsers refuse to start an AudioContext except in response to a tap, and a
 * rest timer ends minutes later with nobody touching anything. So it is opened
 * on the way in — any tap on the plans pages will do — and kept open for the
 * rest of the session. Without this the first sound of a session is silently
 * dropped and every one after it works, which is the most confusing possible
 * version of this.
 */
export function primeSound(): void {
  if (!soundEnabled()) return
  try {
    const Ctor = audioCtor()
    if (!Ctor) return
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch { /* an audio device that will not open is not a broken workout */ }
}

/** One tone: a sine at `freq`, starting at `at`, lasting `dur` seconds. */
function tone(audio: AudioContext, freq: number, at: number, dur: number) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // An envelope rather than a bare start/stop: switching a sine on and off at
  // full amplitude produces a click at each end, which is louder than the note
  // itself and sounds like a fault.
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(0.32, at + 0.01)
  gain.gain.linearRampToValueAtTime(0, at + dur)
  osc.connect(gain).connect(audio.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

/** Plays one signal's tones, if this device can and the user wants them. */
export function sound(kind: Signal): void {
  if (!soundEnabled()) return
  try {
    const Ctor = audioCtor()
    if (!Ctor) return
    ctx ??= new Ctor()
    // A context suspended by the browser (backgrounded tab, autoplay policy)
    // is resumed on the way past. It may not succeed, which is why nothing
    // here waits on it.
    if (ctx.state === 'suspended') void ctx.resume()
    const start = ctx.currentTime + 0.01
    for (const [freq, at, dur] of TONES[kind]) tone(ctx, freq, start + at, dur)
  } catch { /* see primeSound */ }
}

/**
 * Buzzes, if this device can and the user wants it.
 *
 * Native first, then the web API. In the Android app `navigator.vibrate` is a
 * function that exists, returns true and does nothing — it needs a manifest
 * permission it never mentions, and Chrome ignores it outright while the page
 * is hidden, which during a rest is most of the time. The native path has
 * neither problem, and the browser path is what every other device uses.
 */
export function buzz(kind: Signal): Promise<void> {
  if (!buzzEnabled()) return Promise.resolve()
  const pattern = PATTERNS[kind]
  if (isNative()) {
    return vibrateNative(pattern).then(done => {
      if (!done) webVibrate(pattern)
    })
  }
  webVibrate(pattern)
  return Promise.resolve()
}

function webVibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch { /* a failed vibration is not a failed workout */ }
}

/**
 * Says that something happened, both ways at once.
 *
 * Never throws and never reports: every caller is in the middle of recording a
 * set, and a device that will not buzz is not a reason to interrupt that.
 */
export function signal(kind: Signal): void {
  void buzz(kind)
  sound(kind)
}

/**
 * The same, but waits for the buzz to have actually been asked for.
 *
 * For the two signals that are the last thing to happen on a screen. A buzz in
 * the native app is a message across the Capacitor bridge, and finishing a
 * session navigates away in the same tick that sends it — the tone survives
 * that, because it is already scheduled on an audio device that outlives the
 * page, and the message does not. Everywhere else the fire-and-forget `signal`
 * is right: nothing is racing it.
 */
export async function signalNow(kind: Signal): Promise<void> {
  sound(kind)
  await buzz(kind)
}
