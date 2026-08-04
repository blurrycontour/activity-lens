import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { api } from '../api'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../UnifiedPushPlugin.java. */
interface UnifiedPushPlugin {
  getStatus(): Promise<NativePushStatus>
  getDistributors(): Promise<{ distributors: Distributor[] }>
  register(options: { distributor: string }): Promise<void>
  refresh(): Promise<void>
  unregister(): Promise<void>
  dismiss(options: { tag: string }): Promise<void>
  consumeTapLink(): Promise<NotificationTap>
  addListener<E extends keyof PluginEvents>(
    event: E,
    fn: (e: PluginEvents[E]) => void,
  ): Promise<PluginListenerHandle>
}

/** Everything the plugin emits, and what each event carries. */
interface PluginEvents {
  endpoint: { endpoint?: string | null }
  registrationFailed: { reason?: string }
  notificationTap: Record<string, never>
  message: PushMessage
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

/**
 * A tapped notification: where it points, and which notification it was.
 *
 * The id matters as much as the link — tapping a notification is reading it, and
 * without the id the app cannot mark it read, so it stays bold in the list and
 * in the unread count after the user has already dealt with it.
 */
export interface NotificationTap {
  link?: string | null
  id?: string | null
}

/** A push the receiver handed to the app instead of drawing it. */
export interface PushMessage {
  id?: string
  title?: string
  body?: string
  link?: string
  icon?: string
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

  await report(endpoint)
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
  localStorage.removeItem(REPORTED_ENDPOINT_KEY)
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
  if (endpoint) await report(endpoint)

  // Then ask the distributor to confirm the registration still exists. It may
  // not: deleting the subscription in ntfy, or clearing that app's data, leaves
  // our endpoint in place and perfectly plausible while nothing is listening at
  // the other end — the one failure mode with no symptom except notifications
  // quietly stopping. Re-registering is idempotent and repairs it.
  //
  // The reply is a broadcast, so it is not awaited here; the listener below is
  // what carries a changed endpoint to the server.
  await UnifiedPush.refresh().catch(() => {})
}

/** The endpoint most recently handed to the server, so a change can be seen. */
const REPORTED_ENDPOINT_KEY = 'push.nativeEndpoint'

/**
 * Tells the server where to push, and retires whatever it was told before.
 *
 * Subscriptions are keyed on the endpoint, so a re-registration that yields a
 * new one is a new row rather than an update — and the old row would keep the
 * server posting to a dead topic for as long as the account exists.
 */
async function report(endpoint: string): Promise<void> {
  // Sent every time, not only on a change: it is a cheap upsert, and detecting
  // "the server already knows" is guesswork the phone cannot actually do.
  await api.pushSubscribeUnifiedPush(endpoint).catch(() => {})
  const previous = localStorage.getItem(REPORTED_ENDPOINT_KEY)
  localStorage.setItem(REPORTED_ENDPOINT_KEY, endpoint)
  // Retired only after the replacement is in place, so a failure here cannot
  // leave the account with no endpoint at all.
  if (previous && previous !== endpoint) await api.pushUnsubscribe(previous).catch(() => {})
}

/**
 * Keeps the server in step with endpoints that arrive while the app is open.
 *
 * A refresh, a distributor that reconnects, a registration recreated after the
 * user deleted it — all of them land as an `endpoint` event, and none of them
 * involve the UI. Subscribed for the life of the app rather than for the life of
 * a component, which is why this is not a hook.
 */
export function watchNativeEndpoint(): () => void {
  return subscribe('endpoint', e => { if (e.endpoint) void report(e.endpoint) })
}

/** Remembers that the automatic enrolment below has had its one attempt. */
const AUTO_ENROL_KEY = 'push.autoEnrolled'

/**
 * Turns push on by itself, once, when everything needed is already in place.
 *
 * The permission prompt happens at first launch, so a user who granted it has
 * said yes to notifications — and then had to find a switch in Settings to
 * actually receive any. That second step is the one nobody takes, and it made
 * the whole feature look broken. The web app has always behaved this way
 * (maybePromptForPush enrols as soon as permission is granted); this is the same
 * rule for the app.
 *
 * Every condition here is a reason not to act:
 *
 *   permission not granted   the user said no, and enrolling would be silent
 *   no distributor           nothing to enrol with
 *   already registered       nothing to do
 *   preference off           the user turned it off, and this must not undo that
 *   already attempted        one try; a failure must not retry on every launch
 */
export async function maybeEnrolNativePush(pushPref: boolean): Promise<void> {
  if (!isNative() || !pushPref) return
  if (localStorage.getItem(AUTO_ENROL_KEY) === '1') return

  const status = await nativePushStatus()
  if (!status.permitted || !status.available || status.endpoint) return

  const distributors = await listDistributors()
  if (distributors.length === 0) return

  localStorage.setItem(AUTO_ENROL_KEY, '1')
  // The first distributor, not a chosen one: with several installed, picking for
  // the user is worse than leaving it to Settings, but with the usual one
  // installed this is the difference between push working and not.
  await enableNativePush(distributors[0].packageName).catch(() => {})
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
export async function consumeNotificationTap(): Promise<NotificationTap | null> {
  if (!isNative()) return null
  try {
    const tap = await UnifiedPush.consumeTapLink()
    return tap.link || tap.id ? tap : null
  } catch {
    return null
  }
}

/**
 * Subscribes to taps that arrive while the app is running.
 *
 * The event itself is empty — it means "something is waiting", and the tap is
 * then taken with consumeNotificationTap. One home for the tap and one way to
 * take it, so however the orderings fall out it is handled exactly once.
 *
 * Returns an unsubscribe function, so a component that re-renders does not
 * accumulate listeners and navigate several times for one tap.
 */
export function onNotificationTap(fn: (tap: NotificationTap) => void): () => void {
  return subscribe('notificationTap', () => {
    void consumeNotificationTap().then(tap => { if (tap) fn(tap) })
  })
}

/**
 * A push that arrived while the app was on screen.
 *
 * The receiver only routes one here when this listener is attached, so
 * subscribing is what turns the suppression on — unsubscribe and pushes go back
 * to the notification tray, which is the right fallback rather than a gap.
 */
export function onPushMessage(fn: (message: PushMessage) => void): () => void {
  return subscribe('message', fn)
}

/**
 * addListener, made safe to use from an effect.
 *
 * The plugin's own subscribe is async, so a component that mounts and unmounts
 * quickly can ask to unsubscribe before it has a handle to unsubscribe with.
 * Without the cancelled flag that listener would leak, and a second mount would
 * see every event twice.
 */
function subscribe<E extends keyof PluginEvents>(event: E, fn: (e: PluginEvents[E]) => void): () => void {
  if (!isNative()) return () => {}
  let handle: PluginListenerHandle | undefined
  let cancelled = false
  void UnifiedPush.addListener(event, fn)
    .then(h => {
      handle = h
      if (cancelled) void h.remove()
    })
    .catch(() => {})
  return () => {
    cancelled = true
    void handle?.remove()
  }
}
