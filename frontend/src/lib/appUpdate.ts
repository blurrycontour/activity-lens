/**
 * Bridges the service-worker update prompt to the UI.
 *
 * `registerSW` lives in main.tsx, before React mounts, so the function that
 * applies a waiting update cannot be passed down as a prop. It is stashed here
 * and the arrival of an update is announced as a window event, which keeps the
 * components that surface it free of any service-worker knowledge.
 *
 * The Android app has no service worker but has the same question to answer —
 * "is there a newer version, and where do I go to get it" — so it reports into
 * the same state. That is what lets the avatar dot and the user menu's "Update
 * app" entry be written once and work on both.
 */

import { useEffect, useState } from 'react'
import { canSelfUpdate, requestUpdateCheck } from './native/appUpdate'

/** Fired when a new build has installed and is waiting to take over. */
export const UPDATE_READY_EVENT = 'al:update-ready'

type ApplyUpdate = (reloadPage?: boolean) => Promise<void>

let apply: ApplyUpdate | null = null
// Module-level rather than React state: the update arrives before any component
// that cares about it has necessarily mounted, so the fact has to outlive the
// event that announced it.
let pending = false

/** Called once at startup with vite-plugin-pwa's updater. */
export function setApplyUpdate(fn: ApplyUpdate): void {
  apply = fn
}

/** Records that a build is waiting and tells anyone listening. */
export function markUpdateReady(): void {
  if (pending) return
  pending = true
  window.dispatchEvent(new Event(UPDATE_READY_EVENT))
}

/**
 * Withdraws the offer, when a check finds the app already matches its server.
 *
 * Native only in practice. A waiting service worker does not un-wait, but the
 * Android app compares versions against a server that can be rolled back or
 * upgraded underneath it — and a dot that appears once and never clears stops
 * meaning anything.
 */
export function clearUpdatePending(): void {
  if (!pending) return
  pending = false
  window.dispatchEvent(new Event(UPDATE_READY_EVENT))
}

/** Whether a new build is installed and waiting to be applied. */
export function isUpdatePending(): boolean {
  return pending
}

/**
 * Acts on the waiting update.
 *
 * Two different things behind one name, because every caller — the toast, the
 * user menu — only wants to say "do the update thing" and should not have to
 * know which app it is running in:
 *
 *   web     activate the waiting worker and reload
 *   native  reopen the install dialog, which owns the download and the
 *           system installer handoff
 */
export async function applyPendingUpdate(): Promise<void> {
  if (canSelfUpdate()) {
    requestUpdateCheck()
    return
  }
  await apply?.(true)
}

/**
 * Subscribes a component to "a new build is waiting". Reads the current value
 * on mount too, so a component that mounts after the update landed — the user
 * menu, opened minutes later — still sees it.
 *
 * The listener re-reads rather than assuming true, so the same event can also
 * report an offer being withdrawn.
 */
export function useUpdatePending(): boolean {
  const [ready, setReady] = useState(isUpdatePending)
  useEffect(() => {
    const onChange = () => setReady(isUpdatePending())
    window.addEventListener(UPDATE_READY_EVENT, onChange)
    // Re-read on mount as well: the state may have changed between the initial
    // render and the effect running.
    onChange()
    return () => window.removeEventListener(UPDATE_READY_EVENT, onChange)
  }, [])
  return ready
}
