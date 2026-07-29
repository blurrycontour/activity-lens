/**
 * Bridges the service-worker update prompt to the UI.
 *
 * `registerSW` lives in main.tsx, before React mounts, so the function that
 * applies a waiting update cannot be passed down as a prop. It is stashed here
 * and the arrival of an update is announced as a window event, which keeps the
 * components that surface it free of any service-worker knowledge.
 */

import { useEffect, useState } from 'react'

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
  pending = true
  window.dispatchEvent(new Event(UPDATE_READY_EVENT))
}

/** Whether a new build is installed and waiting to be applied. */
export function isUpdatePending(): boolean {
  return pending
}

/**
 * Activates the waiting worker and reloads. Resolves only if something went
 * wrong — on success the page is already navigating away.
 */
export async function applyPendingUpdate(): Promise<void> {
  await apply?.(true)
}

/**
 * Subscribes a component to "a new build is waiting". Reads the current value
 * on mount too, so a component that mounts after the update landed — the user
 * menu, opened minutes later — still sees it.
 */
export function useUpdatePending(): boolean {
  const [ready, setReady] = useState(isUpdatePending)
  useEffect(() => {
    const onReady = () => setReady(true)
    window.addEventListener(UPDATE_READY_EVENT, onReady)
    return () => window.removeEventListener(UPDATE_READY_EVENT, onReady)
  }, [])
  return ready
}
