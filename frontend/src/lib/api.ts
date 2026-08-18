// Typed client for the Activity Lens backend API. Handles JSON, CSRF tokens
// (double-submit cookie echoed in a header), and error normalization.

import { reportReachability, respondedFromBackend } from './network'
import { fetchWithCache } from './nativeCache'
import { apiBase, authToken, isNative } from './serverConfig'
// Training-plan shapes live with the other domain types in data/, beside the
// helpers that read them, rather than being declared here like the older ones.
import type { PlanDay, PlanSession, SessionProgress, TrainingPlan } from '../data/plans'

/** What kind of report this is — mirrors feedback.AllCategories on the server. */
export type FeedbackCategory = 'bug' | 'idea' | 'other'

export interface Feedback {
  id: string
  username: string
  category: FeedbackCategory
  message: string
  /** Only present on the single-report fetch; listings omit the blob. */
  diagnostics?: string
  hasDiagnostics: boolean
  resolvedAt?: string
  createdAt: string
}

export interface ApiUser {
  id: number
  username: string
  email: string
  displayName: string
  avatarPath: string
  isAdmin: boolean
  isActive: boolean
  role: string
  hasPassword: boolean
}

/**
 * What build the server is running. Populated from the OCI image labels at
 * Docker build time; the optional fields are absent on a local `go build`.
 */
export interface BuildInfo {
  version: string
  /** Full commit SHA the image was built from. */
  revision?: string
  /** Image build timestamp, RFC 3339. */
  created?: string
  licenses?: string
  /** Repository URL. */
  source?: string
  goVersion: string
  platform: string
}

/** What happened, driving the icon the notification panel renders. */
export type NotificationKind = 'broadcast' | 'app_update' | 'workout_shared' | 'workout_social' | 'ping' | 'gear_worn' | 'goal_met' | 'goal_at_risk' | 'goal_none_set' | 'workout_imported' | 'feedback'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body?: string
  /** In-app path to open when tapped, e.g. "/workouts/abc123". */
  link?: string
  /** Avatar of whoever caused this; absent for system-generated events. */
  icon?: string
  readAt?: string
  createdAt: string
}

export interface NotificationsResponse {
  notifications: AppNotification[]
  unread: number
  /** VAPID public key; absent when the server has push disabled. */
  pushKey?: string
}

/** Per-kind notification switches, plus the master push toggle. */
export interface NotifyPrefs {
  kinds: Partial<Record<NotificationKind, boolean>>
  push: boolean
}

/**
 * The Android app this server carries, if any.
 *
 * The APK is built from the same commit as the server and bundled into its
 * image, so the version is whatever was built alongside it — never the newest
 * release that exists elsewhere. A client therefore cannot run ahead of the
 * instance it talks to, and nothing outside the server is needed to install it.
 */
export interface AndroidApp {
  available: boolean
  version?: string
  /** Bytes, so a download can show a total before it starts. */
  size?: number
  /** Checksum of the APK, for verifying what was installed. */
  sha256?: string
  /**
   * The Android application this APK installs as. Absent from servers whose
   * bundled metadata predates the field; see canInstallOver.
   */
  applicationId?: string
  /** Path on this server that serves the APK. */
  downloadPath?: string
}

export interface AuthFeatures {
  allowRegistration: boolean
  oidcEnabled: boolean
  oidcProviderName: string
  oidcLogoUrl: string
  /** Optional dark-theme replacement for oidcLogoUrl; empty means use it in both. */
  oidcLogoUrlDark: string
}

/**
 * A signed-in device.
 *
 * Everything but `userAgent` is derived or client-reported and may be absent:
 * a user agent can be anything, and a session predating the client header has
 * nothing to report. The UI shows what is there and falls back to the raw
 * agent, rather than filling gaps with "Unknown".
 */
export interface SessionInfo {
  id: string
  userAgent: string
  ip: string
  createdAt: string
  expiresAt: string
  current: boolean
  /** Read off the user agent, e.g. "Chrome 141". */
  browser?: string
  /** Read off the user agent, e.g. "Android", "Windows". */
  platform?: string
  mobile?: boolean
  /** What the client called itself. Absent for sessions predating the header. */
  kind?: 'web' | 'android'
  appVersion?: string
  /** Most recent request on this session, to within a few minutes. */
  lastSeen?: string
}

export interface SmtpSettings {
  host: string
  port: number
  username: string
  passwordSet: boolean
  from: string
  fromName: string
  encryption: string
  overridden: Record<string, boolean>
}

export interface OidcSettings {
  enabled: boolean
  issuerUrl: string
  clientId: string
  clientSecretSet: boolean
  redirectUrl: string
  adminGroup: string
  providerName: string
  logoUrl: string
  logoUrlDark: string
  allowRegistration: boolean
  scopes: string[]
  overridden: Record<string, boolean>
}

export interface AdminSettings {
  smtp: SmtpSettings
  oidc: OidcSettings
  storage: StorageSettings
  social: SocialSettings
}

/** Instance-wide rules for what members may do to each other. */
export interface SocialSettings {
  /** How long one member must wait before pinging the same member again. */
  pingCooldownSeconds: number
}

export interface StorageSettings {
  keepOriginalUploads: boolean
}

export interface UserPreferences {
  calorieMethod: 'heart-rate' | 'distance'
  bodyWeightKg: number
  sex: 'male' | 'female' | ''
  birthYear: number
  heightCm: number
  maxHr: number
  restingHr: number
  thresholdPace: string
  ftp: number
  stepLengthCm: number
  /** Training goals tracked on the dashboard; empty means none set. */
  goals: ApiGoal[]
  /** Notification switches; absent until the user saves them once. */
  notify?: NotifyPrefs
  /**
   * A line the user writes about themselves, shown on their profile.
   *
   * The one preference other people read. The server trims it to 140 runes and
   * strips control characters, so what comes back may be shorter than what was
   * sent.
   */
  tagline?: string
  /**
   * Whether newly imported workouts get their historical conditions looked up.
   *
   * On by default, because it only ever covers workouts imported from now on —
   * nothing already in the library is sent anywhere without the separate,
   * explicit backfill below.
   */
  weatherEnabled?: boolean
  /**
   * Record a finished training session as a manual strength workout.
   *
   * Off by default: everything else in the library was measured by a device,
   * and folding hand-entered gym work into the same totals is a decision about
   * what those totals mean.
   */
  planWorkouts?: boolean
}

export interface ApiGoal {
  id: string
  /** What the goal measures: activity count, total km, or total hours. */
  metric: 'count' | 'distance' | 'duration'
  /** The number to reach, in the metric's unit. */
  target: number
  period: 'week' | 'month'
  /** How many periods one window covers; 1 for a plain week or month. */
  span: number
  /** Activity type the goal applies to, or '' for any. */
  type: string
  /** Per-activity qualifiers; an activity below either does not count at all. */
  minKm: number
  minMinutes: number
}

export interface SmtpInput {
  host: string
  port: number
  username: string
  password: string
  from: string
  fromName: string
  encryption: string
}

export interface OidcInput {
  enabled: boolean
  issuerUrl: string
  clientId: string
  clientSecret: string
  redirectUrl: string
  adminGroup: string
  providerName: string
  logoUrl: string
  logoUrlDark: string
  allowRegistration: boolean
  scopes: string[]
}

/** A person as everyone (not just admins) may see them. */
export interface DirectoryUser {
  id: number
  username: string
  displayName: string
  avatarPath: string
  /** The caller's own entry. */
  self?: boolean
  /** What they wrote about themselves; absent when they wrote none. */
  tagline?: string
}

/** Another member, and the workouts you and they can see of each other's. */
export interface UserProfileData {
  user: { id: number; username: string; displayName: string; avatarPath: string }
  tagline?: string
  /** True when this is your own profile, which carries only the public half. */
  self?: boolean
  /** Theirs, sent to you directly. */
  sharedWithMe: import('../data/workouts').Workout[]
  /** Theirs, open to everyone signed in here. */
  publicWorkouts: import('../data/workouts').Workout[]
  /** Yours, sent to them. Empty on your own profile. */
  sharedWithThem: import('../data/workouts').Workout[]
  /**
   * The same three relationships for training plans and finished sessions.
   * Optional so a server that predates plan sharing simply shows none rather
   * than breaking the page. Both "with me" lists are empty on your own
   * profile, for the same reason sharedWithMe is.
   */
  sharedPlansWithMe?: TrainingPlan[]
  publicPlans?: TrainingPlan[]
  plansSharedWithThem?: TrainingPlan[]
  sharedSessionsWithMe?: PlanSession[]
  publicSessions?: PlanSession[]
  sessionsSharedWithThem?: PlanSession[]
  /**
   * What the nudge row needs to draw itself. Absent on your own profile, and
   * from servers that predate pings — both mean "do not offer it".
   */
  ping?: PingInfo
}

/** The nudges this server offers, and where this pair stands with them. */
export interface PingInfo {
  /** Every message, in the order to lay them out. Ids come from the server. */
  messages: { id: string; text: string }[]
  cooldownSeconds: number
  /** Seconds left before the next ping to this person; 0 means ready. */
  waitSeconds: number
}

/** What one account has accumulated on this instance. */
export interface UserStats {
  workouts: number
  equipment: number
  photos: number
  /** Gallery photos on disk. */
  photoBytes: number
  /** Archived original uploads on disk; zero unless an admin kept them. */
  originalBytes: number
  firstWorkout?: string
  lastWorkout?: string
}

export interface AdminUser {
  id: number
  username: string
  email: string
  displayName: string
  avatarPath: string
  isAdmin: boolean
  isActive: boolean
  role: string
  hasPassword: boolean
  lastLoginAt: string
  /** How many devices this account is signed in on. */
  sessions?: number
  /** Absent when the totals could not be computed — not the same as zero. */
  stats?: UserStats
}

/** Everything the admin screen shows about one account. */
export interface AdminUserDetail {
  user: AdminUser
  stats: UserStats
  sessions: SessionInfo[]
}

const CSRF_COOKIE = 'authkit_csrf'
const CSRF_HEADER = 'X-CSRF-Token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Resolves an API path against the configured server.
 *
 * On web apiBase() is empty and this returns the path unchanged, so requests
 * stay same-origin exactly as before. On native it points at whatever server
 * the user configured at first run.
 */
export function apiURL(path: string): string {
  return apiBase() + path
}

/** Bearer header for the native app; nothing on web, where the cookie rules. */
function authHeaders(): Record<string, string> {
  const token = authToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * How this client names itself to the server, as "<kind>/<version>".
 *
 * The server cannot work either half out on its own. The Android app is a
 * WebView, so its user agent is a Chrome agent — the same one a browser on that
 * phone sends, give or take a "wv" — and no user agent anywhere carries the
 * version of this app. Both facts matter on a screen whose job is deciding
 * whether a signed-in device is still you, so the client is the one that says.
 *
 * Computed once: neither half can change without a reload.
 */
const CLIENT_HEADER = 'X-Activity-Lens-Client'
const clientTag = `${isNative() ? 'android' : 'web'}/${__APP_VERSION__}`

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

interface RequestOptions {
  method?: string
  body?: unknown
  raw?: BodyInit
  headers?: Record<string, string>
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { ...opts.headers, ...authHeaders(), [CLIENT_HEADER]: clientTag }

  // CSRF is a cookie-client concern. A bearer token is never attached by the
  // browser on its own, so there is nothing to double-submit and the server
  // does not ask for one.
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (unsafe && !authToken()) {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) headers[CSRF_HEADER] = csrf
  }

  let body: BodyInit | undefined
  if (opts.raw !== undefined) {
    body = opts.raw
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    // Reads in the app go through the offline cache, which is what the service
    // worker does for the same requests on web. Writes never do: there is
    // nothing to serve from cache for one, and a queued mutation is a different
    // feature with different rules.
    const url = apiURL(path)
    const init: RequestInit = { method, headers, body, credentials: 'same-origin' }
    res = isNative() && method === 'GET'
      ? await fetchWithCache(url, init)
      : await fetch(url, init)
  } catch (err) {
    // fetch only rejects on a transport failure, which is the clearest possible
    // signal that the backend is unreachable.
    reportReachability(false)
    throw err
  }
  // A resolved fetch is not by itself proof of connectivity: the service worker
  // answers from cache when the network is down, and a reverse proxy answers
  // with a gateway error when the backend is down. Only a response that came
  // from the app itself counts.
  reportReachability(respondedFromBackend(res))

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    const message = (data && (data.error as string)) || res.statusText || 'request failed'
    throw new ApiError(res.status, message)
  }
  return data as T
}

/** One photo in a workout's gallery. The bytes are fetched separately. */
export interface WorkoutPhoto {
  id: string
  kind: string
  filename?: string
  mime: string
  width: number
  height: number
  bytes: number
  caption?: string
  position: number
  createdAt: string
}

/** One message on a shared workout. */
export interface WorkoutComment {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  author?: UserRef
}

/** One person's single emoji on a shared workout. */
export interface WorkoutReaction {
  emoji: string
  createdAt: string
  author?: UserRef
}

/**
 * The whole Social tab in one response.
 *
 * `shared` is what separates "nobody has said anything" from "this workout is
 * private" — the lists are empty either way, and those need different words on
 * screen. `emojis` comes from the server so the picker and the values it may
 * store are one vocabulary that cannot drift.
 */
export interface WorkoutSocial {
  shared: boolean
  reactions: WorkoutReaction[]
  comments: WorkoutComment[]
  emojis: string[]
  myReaction?: string
}

/** A file downloaded from the API, with the name the server offered it under. */
export interface DownloadedFile {
  blob: Blob
  filename: string
}

/**
 * Fetches a binary response as a blob, mirroring `request`'s error and
 * reachability handling but without assuming JSON.
 *
 * Error bodies are still JSON, so a failure is read the same way as anywhere
 * else and surfaces as an ApiError the caller can show.
 */
async function fetchFile(path: string): Promise<DownloadedFile> {
  let res: Response
  try {
    res = await fetch(apiURL(path), { credentials: 'same-origin', headers: authHeaders() })
  } catch (err) {
    reportReachability(false)
    throw err
  }
  reportReachability(respondedFromBackend(res))

  if (!res.ok) {
    let message = res.statusText || 'request failed'
    try {
      const data = JSON.parse(await res.text())
      if (data?.error) message = data.error as string
    } catch {
      // A non-JSON error body (a proxy's HTML page) leaves the status text.
    }
    throw new ApiError(res.status, message)
  }
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get('Content-Disposition')),
  }
}

/**
 * Reads the download filename out of a Content-Disposition header.
 *
 * Exported for tests: the two header forms and their precedence are easy to get
 * subtly wrong, and getting it wrong means files land under the wrong name.
 *
 * The RFC 5987 `filename*` form is preferred because it is the one that carries
 * non-ASCII names; the quoted `filename` is an ASCII-only fallback the server
 * sends alongside it. Returns "" when neither is usable, which callers replace
 * with a name of their own.
 */
export function filenameFromDisposition(header: string | null): string {
  if (!header) return ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      // Malformed percent-encoding: fall through to the quoted form.
    }
  }
  return /filename="([^"]*)"/i.exec(header)?.[1] ?? ''
}

/** One workout as the overview map draws it: a simplified route and a label. */
export interface Track {
  id: string
  name: string
  type: import('../data/workouts').WorkoutType
  date: string
  /** [lat, lon], simplified server-side to about 80 points. */
  points: Array<[number, number]>
  meters: number
}

export const api = {
  // --- Auth ---
  authConfig: () => request<AuthFeatures>('/api/auth/config'),
  me: () => request<{ user: ApiUser; csrfToken: string }>('/api/auth/me'),
  buildInfo: () => request<BuildInfo>('/api/build'),

  /**
   * The Android build that goes with this server. Public, because the download
   * button is on the login page and the app checks for updates before anyone
   * signs in.
   */
  androidApp: () => request<AndroidApp>('/api/app/android'),

  // --- Notifications ---
  notifications: () => request<NotificationsResponse>('/api/notifications'),
  markNotificationRead: (id: string) =>
    request<unknown>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    request<unknown>('/api/notifications/read-all', { method: 'POST' }),
  deleteNotification: (id: string) =>
    request<unknown>(`/api/notifications/${id}`, { method: 'DELETE' }),
  clearNotifications: () => request<unknown>('/api/notifications', { method: 'DELETE' }),
  pushSubscribe: (sub: PushSubscriptionJSON) =>
    request<unknown>('/api/push/subscribe', { method: 'POST', body: sub }),
  /**
   * Registers an endpoint issued by a UnifiedPush distributor, for the Android
   * app. A separate route from pushSubscribe because it carries no encryption
   * keys — the distributor is the user's own server, not a browser vendor's.
   */
  pushSubscribeUnifiedPush: (endpoint: string) =>
    request<unknown>('/api/push/unifiedpush', { method: 'POST', body: { endpoint } }),
  pushUnsubscribe: (endpoint: string) =>
    request<unknown>('/api/push/unsubscribe', { method: 'POST', body: { endpoint } }),

  sendFeedback: (body: { category: FeedbackCategory; message: string; diagnostics?: string }) =>
    request<{ feedback: Feedback }>('/api/feedback', { method: 'POST', body }),
  adminFeedback: () => request<{ feedback: Feedback[] }>('/api/admin/feedback'),
  adminFeedbackDetail: (id: string) => request<{ feedback: Feedback }>(`/api/admin/feedback/${id}`),
  adminResolveFeedback: (id: string, resolved: boolean) =>
    request<unknown>(`/api/admin/feedback/${id}`, { method: 'PATCH', body: { resolved } }),
  adminDeleteFeedback: (id: string) =>
    request<unknown>(`/api/admin/feedback/${id}`, { method: 'DELETE' }),
  login: (identifier: string, password: string) =>
    request<{ user: ApiUser; csrfToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
    }),
  register: (payload: { username: string; email: string; displayName: string; password: string }) =>
    request<{ user: ApiUser; csrfToken: string }>('/api/auth/register', { method: 'POST', body: payload }),
  // Same sign-in, but the token comes back in the body instead of a cookie.
  // Used only by the native app, which has no usable cookie jar; the web keeps
  // login() above so its session token stays httpOnly and out of reach of
  // script.
  tokenLogin: (identifier: string, password: string) =>
    request<{ token: string; expiresAt: string; user: ApiUser }>('/api/auth/token', {
      method: 'POST',
      body: { identifier, password },
    }),
  // Redeems the one-time code an SSO deep link brought back. The verifier is
  // what proves this app started that flow; see lib/native/nativeAuth.ts.
  ssoExchange: (code: string, verifier: string) =>
    request<{ token: string; expiresAt: string; user: ApiUser }>('/api/auth/oidc/exchange', {
      method: 'POST',
      body: { code, verifier },
    }),
  logout: () => request<unknown>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (displayName: string, email: string) =>
    request<{ user: ApiUser }>('/api/auth/profile', { method: 'PATCH', body: { displayName, email } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<unknown>('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),
  deleteAvatar: () => request<{ user: ApiUser }>('/api/auth/avatar', { method: 'DELETE' }),
  uploadAvatar: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ user: ApiUser }>('/api/auth/avatar', { method: 'POST', raw: form })
  },
  listSessions: () => request<{ sessions: SessionInfo[] }>('/api/auth/sessions'),
  revokeOtherSessions: () =>
    request<{ revoked: number }>('/api/auth/sessions/revoke-others', { method: 'POST' }),
  revokeSession: (id: string) =>
    request<unknown>(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  requestAccountDeletion: () =>
    request<{ status: string; email: string }>('/api/auth/account/deletion/request', { method: 'POST' }),
  confirmAccountDeletion: (code: string) =>
    request<{ status: string }>('/api/auth/account/deletion', { method: 'POST', body: { code } }),

  // --- Weather ---
  // Conditions a person typed in. These outrank anything fetched and are never
  // overwritten by a later lookup.
  setWorkoutWeather: (id: string, payload: import('../data/workouts').Weather) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}/weather`, { method: 'PUT', body: payload }),
  // Undoes a manual entry, putting the workout back in the lookup queue.
  clearWorkoutWeather: (id: string) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}/weather`, { method: 'DELETE' }),
  // How many workouts have never been checked — everything that predates the
  // feature, until the user asks.
  workoutTracks: (opts: { from?: string; to?: string; bbox?: [number, number, number, number] } = {}) => {
    const q = new URLSearchParams()
    if (opts.from) q.set('from', opts.from)
    if (opts.to) q.set('to', opts.to)
    // Rounded: a map emits bounds to fifteen decimal places, and a pan of half
    // a metre should hit the same cache entry rather than a new URL.
    if (opts.bbox) q.set('bbox', opts.bbox.map(n => n.toFixed(4)).join(','))
    const qs = q.toString()
    return request<{ tracks: Track[]; capped: boolean; preparing: number }>(
      `/api/workouts/tracks${qs ? `?${qs}` : ''}`,
    )
  },
  weatherStatus: () => request<import('../data/workouts').WeatherCounts>('/api/workouts/weather/status'),
  requestWeatherBackfill: () =>
    request<{ queued: number }>('/api/workouts/weather/backfill', { method: 'POST' }),
  retryFailedWeather: () =>
    request<{ queued: number }>('/api/workouts/weather/retry', { method: 'POST' }),

  // --- User preferences ---
  getPreferences: () => request<UserPreferences>('/api/preferences'),
  savePreferences: (payload: UserPreferences) =>
    request<UserPreferences>('/api/preferences', { method: 'PUT', body: payload }),

  // --- Admin ---
  getAdminSettings: () => request<AdminSettings>('/api/admin/settings'),
  saveSMTP: (payload: SmtpInput) =>
    request<AdminSettings>('/api/admin/settings/smtp', { method: 'PUT', body: payload }),
  saveOIDC: (payload: OidcInput) =>
    request<AdminSettings>('/api/admin/settings/oidc', { method: 'PUT', body: payload }),
  saveStorage: (payload: StorageSettings) =>
    request<AdminSettings>('/api/admin/settings/storage', { method: 'PUT', body: payload }),
  saveSocial: (payload: SocialSettings) =>
    request<AdminSettings>('/api/admin/settings/social', { method: 'PUT', body: payload }),
  testEmail: (to: string) =>
    request<{ status: string; to: string }>('/api/admin/settings/smtp/test', { method: 'POST', body: { to } }),
  /**
   * Another member, and the workouts of theirs you can see.
   *
   * The list is the intersection of what they have shared with you and what
   * they have made public — the server builds it from the two feeds rather
   * than by owner, so this can never surface a workout that was not already
   * yours to read.
   */
  getUserProfile: (id: number) => request<UserProfileData>(`/api/users/${id}`),
  /**
   * Nudges another member. `message` is one of the ids the profile handed out —
   * the text itself belongs to the server, so nothing typed here reaches
   * anyone's lock screen. Rejected with 429 while the cooldown is running.
   */
  pingUser: (id: number, message: string) =>
    request<{ sent: boolean; cooldownSeconds: number }>(`/api/users/${id}/ping`, { method: 'POST', body: { message } }),
  listAdminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
  getAdminUser: (id: number) => request<AdminUserDetail>(`/api/admin/users/${id}`),
  revokeUserSession: (id: number, sessionId: string) =>
    request<unknown>(`/api/admin/users/${id}/sessions/${sessionId}`, { method: 'DELETE' }),
  /** Signs a user out everywhere but the caller's own current device. */
  revokeUserSessions: (id: number) =>
    request<{ revoked: number }>(`/api/admin/users/${id}/sessions`, { method: 'DELETE' }),
  /** Sends one message to every active account but the sender's. */
  broadcast: (payload: { title: string; body: string; includeInactive?: boolean }) =>
    request<{ sent: number }>('/api/admin/broadcast', { method: 'POST', body: payload }),
  createUser: (payload: { username: string; email: string; displayName: string; password: string; role: string }) =>
    request<{ user: ApiUser }>('/api/admin/users', { method: 'POST', body: payload }),
  updateUser: (id: number, payload: { role: string; isActive: boolean }) =>
    request<{ user: ApiUser }>(`/api/admin/users/${id}`, { method: 'PATCH', body: payload }),
  deleteUser: (id: number) =>
    request<{ status: string }>(`/api/admin/users/${id}`, { method: 'DELETE' }),

  // --- Workouts ---
  listWorkouts: () => request<import('../data/workouts').Workout[]>('/api/workouts'),
  // Resolves any workout the signed-in user may read: their own, a public one,
  // or one shared with them. `isOwner` says whether to offer edit controls.
  getWorkout: (id: string) => request<import('../data/workouts').Workout>(`/api/workouts/${id}`),
  // The archived source file, when the server kept it. Not `request`: that
  // parses every response as JSON, and this one is the original bytes.
  getWorkoutOriginal: (id: string) => fetchFile(`/api/workouts/${id}/original`),
  createWorkout: (payload: ManualWorkoutInput) =>
    request<import('../data/workouts').Workout>('/api/workouts', { method: 'POST', body: payload }),
  patchWorkout: (id: string, patch: { name?: string; type?: string; notes?: string; date?: string; calories?: number; steps?: number; distance?: number; equipmentIds?: string[] }) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}`, { method: 'PATCH', body: patch }),
  /**
   * Re-derives the named values. Everything named is overwritten, including
   * anything entered by hand, which is why the caller has to name them.
   */
  /**
   * Trims a workout to a window and drops the series named, then re-derives
   * everything that depended on them. Destructive to the stored workout; the
   * archived original, when there is one, is what restoreWorkout reads back.
   */
  reshapeWorkout: (id: string, plan: { start: number; end: number; drop: string[] }) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}/reshape`, {
      method: 'POST',
      body: plan,
    }),

  /** Rebuilds a workout's recorded data from the file it was imported from. */
  restoreWorkout: (id: string) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}/restore`, { method: 'POST' }),

  recalcWorkout: (id: string, parts: import('../data/workouts').RecalcParts) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}/recalculate`, {
      method: 'POST',
      // The object, not a string: request() serialises `body` itself, and
      // stringifying here sent a JSON string containing JSON, which the server
      // rejected as an invalid body.
      body: parts,
    }),
  deleteWorkout: (id: string) => request<unknown>(`/api/workouts/${id}`, { method: 'DELETE' }),

  // --- Gallery ---
  //
  // Listing is metadata only; the bytes come one request at a time through
  // workoutPhoto, so the browser can cache, lazy-load and decode each on its
  // own schedule. A dozen base64 photos inside the list would undo all three.
  workoutPhotos: (id: string) =>
    request<{ media: WorkoutPhoto[]; max: number }>(`/api/workouts/${id}/media`),
  /**
   * One photo's bytes.
   *
   * Fetched rather than pointed at with an <img src>, because these are behind
   * authentication and the native app authenticates with a bearer token that an
   * <img> would not send. The response still goes through the HTTP cache, so a
   * second view is a 304 rather than a download.
   */
  workoutPhoto: (id: string, mediaID: string, thumb: boolean) =>
    fetchFile(`/api/workouts/${id}/media/${mediaID}${thumb ? '?thumb=1' : ''}`),
  uploadWorkoutPhoto: (id: string, file: File | Blob, filename: string) => {
    const form = new FormData()
    form.append('file', file, filename)
    return request<WorkoutPhoto>(`/api/workouts/${id}/media`, { method: 'POST', raw: form })
  },
  deleteWorkoutPhoto: (id: string, mediaID: string) =>
    request<unknown>(`/api/workouts/${id}/media/${mediaID}`, { method: 'DELETE' }),
  // Reactions and comments together: the tab is useless with half of them, so
  // two requests would only add a state where the page is half drawn.
  workoutSocial: (id: string) => request<WorkoutSocial>(`/api/workouts/${id}/social`),
  addComment: (id: string, body: string) =>
    request<WorkoutComment>(`/api/workouts/${id}/comments`, { method: 'POST', body: { body } }),
  editComment: (id: string, commentID: string, body: string) =>
    request<WorkoutComment>(`/api/workouts/${id}/comments/${commentID}`, { method: 'PATCH', body: { body } }),
  deleteComment: (id: string, commentID: string) =>
    request<unknown>(`/api/workouts/${id}/comments/${commentID}`, { method: 'DELETE' }),
  /**
   * Sets the caller's one reaction, or clears it with an empty emoji — tapping
   * the one you already chose is the same request as picking a new one.
   *
   * Answers with the whole tab, because both the counts and who-reacted change
   * and merging that on the client would be a second copy of the same rules.
   */
  setWorkoutReaction: (id: string, emoji: string) =>
    request<WorkoutSocial>(`/api/workouts/${id}/reaction`, { method: 'PUT', body: { emoji } }),
  // `deferChecks` suppresses the post-import gear and goal evaluation, which
  // re-reads the whole library each time. A batch sets it on every file and
  // calls finalizeImport() once at the end.
  importWorkout: (file: File, type?: string, name?: string, equipmentIds?: string[], deferChecks?: boolean) => {
    const form = new FormData()
    form.append('file', file)
    if (type) form.append('type', type)
    if (name) form.append('name', name)
    if (equipmentIds) equipmentIds.forEach(id => form.append('equipmentIds', id))
    if (deferChecks) form.append('deferChecks', '1')
    // `duplicate` marks a file the server had already imported; the workout in
    // the response is the existing one, left untouched.
    return request<ImportedWorkout>('/api/workouts/import', { method: 'POST', raw: form })
  },
  previewWorkout: (file: File, type?: string, name?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (type) form.append('type', type)
    if (name) form.append('name', name)
    return request<ImportedWorkout>('/api/workouts/preview', { method: 'POST', raw: form })
  },
  /** Runs the gear/goal checks a batch import deferred. Safe to call twice. */
  finalizeImport: () => request<unknown>('/api/workouts/import/finalize', { method: 'POST' }),
  /**
   * Asks which of these file hashes are already imported, so a batch can skip
   * uploading them. One request for a whole batch — the reason re-importing an
   * archive, or re-scanning a folder, is cheap. Max 500 hashes per call.
   */
  knownImports: (hashes: string[]) =>
    request<{ known: string[] }>('/api/workouts/import/known', { method: 'POST', body: { hashes } }),
  stats: () => request<Stats>('/api/stats'),

  // --- Sharing ---
  // "Public" means every signed-in user of this instance; nothing here is
  // readable without an account.
  feedPublic: () => request<import('../data/workouts').Workout[]>('/api/feed/public'),
  feedShared: () => request<import('../data/workouts').Workout[]>('/api/feed/shared'),
  feedPlansPublic: () => request<TrainingPlan[]>('/api/feed/plans/public'),
  feedPlansShared: () => request<TrainingPlan[]>('/api/feed/plans/shared'),
  feedSessionsPublic: () => request<PlanSession[]>('/api/feed/sessions/public'),
  feedSessionsShared: () => request<PlanSession[]>('/api/feed/sessions/shared'),
  clonePlan: (id: string) => request<TrainingPlan>(`/api/plans/${id}/clone`, { method: 'POST' }),
  /**
   * Sharing state and its four mutations, parameterized by what is being
   * shared. A workout, a plan and a finished session each have their own
   * `{id}/shares` and `{id}/visibility` routes on the server — same shape,
   * different URL prefix — so one function per verb here, not three.
   */
  getShares: (kind: ShareKind, id: string) => request<WorkoutShares>(`${shareBase(kind, id)}/shares`),
  setVisibility: (kind: ShareKind, id: string, visibility: Visibility) =>
    request<WorkoutShares>(`${shareBase(kind, id)}/visibility`, { method: 'PUT', body: { visibility } }),
  addShare: (kind: ShareKind, id: string, userId: number) =>
    request<WorkoutShares>(`${shareBase(kind, id)}/shares`, { method: 'POST', body: { userId } }),
  removeShare: (kind: ShareKind, id: string, userId: number) =>
    request<unknown>(`${shareBase(kind, id)}/shares/${userId}`, { method: 'DELETE' }),
  /**
   * Everyone on this instance.
   *
   * Backs both the share picker and the Discover page; `includeSelf` is the
   * difference between them, since you belong in a directory of members and
   * not in a list of people to share with.
   */
  listUserDirectory: (opts: string | { q?: string; includeSelf?: boolean } = {}) => {
    const o = typeof opts === 'string' ? { q: opts } : opts
    const p = new URLSearchParams()
    if (o.q) p.set('q', o.q)
    if (o.includeSelf) p.set('includeSelf', 'true')
    const qs = p.toString()
    return request<{ users: DirectoryUser[] }>(`/api/users${qs ? `?${qs}` : ''}`)
  },

  // --- Equipment ---
  listEquipment: () => request<Equipment[]>('/api/equipment'),
  getEquipment: (id: string) => request<Equipment & { workouts: LinkedWorkout[] }>(`/api/equipment/${id}`),
  createEquipment: (payload: EquipmentInput) =>
    request<Equipment>('/api/equipment', { method: 'POST', body: payload }),
  patchEquipment: (id: string, patch: Partial<EquipmentInput>) =>
    request<Equipment>(`/api/equipment/${id}`, { method: 'PATCH', body: patch }),
  deleteEquipment: (id: string) => request<unknown>(`/api/equipment/${id}`, { method: 'DELETE' }),
  /**
   * Adds workouts to a piece of equipment, from the gear page.
   *
   * Additive, unlike `patchWorkout({ equipmentIds })`, which replaces a
   * workout's whole kit. The gear page knows which gear it is editing and
   * nothing about the rest of what a workout carries, so a replacing write
   * from there would quietly unlink the watch to add the shoes. Both of these
   * answer with the full detail body, so the linked list and the wear figures
   * — which all change together — arrive in one round trip.
   */
  linkEquipmentWorkouts: (id: string, workoutIds: string[]) =>
    request<Equipment & { workouts: LinkedWorkout[] }>(`/api/equipment/${id}/workouts`, { method: 'POST', body: { workoutIds } }),
  unlinkEquipmentWorkout: (id: string, workoutId: string) =>
    request<Equipment & { workouts: LinkedWorkout[] }>(`/api/equipment/${id}/workouts/${workoutId}`, { method: 'DELETE' }),

  // --- Training plans ---
  listPlans: () => request<TrainingPlan[]>('/api/plans'),
  getPlan: (id: string) => request<TrainingPlan>(`/api/plans/${id}`),
  createPlan: (payload: { name: string; notes?: string }) =>
    request<TrainingPlan>('/api/plans', { method: 'POST', body: payload }),
  patchPlan: (id: string, patch: { name?: string; notes?: string; archived?: boolean }) =>
    request<TrainingPlan>(`/api/plans/${id}`, { method: 'PATCH', body: patch }),
  deletePlan: (id: string) => request<unknown>(`/api/plans/${id}`, { method: 'DELETE' }),
  /**
   * Saves a plan's whole day structure at once.
   *
   * The editor sends everything it is holding rather than a diff, and the
   * answer carries the ids the server issued for anything newly added — so
   * the next save updates those rows instead of creating them again.
   */
  savePlanDays: (id: string, days: PlanDay[]) =>
    request<TrainingPlan>(`/api/plans/${id}/days`, { method: 'PUT', body: { days } }),
  /**
   * Every exercise name this account has written, most recently used first.
   *
   * Its own endpoint rather than a wider plans list: the suggestions are
   * wanted on a screen that has not loaded the other plans, and the list page
   * has no business downloading every exercise to draw a dozen rows.
   */
  exerciseNames: () => request<{ names: string[] }>('/api/plan-exercise-names'),

  // --- Plan sessions ---
  /** The session in progress, or undefined when nothing is running. */
  activePlanSession: () => request<PlanSession | undefined>('/api/plan-sessions/active'),
  listPlanSessions: (limit = 50, offset = 0) =>
    request<PlanSession[]>(`/api/plan-sessions?limit=${limit}&offset=${offset}`),
  getPlanSession: (id: string) => request<PlanSession>(`/api/plan-sessions/${id}`),
  startPlanSession: (planId: string, dayId: string) =>
    request<PlanSession>('/api/plan-sessions', { method: 'POST', body: { planId, dayId } }),
  savePlanProgress: (id: string, progress: SessionProgress) =>
    request<PlanSession>(`/api/plan-sessions/${id}/progress`, { method: 'PUT', body: { progress } }),
  /**
   * Closes a session. The progress goes along with it so the last few ticks
   * cannot be lost to an autosave that failed on the way to the Finish tap.
   */
  finishPlanSession: (id: string, progress: SessionProgress, notes = '') =>
    request<PlanSession>(`/api/plan-sessions/${id}/finish`, { method: 'POST', body: { progress, notes } }),
  deletePlanSession: (id: string) => request<unknown>(`/api/plan-sessions/${id}`, { method: 'DELETE' }),
  /** Clears a batch of history rows in one request. */
  deletePlanSessions: (ids: string[]) =>
    request<{ deleted: number }>('/api/plan-sessions/delete', { method: 'POST', body: { ids } }),
}

/** Who, beyond the owner, can read a workout, plan or session. Direct shares are separate. */
export type Visibility = 'private' | 'public'

/** What is being shared — picks the URL prefix the four sharing calls use. */
export type ShareKind = 'workout' | 'plan' | 'session'

function shareBase(kind: ShareKind, id: string): string {
  const prefix = kind === 'workout' ? '/api/workouts' : kind === 'plan' ? '/api/plans' : '/api/plan-sessions'
  return `${prefix}/${id}`
}

/** A user as shown in the share picker and as a workout's author. */
export interface UserRef {
  id: number
  username: string
  displayName: string
  avatarPath: string
}

/** The owner's view of one workout's sharing state. */
export interface WorkoutShares {
  visibility: Visibility
  sharedWith: UserRef[]
}

export interface Equipment {
  id: string
  name: string
  type: string
  brand: string
  model: string
  notes: string
  retired: boolean
  workoutCount: number
  /** Summed across every linked workout. */
  totalDistance: number // meters
  totalDuration: number // seconds
  /** User's own replacement distance; 0 means use the per-type default. */
  retireAtKm: number
  createdAt: string
  updatedAt: string
}

export interface EquipmentInput {
  name: string
  type: string
  brand: string
  model: string
  notes: string
  retired: boolean
  retireAtKm?: number
}

/**
 * A workout using a piece of equipment.
 *
 * Carries everything a workout row shows, so the gear page can draw the same
 * row as the library rather than a reduced one of its own.
 */
export interface LinkedWorkout {
  id: string
  name: string
  type: import('../data/workouts').WorkoutType
  date: string
  distance: number
  duration: number
  elevationGain: number
  calories: number
  avgPace: number
  avgSpeed: number
  source?: 'upload' | 'manual' | 'healthconnect' | 'autoimport'
}

export interface ManualWorkoutInput {
  name: string
  type: string
  date: string
  duration: number
  distance: number
  avgHR: number
  maxHR: number
  elevationGain: number
  calories: number
  notes: string
  equipmentIds?: string[]
}

// ImportedWorkout is the import response: the workout, plus a flag set when the
// server recognised the file as one it had already imported and returned the
// existing workout instead of creating a duplicate.
export type ImportedWorkout = import('../data/workouts').Workout & { duplicate?: boolean }

export interface Stats {
  count: number
  totalDistance: number
  totalDuration: number
  totalElevation: number
  totalCalories: number
  avgHR: number
  last30Count: number
  typeCounts: Record<string, number>
  weekly: { week: string; hours: number; count: number; distance: number }[]
}
