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

  // --- Workouts ---
  listWorkouts: () => request<import('../data/workouts').Workout[]>('/api/workouts'),
  getWorkout: (id: string) => request<import('../data/workouts').Workout>(`/api/workouts/${id}`),
  createWorkout: (payload: ManualWorkoutInput) =>
    request<import('../data/workouts').Workout>('/api/workouts', { method: 'POST', body: payload }),
  patchWorkout: (id: string, patch: { name?: string; type?: string; notes?: string }) =>
    request<import('../data/workouts').Workout>(`/api/workouts/${id}`, { method: 'PATCH', body: patch }),
  deleteWorkout: (id: string) => request<unknown>(`/api/workouts/${id}`, { method: 'DELETE' }),
  importWorkout: (file: File, type?: string, name?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (type) form.append('type', type)
    if (name) form.append('name', name)
    return request<import('../data/workouts').Workout>('/api/workouts/import', { method: 'POST', raw: form })
  },
  stats: () => request<Stats>('/api/stats'),
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
}

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
