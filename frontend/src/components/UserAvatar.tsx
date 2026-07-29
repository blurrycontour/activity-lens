import type { UserRef } from '../lib/api'

/** Display label for a user, falling back to the username. */
export function userLabel(u: UserRef): string {
  return u.displayName.trim() || u.username
}

/**
 * Small round avatar for a user, falling back to their initial on an accent
 * gradient when they have not uploaded a picture — matching TopBar's treatment.
 */
export default function UserAvatar({ user, size = 28 }: { user: UserRef; size?: number }) {
  const label = userLabel(user)
  return (
    <span
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        color: '#fff',
        background: user.avatarPath ? 'transparent' : 'linear-gradient(135deg, var(--primary) 0%, var(--blue) 100%)',
      }}
    >
      {user.avatarPath
        ? <img src={user.avatarPath} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : label.charAt(0).toUpperCase()}
    </span>
  )
}
