import { api } from './api'
import { dismissOSNotification } from './push'

/**
 * Dispatched when something has changed a notification behind the bell's back —
 * a push that arrived, or one opened from outside the list — so the badge
 * updates immediately instead of on its next poll.
 *
 * Lives here rather than in the bell component because the things that fire it
 * are not the bell: the service worker, the Android receiver, and the banner.
 */
export const PUSH_EVENT = 'al:push'

/**
 * Acts on a notification the user opened from outside the app: a system
 * notification they tapped, or the in-app banner.
 *
 * Opening one is reading it. The bell's own list has always done this; every
 * other entry point did not, so a notification tapped in the tray stayed bold in
 * the app and kept its place in the unread count — the user had to dismiss the
 * same thing twice.
 *
 * All three steps are the same three the bell performs, in the same order, and
 * none of them is allowed to fail the navigation that follows: the user asked to
 * go somewhere, and a failed bookkeeping call is not a reason to refuse.
 */
/**
 * Query parameter the service worker adds when it has to open a new window for
 * a tapped notification, because there was none to message.
 */
const OPENED_PARAM = 'n'

/**
 * Claims the notification id from a cold start, and takes it out of the URL.
 *
 * Removed rather than left, for the same reason consumeShareParam does it: it is
 * a one-shot handoff, and a reload should not re-run it or leave the parameter
 * sitting in a URL the user might bookmark.
 */
export function consumeOpenedParam(): string | null {
  const url = new URL(window.location.href)
  const id = url.searchParams.get(OPENED_PARAM)
  if (id === null) return null
  url.searchParams.delete(OPENED_PARAM)
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return id
}

export async function markNotificationOpened(id?: string | null): Promise<void> {
  if (!id) return
  await api.markNotificationRead(id).catch(() => {})
  // Reading it here should clear it from the OS tray too — on Android the
  // banner it came from is still sitting there.
  void dismissOSNotification(id)
  window.dispatchEvent(new Event(PUSH_EVENT))
}
