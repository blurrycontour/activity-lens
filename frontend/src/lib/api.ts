// Typed client for the Activity Lens backend API. Handles JSON, CSRF tokens
// (double-submit cookie echoed in a header), and error normalization.

import { reportReachability, respondedFromBackend } from './network'
import { fetchWithCache } from './nativeCache'
import { apiBase, authToken, isNative } from './serverConfig'

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
export type NotificationKind = 'workout_shared' | 'gear_worn' | 'goal_met' | 'goal_at_risk' | 'workout_imported' | 'feedback'

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

export interface SessionInfo {
  id: string
  userAgent: string
  ip: string
  createdAt: string
  expiresAt: string
  current: boolean
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
   * Whether newly imported workouts get their historical conditions looked up.
   *
   * On by default, because it only ever covers workouts imported from now on —
   * nothing already in the library is sent anywhere without the separate,
   * explicit backfill below.
   */
  weatherEnabled?: boolean
}

export interface ApiGoal {
  id: string
  /** Qualifying activities required per period. */
  count: number
  period: 'week' | 'month'
  /** Activity type the goal applies to, or '' for any. */
  type: string
  /** Minimum distance (km) for an activity to count. */
  minKm: number
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
  const headers: Record<string, string> = { ...opts.headers, ...authHeaders() }

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
  testEmail: (to: string) =>
    request<{ status: string; to: string }>('/api/admin/settings/smtp/test', { method: 'POST', body: { to } }),
  listAdminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
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
  patchWorkout: (id: string, patch: { name?: string; type?: string; notes?: string; date?: string; calories?: number; steps?: number; equipmentIds?: string[] }) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}`, { method: 'PATCH', body: patch }),
  /**
   * Re-derives the named values. Everything named is overwritten, including
   * anything entered by hand, which is why the caller has to name them.
   */
  recalcWorkout: (id: string, parts: import('../data/workouts').RecalcParts) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}/recalculate`, {
      method: 'POST',
      // The object, not a string: request() serialises `body` itself, and
      // stringifying here sent a JSON string containing JSON, which the server
      // rejected as an invalid body.
      body: parts,
    }),
  deleteWorkout: (id: string) => request<unknown>(`/api/workouts/${id}`, { method: 'DELETE' }),
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
  getShares: (id: string) => request<WorkoutShares>(`/api/workouts/${id}/shares`),
  setVisibility: (id: string, visibility: Visibility) =>
    request<WorkoutShares>(`/api/workouts/${id}/visibility`, { method: 'PUT', body: { visibility } }),
  addShare: (id: string, userId: number) =>
    request<WorkoutShares>(`/api/workouts/${id}/shares`, { method: 'POST', body: { userId } }),
  removeShare: (id: string, userId: number) =>
    request<unknown>(`/api/workouts/${id}/shares/${userId}`, { method: 'DELETE' }),
  /** Minimal user directory backing the share picker. */
  listUserDirectory: (q?: string) =>
    request<{ users: UserRef[] }>(`/api/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  // --- Equipment ---
  listEquipment: () => request<Equipment[]>('/api/equipment'),
  getEquipment: (id: string) => request<Equipment & { workouts: LinkedWorkout[] }>(`/api/equipment/${id}`),
  createEquipment: (payload: EquipmentInput) =>
    request<Equipment>('/api/equipment', { method: 'POST', body: payload }),
  patchEquipment: (id: string, patch: Partial<EquipmentInput>) =>
    request<Equipment>(`/api/equipment/${id}`, { method: 'PATCH', body: patch }),
  deleteEquipment: (id: string) => request<unknown>(`/api/equipment/${id}`, { method: 'DELETE' }),
}

/** Who, beyond the owner, can read a workout. Direct shares are separate. */
export type Visibility = 'private' | 'public'

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

export interface LinkedWorkout {
  id: string
  name: string
  type: string
  date: string
  distance: number
  duration: number
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
