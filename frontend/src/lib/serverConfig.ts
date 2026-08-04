// Where the API is, and how this client proves who it is.
//
// The web app and the Android app answer both questions differently, and this
// module is the only place that difference exists. Everything else — api.ts,
// the auth context, every page — asks here and stays identical on both.
//
//   web     same-origin. No base URL, no token: the session is an httpOnly
//           cookie the browser attaches on its own, which is the safest place
//           for it because script cannot read it.
//   native  a WebView on its own origin (https://localhost) talking to whatever
//           server the user configured. Cookies cannot work across that
//           boundary, so it holds a session token and sends it as a bearer.
//
// Nothing here is inferred from the URL or sniffed from the user agent.
// Capacitor.isNativePlatform() is the platform's own answer, and on web it is a
// compile-time-constant false that lets the rest tree-shake away.

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { clearApiCache } from './swCache'

const SERVER_URL_KEY = 'al_server_url'
const TOKEN_KEY = 'al_auth_token'

/** True in the Android app, false in any browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

// Cached after the first read so the hot path — every API call asking for the
// base URL and token — is synchronous and never touches storage. Capacitor's
// Preferences API is async, so without this every request would await twice.
let baseURL = ''
let token: string | null = null
let loaded = false

/**
 * Loads the stored server URL and token. Call once at startup, before anything
 * makes a request; on web it resolves immediately with nothing to load.
 */
export async function loadServerConfig(): Promise<void> {
  if (loaded) return
  loaded = true
  if (!isNative()) return
  try {
    const [url, tok] = await Promise.all([
      Preferences.get({ key: SERVER_URL_KEY }),
      Preferences.get({ key: TOKEN_KEY }),
    ])
    baseURL = url.value ?? ''
    token = tok.value ?? null
  } catch {
    // Unreadable storage means the app starts at the setup screen rather than
    // failing to start at all.
    baseURL = ''
    token = null
  }
}

/**
 * Prefix for API paths: "" on web (same-origin), the configured server on
 * native. Never ends in a slash, so `apiBase() + '/api/x'` is always right.
 */
export function apiBase(): string {
  return baseURL
}

/** The bearer token, or null when there is none (always null on web). */
export function authToken(): string | null {
  return token
}

/**
 * Whether the app still needs a server URL before it can do anything.
 * Always false on web, where the API is wherever the page came from.
 */
export function needsServerConfig(): boolean {
  return isNative() && baseURL === ''
}

/**
 * Normalizes what someone typed into a usable origin.
 *
 * People paste "example.com", "https://example.com/", and occasionally
 * "https://example.com/api". The first is unusable without a scheme, the second
 * would produce a double slash, and the third would send every request to
 * /api/api/... — so all three are corrected here rather than becoming a
 * confusing connection failure later.
 */
export function normalizeServerURL(input: string): string {
  let raw = input.trim()
  if (raw === '') return ''
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  // Keep any path prefix (some deployments live under a sub-path) but drop a
  // trailing slash and a trailing /api, which is ours to add.
  let path = url.pathname.replace(/\/+$/, '')
  if (path.toLowerCase().endsWith('/api')) path = path.slice(0, -4)
  return `${url.protocol}//${url.host}${path}`
}

/**
 * Whether a URL reaches its server without encryption.
 *
 * Loopback is excluded because the traffic never touches a network there, which
 * is why browsers treat http://localhost as a secure context too.
 *
 * This is not a check that can be softened by anything the client does. Over
 * plain HTTP the password is readable on the wire, and so is the session token
 * that comes back, and every request that token then authenticates. Hashing the
 * password in the browser would not change that: the hash becomes the
 * credential and is replayed just as easily, and the session is exposed
 * regardless. There is no client-side fix — only TLS.
 */
export function isInsecureURL(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:') return false
    return !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Whether this session's traffic is unencrypted, whichever platform it is on.
 *
 * The app knows its server URL; the web app is served from the origin it talks
 * to, so the page's own protocol is the answer there.
 */
export function isInsecureConnection(): boolean {
  if (isNative()) return baseURL !== '' && isInsecureURL(baseURL)
  return window.location.protocol === 'http:' && !window.isSecureContext
}

/** Stores the server URL after a successful reachability check. */
export async function setServerURL(url: string): Promise<void> {
  baseURL = url
  await Preferences.set({ key: SERVER_URL_KEY, value: url })
}

/** Stores or clears the bearer token. */
export async function setAuthToken(value: string | null): Promise<void> {
  token = value
  if (value === null) await Preferences.remove({ key: TOKEN_KEY })
  else await Preferences.set({ key: TOKEN_KEY, value })
}

/**
 * Notified when the app stops being pointed at a server, so the UI can return
 * to the setup screen.
 *
 * An event rather than a page reload. Reloading a Capacitor WebView is a bigger
 * hammer than it looks: it re-runs the whole boot, briefly leaves the WebView
 * blank with the window background showing through, and reloads whatever path
 * the SPA happens to have pushed rather than the app root. Re-rendering from
 * React is a single state change with none of that.
 */
type ForgetListener = () => void
const forgetListeners = new Set<ForgetListener>()

/** Subscribes to "the server was forgotten". Returns an unsubscribe function. */
export function onServerForgotten(fn: ForgetListener): () => void {
  forgetListeners.add(fn)
  return () => forgetListeners.delete(fn)
}

/**
 * Forgets the server, for "sign in to a different server".
 *
 * Clears the token first: a URL with no token strands the app at the login
 * screen, which is recoverable, while a token with no URL is a credential for
 * a server nothing can name.
 */
export async function forgetServer(): Promise<void> {
  await setAuthToken(null)
  baseURL = ''
  await Preferences.remove({ key: SERVER_URL_KEY })
  // Cached responses are keyed by absolute URL, so another server's entries
  // would never be read — but they are still one account's data sitting on the
  // device after it was disconnected, which is reason enough to drop them.
  await clearApiCache()
  forgetListeners.forEach(fn => fn())
}

/**
 * Checks that a URL is an Activity Lens server before it is saved.
 *
 * /api/auth/config is public and cheap, and its shape is distinctive enough
 * that a wrong-but-reachable host (a router page, someone else's site) fails
 * here rather than after the user has typed a password into it.
 */
export async function probeServer(url: string, timeoutMs = 8000): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}/api/auth/config`, { signal: controller.signal })
    if (!res.ok) return { ok: false, error: `Server answered ${res.status}` }
    const body = await res.json()
    if (typeof body?.allowRegistration !== 'boolean') {
      return { ok: false, error: 'That address answered, but it is not an Activity Lens server' }
    }
    return { ok: true }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Timed out. Check the address and that the server is reachable.' }
    }
    return { ok: false, error: 'Could not reach that address' }
  } finally {
    clearTimeout(timer)
  }
}
