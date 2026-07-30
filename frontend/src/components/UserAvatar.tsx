import { apiURL, type UserRef } from '../lib/api'

/** Display label for a user, falling back to the username. */
export function userLabel(u: UserRef): string {
  return u.displayName.trim() || u.username
}

/**
 * The picture to show for a user: their upload, or the deterministic avatar the
 * server generates from their username. Mirrors effectiveAvatar in the backend,
 * for the places the client builds a reference itself.
 *
 * Resolved through apiURL because both forms are server paths: in the native
 * app the server is somewhere else entirely, and an unprefixed /api/... would
 * point at the WebView's own origin, where nothing is listening.
 */
export function avatarUrl(u: { avatarPath?: string; username: string }): string {
  return apiURL(u.avatarPath || `/api/avatars/auto/${encodeURIComponent(u.username)}.png`)
}

/** Small round avatar for a user. */
export default function UserAvatar({ user, size = 28 }: { user: UserRef; size?: number }) {
  return (
    <img
      src={avatarUrl(user)}
      alt=""
      title={userLabel(user)}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        objectFit: 'cover',
        background: 'var(--bg-3)',
      }}
    />
  )
}
