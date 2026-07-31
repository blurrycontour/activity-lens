import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { api } from '../api'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../UnifiedPushPlugin.java. */
interface UnifiedPushPlugin {
  getStatus(): Promise<NativePushStatus>
  getDistributors(): Promise<{ distributors: Distributor[] }>
  register(options: { distributor: string }): Promise<void>
  unregister(): Promise<void>
  dismiss(options: { tag: string }): Promise<void>
  consumeTapLink(): Promise<{ link?: string | null }>
  addListener(event: 'endpoint', fn: (e: { endpoint?: string | null }) => void): Promise<PluginListenerHandle>
  addListener(event: 'registrationFailed', fn: (e: { reason?: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'notificationTap', fn: (e: { link?: string }) => void): Promise<PluginListenerHandle>
}

export interface NativePushStatus {
  /** Whether any distributor app is installed. Nothing works without one. */
  available: boolean
  /** Package name of the distributor in use, or null. */
  distributor?: string | null
  /** The push URL the distributor issued, once it has. */
  endpoint?: string | null
  /** Whether Android is currently allowing this app to post notifications. */
  permitted: boolean
}

export interface Distributor {
  packageName: string
  label: string
}

const UnifiedPush = registerPlugin<UnifiedPushPlugin>('UnifiedPush')

/** Rejected by enableNativePush when the user refuses the Android prompt. */
export const NOTIFICATIONS_DENIED = 'notifications-denied'

/**
 * How long to wait for a distributor to answer with an endpoint.
 *
 * Registration is a broadcast, so there is no reply to await — the endpoint
 * arrives separately, usually in well under a second for a local distributor but
 * only after ntfy has reached its server. Ten seconds is long enough to cover a
 * slow network and short enough that a distributor which is never going to
 * answer does not leave a spinner up indefinitely.
 */
const ENDPOINT_TIMEOUT_MS = 10_000

/** Whether this build can do native push at all. */
export function nativePushSupported(): boolean {
  return isNative()
}

export async function nativePushStatus(): Promise<NativePushStatus> {
  if (!isNative()) return { available: false, permitted: false }
  try {
    return await UnifiedPush.getStatus()
  } catch {
    // An older APK without the plugin. Reported as unavailable, which is
    // accurate, rather than breaking the Settings page.
    return { available: false, permitted: false }
  }
}

export async function listDistributors(): Promise<Distributor[]> {
  if (!isNative()) return []
  try {
    return (await UnifiedPush.getDistributors()).distributors
  } catch {
    return []
  }
}

/**
 * Registers with a distributor and tells the server where to push.
 *
 * Two things have to happen and either can fail: the distributor issues an
 * endpoint, and our server stores it. The endpoint is awaited rather than
 * assumed, because registering successfully and never hearing back is a real
 * outcome — a distributor whose own server is unreachable does exactly that —
 * and it must be reported as a failure rather than shown as an enabled switch
 * that will never deliver anything.
 */
export async function enableNativePush(distributor: string): Promise<string> {
  const endpoint = await new Promise<string>((resolve, reject) => {
    let handle: PluginListenerHandle | undefined
    const timer = setTimeout(() => {
      void handle?.remove()
      reject(new Error('The distributor did not respond. Check that it is set up and can reach its server.'))
    }, ENDPOINT_TIMEOUT_MS)

    const settle = (value: string) => {
      clearTimeout(timer)
      void handle?.remove()
      resolve(value)
    }

    // Subscribed before registering: the distributor may answer immediately, and
    // an endpoint delivered before the listener existed would be waited for
    // until the timeout despite having already arrived.
    void UnifiedPush.addListener('endpoint', e => {
      if (e.endpoint) settle(e.endpoint)
    })
      .then(h => {
        handle = h
        return UnifiedPush.register({ distributor })
      })
      .catch(err => {
        clearTimeout(timer)
        void handle?.remove()
        reject(err)
      })
  })

  await api.pushSubscribeUnifiedPush(endpoint)
  return endpoint
}

/** Gives the endpoint back to the distributor and forgets it server-side. */
export async function disableNativePush(): Promise<void> {
  const { endpoint } = await nativePushStatus()
  if (endpoint) {
    // The server first, for the same reason as Web Push: unregistering first and
    // then failing here would leave the server pushing to a dead endpoint.
    await api.pushUnsubscribe(endpoint).catch(() => {})
  }
  await UnifiedPush.unregister().catch(() => {})
}

/**
 * Re-registers a known endpoint with the server, once per launch.
 *
 * The phone and the server hold the same fact in two places, and they drift: a
 * distributor can issue a new endpoint while the app is closed — its own server
 * moved, or the registration lapsed — and the broadcast that announced it
 * reached a receiver with no WebView to tell. Nothing else would ever notice,
 * because every check the UI makes asks the phone.
 *
 * Sending it again is a cheap upsert keyed on the endpoint, so doing it
 * unconditionally is far more robust than trying to detect the mismatch. The
 * same reasoning as syncPushSubscription in lib/push.ts.
 */
export async function syncNativePush(): Promise<void> {
  if (!isNative()) return
  const { endpoint } = await nativePushStatus()
  if (!endpoint) return
  await api.pushSubscribeUnifiedPush(endpoint).catch(() => {})
}

/**
 * Removes a notification the user has since read in the app from the Android
 * tray. The counterpart of the service worker's DISMISS_NOTIFICATION on web,
 * which the app never receives because it runs no service worker.
 */
export async function dismissNativeNotification(tag: string): Promise<void> {
  if (!isNative()) return
  await UnifiedPush.dismiss({ tag }).catch(() => {})
}

/**
 * The in-app link of a tapped notification, if this launch came from one.
 *
 * Both polled and subscribed to, because a cold start delivers the intent before
 * any of this code exists and a tap while the app is open delivers it after.
 */
export async function consumeNotificationTap(): Promise<string | null> {
  if (!isNative()) return null
  try {
    return (await UnifiedPush.consumeTapLink()).link ?? null
  } catch {
    return null
  }
}

/**
 * Subscribes to taps that arrive while the app is running. Returns an
 * unsubscribe function, so a component that re-renders does not accumulate
 * listeners and navigate several times for one tap.
 */
export function onNotificationTap(fn: (link: string) => void): () => void {
  if (!isNative()) return () => {}
  let handle: PluginListenerHandle | undefined
  let cancelled = false
  void UnifiedPush.addListener('notificationTap', e => {
    if (e.link) fn(e.link)
  })
    .then(h => {
      handle = h
      // Removed immediately if the caller gave up while this was resolving.
      if (cancelled) void h.remove()
    })
    .catch(() => {})
  return () => {
    cancelled = true
    void handle?.remove()
  }
}
