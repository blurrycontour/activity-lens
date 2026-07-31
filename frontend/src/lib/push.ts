import { api } from './api'
import { dismissNativeNotification } from './native/unifiedPush'
import { isNative } from './serverConfig'

// Web Push enrolment. The service worker receives the push and draws the
// notification; this module only handles permission and the subscription
// handshake with our own backend.

/** Whether this browser can do Web Push at all. */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * The VAPID public key arrives as base64url text but `pushManager.subscribe`
 * wants raw bytes.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

/** Current enrolment state, without prompting for anything. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

/**
 * Re-registers this browser's existing subscription with the backend, once per
 * load.
 *
 * This exists because the browser's subscription and the server's record of it
 * are two separate pieces of state that can silently diverge: a failed
 * registration call, a restored database, or a subscription the browser
 * refreshed on its own all leave a device that believes it is subscribed while
 * the server has nobody to push to. Nothing would ever retry, because every
 * check the UI makes — `getSubscription()` — only ever asks the browser.
 *
 * Re-sending is a cheap upsert keyed on the endpoint, so doing it unconditionally
 * is far more robust than trying to detect the mismatch.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await api.pushSubscribe(sub.toJSON() as PushSubscriptionJSON).catch(() => {})
}

/**
 * Asks permission if needed, subscribes, and registers the subscription with
 * the backend. Returns the resulting state so the caller can explain a refusal
 * rather than silently doing nothing.
 *
 * Note for iOS: Safari only grants push to a PWA that has been added to the
 * Home Screen, so this can legitimately fail in a normal browser tab there.
 */
export async function enablePush(vapidKey: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission !== 'granted') {
    if ((await Notification.requestPermission()) !== 'granted') {
      return Notification.permission === 'denied' ? 'denied' : 'off'
    }
  }
  const reg = await navigator.serviceWorker.ready
  // Reuse an existing subscription when there is one: re-subscribing with the
  // same key returns the same endpoint anyway, and the backend upserts on it.
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
    // Required by Chrome: every push must result in a visible notification.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
  })
  await api.pushSubscribe(sub.toJSON() as PushSubscriptionJSON)
  return 'on'
}

/** Unsubscribes this browser and forgets it server-side. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    // Tell the backend first: if unsubscribing succeeds but the API call fails,
    // the server would keep pushing to a dead endpoint until it 410s.
    await api.pushUnsubscribe(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
  return 'off'
}

/** Remembers that we have already prompted, so we only ever ask once. */
const PROMPTED_KEY = 'push.prompted'

/**
 * Asks for notification permission once, on app start, when it has never been
 * decided. Returns the resulting state.
 *
 * Two caveats worth knowing. Browsers treat an unprompted permission request as
 * a weak signal and may auto-dismiss it, and Safari requires a user gesture
 * outright — so on iOS this reliably does nothing and the user has to enable
 * push from Settings or the notification panel. That is why both of those
 * entry points exist rather than relying on this.
 *
 * The localStorage flag means someone who dismisses the prompt is not asked
 * again on every load.
 */
export async function maybePromptForPush(vapidKey: string): Promise<PushState> {
  if (!pushSupported() || !vapidKey) return 'unsupported'
  if (Notification.permission !== 'default') return pushState()
  if (localStorage.getItem(PROMPTED_KEY) === '1') return 'off'
  localStorage.setItem(PROMPTED_KEY, '1')
  try {
    return await enablePush(vapidKey)
  } catch {
    return 'off'
  }
}

/**
 * Closes an OS notification that has since been read inside the app, so a
 * banner does not linger in the tray after you have dealt with it elsewhere.
 * Notifications are tagged with their id, which is what makes this targetable.
 */
export async function dismissOSNotification(tag: string): Promise<void> {
  // The Android app runs no service worker — the notification was posted by the
  // UnifiedPush receiver, so that is what has to take it back. Same intent,
  // different mechanism, so callers do not have to care which they are on.
  if (isNative()) {
    await dismissNativeNotification(tag)
    return
  }
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.ready
  reg.active?.postMessage({ type: 'DISMISS_NOTIFICATION', tag })
}
