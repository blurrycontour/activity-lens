// Typed client for the Activity Lens backend API. Handles JSON, CSRF tokens
// (double-submit cookie echoed in a header), and error normalization.

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

export interface AuthFeatures {
  allowRegistration: boolean
  oidcEnabled: boolean
  oidcProviderName: string
  oidcLogoUrl: string
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
  const headers: Record<string, string> = { ...opts.headers }

  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (unsafe) {
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

  const res = await fetch(path, { method, headers, body, credentials: 'same-origin' })

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    const message = (data && (data.error as string)) || res.statusText || 'request failed'
    throw new ApiError(res.status, message)
  }
  return data as T
}

export const api = {
  // --- Auth ---
  authConfig: () => request<AuthFeatures>('/api/auth/config'),
  me: () => request<{ user: ApiUser; csrfToken: string }>('/api/auth/me'),
  login: (identifier: string, password: string) =>
    request<{ user: ApiUser; csrfToken: string }>('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
    }),
  register: (payload: { username: string; email: string; displayName: string; password: string }) =>
    request<{ user: ApiUser; csrfToken: string }>('/api/auth/register', { method: 'POST', body: payload }),
  logout: () => request<unknown>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (displayName: string, email: string) =>
    request<{ user: ApiUser }>('/api/auth/profile', { method: 'PATCH', body: { displayName, email } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<unknown>('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),
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
  getWorkout: (id: string) => request<import('../data/workouts').Workout>(`/api/workouts/${id}`),
  createWorkout: (payload: ManualWorkoutInput) =>
    request<import('../data/workouts').Workout>('/api/workouts', { method: 'POST', body: payload }),
  patchWorkout: (id: string, patch: { name?: string; type?: string; notes?: string; date?: string; calories?: number; steps?: number; equipmentIds?: string[] }) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}`, { method: 'PATCH', body: patch }),
  recalcWorkout: (id: string) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}/recalculate`, { method: 'POST' }),
  deleteWorkout: (id: string) => request<unknown>(`/api/workouts/${id}`, { method: 'DELETE' }),
  importWorkout: (file: File, type?: string, name?: string, equipmentIds?: string[]) => {
    const form = new FormData()
    form.append('file', file)
    if (type) form.append('type', type)
    if (name) form.append('name', name)
    if (equipmentIds) equipmentIds.forEach(id => form.append('equipmentIds', id))
    // `duplicate` marks a file the server had already imported; the workout in
    // the response is the existing one, left untouched.
    return request<ImportedWorkout>('/api/workouts/import', { method: 'POST', raw: form })
  },
  previewWorkout: (file: File, type?: string, name?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (type) form.append('type', type)
    if (name) form.append('name', name)
    return request<import('../data/workouts').Workout>('/api/workouts/preview', { method: 'POST', raw: form })
  },
  stats: () => request<Stats>('/api/stats'),

  // --- Equipment ---
  listEquipment: () => request<Equipment[]>('/api/equipment'),
  getEquipment: (id: string) => request<Equipment & { workouts: LinkedWorkout[] }>(`/api/equipment/${id}`),
  createEquipment: (payload: EquipmentInput) =>
    request<Equipment>('/api/equipment', { method: 'POST', body: payload }),
  patchEquipment: (id: string, patch: Partial<EquipmentInput>) =>
    request<Equipment>(`/api/equipment/${id}`, { method: 'PATCH', body: patch }),
  deleteEquipment: (id: string) => request<unknown>(`/api/equipment/${id}`, { method: 'DELETE' }),
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
