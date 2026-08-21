/**
 * The sound a finished rest makes.
 *
 * Vibration reaches you through a pocket; a phone lying on a bench three feet
 * away is a different problem, and the answer to it is a noise. This is the one
 * sound the app makes, and it is made for the one moment that is worth
 * interrupting: a timer you are waiting on has run out.
 *
 * Synthesised rather than a file. Two short sine blips are a few lines of
 * WebAudio, and the alternative — shipping an audio asset — means a fetch that
 * can fail, a decode, a cache entry, and a licence, for a sound that lasts a
 * third of a second.
 *
 * Kept per device alongside the vibration switches, for the same reason they
 * are: whether a noise is welcome depends on the room you are in, not on the
 * account you are signed into.
 */

const ENABLED_KEY = 'al_chime'

/** Whether the chime is on for this device. Default on. */
export function chimeEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setChimeEnabled(on: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
  } catch { /* nothing depends on it */ }
}

type Ctor = typeof AudioContext

function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  // webkitAudioContext for older iOS, which is also where the resume dance
  // below matters most.
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ?? null
}

/** Whether this device can make the sound at all, for hiding the switch. */
export const canChime = () => audioCtor() !== null

let ctx: AudioContext | null = null

/**
 * Opens the audio device, from inside a user gesture.
 *
 * Browsers refuse to start an AudioContext except in response to a tap, and a
 * rest timer ends minutes later with nobody touching anything. So the context
 * is created on the way in — any tap in a running session will do — and kept
 * open for the rest of it. Without this the first chime of a session is
 * silently dropped and every one after it works, which is the most confusing
 * possible version of this feature.
 */
export function primeChime(): void {
  if (!chimeEnabled()) return
  try {
    const Ctor = audioCtor()
    if (!Ctor) return
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch { /* an audio device that will not open is not a broken workout */ }
}

/** One blip: a sine at `freq`, starting at `at`, lasting `dur` seconds. */
function blip(audio: AudioContext, freq: number, at: number, dur: number) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // An envelope rather than a bare start/stop: switching a sine on and off at
  // full amplitude produces a click at each end, which is louder than the note
  // and sounds like a fault.
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(0.35, at + 0.01)
  gain.gain.linearRampToValueAtTime(0, at + dur)
  osc.connect(gain).connect(audio.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

/**
 * Plays the timer-finished sound, if this device can and the user wants it.
 *
 * Two rising notes, because one is indistinguishable from a notification from
 * any other app on the phone, and because a rest ending is good news.
 */
export function chime(): void {
  if (!chimeEnabled()) return
  try {
    const Ctor = audioCtor()
    if (!Ctor) return
    ctx ??= new Ctor()
    // A context suspended by the browser (backgrounded tab, autoplay policy)
    // is resumed on the way past. It may not succeed, which is why nothing
    // here waits on it.
    if (ctx.state === 'suspended') void ctx.resume()
    const start = ctx.currentTime + 0.01
    blip(ctx, 880, start, 0.12)
    blip(ctx, 1320, start + 0.16, 0.18)
  } catch { /* see primeChime */ }
}
