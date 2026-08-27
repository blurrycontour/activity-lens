/**
 * What a notification asked us to show, read from the URL.
 *
 * A social notification links to `/workouts/{id}?tab=social#comment={id}` —
 * the tab it happened in, and the exact thing that happened. Both live in the
 * URL rather than in the click handler so that every way of arriving works the
 * same: a tap while the app is open, a tap that cold-starts it, a reload, a
 * link someone pasted to themselves.
 *
 * The comment is in the fragment and the tab in the query, and that split is
 * deliberate. The tab is a request to the page ("open me here") and appears in
 * the link the API builds; the comment is an anchor within that page, which is
 * what a fragment is for.
 */
export interface DeepLink {
  /** The tab to open, or null when the link named none. */
  tab: string | null
  /** The comment to scroll to and flash, or null. */
  commentId: string | null
}

const NONE: DeepLink = { tab: null, commentId: null }

/**
 * Reads the deep link out of a URL, defaulting the tab when only a comment was
 * named — a comment is only ever on the Social tab, so a link that points at
 * one is a link to Social whether or not it says so.
 */
export function readDeepLink(href: string = window.location.href): DeepLink {
  let url: URL
  try {
    url = new URL(href, 'http://localhost')
  } catch {
    return NONE
  }
  const tab = url.searchParams.get('tab')
  // The fragment is parsed as a query string of its own: `#comment=abc`. Not
  // a bare `#abc`, so that a second kind of anchor can be added later without
  // having to guess what an existing fragment meant.
  const commentId = new URLSearchParams(url.hash.replace(/^#/, '')).get('comment')
  if (!tab && !commentId) return NONE
  return { tab: tab ?? (commentId ? 'social' : null), commentId }
}

/**
 * Strips the deep link from the address bar, leaving the page it landed on.
 *
 * Called once the link has been acted on, so that a reload — or a back and
 * forward — is the page you were looking at rather than the tab a notification
 * pointed at ten minutes ago.
 *
 * Keeps the current history state rather than replacing it with null: that
 * marker is how App tells an entry it pushed from a cold load of the same URL,
 * and losing it would send the back gesture out of the app.
 */
export function clearDeepLink() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('tab') && !url.hash) return
  url.searchParams.delete('tab')
  url.hash = ''
  window.history.replaceState(window.history.state, '', url.pathname + url.search)
}

/**
 * The deep link, but only when it is addressed to `subjectId`.
 *
 * Every page that consumes a deep link listens on the window, so when a
 * notification arrives for a *different* workout every mounted detail page
 * hears about it. The one that was already open would read the link, act on
 * it, and — worst of all — clear it, so the page the link was actually for
 * mounted a moment later to find an empty URL and stayed on the charts. That
 * is why tapping a notification while a different workout was open opened the
 * right workout and then did nothing.
 *
 * So a page asks for its own link and gets nothing when the URL names someone
 * else's. The id is matched against the last path segment, which is where all
 * three subjects keep it: /workouts/{id}, /discover/plan/{id},
 * /discover/session/{id}.
 */
export function deepLinkFor(subjectId: string, href: string = window.location.href): DeepLink {
  let url: URL
  try {
    url = new URL(href, 'http://localhost')
  } catch {
    return NONE
  }
  const last = url.pathname.split('/').filter(Boolean).pop()
  return last === subjectId ? readDeepLink(href) : NONE
}

/** The link a notification carries to one comment on a workout. */
export function commentLink(workoutId: string, commentId: string): string {
  return `/workouts/${workoutId}?tab=social#comment=${commentId}`
}
