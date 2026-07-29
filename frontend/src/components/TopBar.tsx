import NotificationBell from './NotificationBell'
import { avatarUrl } from './UserAvatar'
import { useUpdatePending } from '../lib/appUpdate'
import { Menu, Sun, Moon, Monitor, HelpCircle } from 'lucide-react'
import type { ApiUser } from '../lib/api'
import Logo from './Logo'

export type ThemeMode = 'dark' | 'light' | 'system'

interface TopBarProps {
  onToggleSidebar: () => void
  themeMode: ThemeMode
  onCycleTheme: () => void
  onUserMenu: () => void
  onHelp: () => void
  /** Clicking the brand returns to the dashboard, like any site logo. */
  onHome: () => void
  /** Opens an in-app path, e.g. from a notification's deep link. */
  onNavigate: (link: string) => void
  isMobile: boolean
  user: ApiUser
}

const THEME_ICONS: Record<ThemeMode, React.ReactNode> = {
  dark: <Moon size={17} />,
  light: <Sun size={17} />,
  system: <Monitor size={17} />,
}

const THEME_LABELS: Record<ThemeMode, string> = {
  dark: 'Dark mode',
  light: 'Light mode',
  system: 'System theme',
}

export default function TopBar({ onToggleSidebar, themeMode, onCycleTheme, onUserMenu, onHelp, onHome, onNavigate, isMobile, user }: TopBarProps) {
  const updatePending = useUpdatePending()

  return (
    <header className="topbar">
      {!isMobile && (
        <button className="btn-icon" onClick={onToggleSidebar} title="Toggle sidebar">
          <Menu size={18} />
        </button>
      )}

      <button
        onClick={onHome}
        title="Go to dashboard"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        }}
      >
        <Logo size={28} radius={8} />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Activity Lens
        </span>
      </button>

      <div style={{ flex: 1 }} />

      {/* Help — always visible, moves to topbar on mobile since bottom bar has no Help slot */}
      {isMobile && (
        <button className="btn-icon" onClick={onHelp} title="Help">
          <HelpCircle size={18} />
        </button>
      )}

      {/* Theme cycle: dark → light → system → dark */}
      <button
        className="btn-icon"
        onClick={onCycleTheme}
        title={THEME_LABELS[themeMode]}
        style={{ position: 'relative' }}
      >
        {THEME_ICONS[themeMode]}
      </button>

      <NotificationBell onNavigate={onNavigate} />

      <button
        onClick={onUserMenu}
        style={{
          position: 'relative',
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--bg-3)',
          border: '2px solid var(--border)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff',
          transition: 'transform 0.15s, box-shadow 0.15s',
          flexShrink: 0, overflow: 'hidden', padding: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--primary-glow)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none' }}
        title="User menu"
      >
        <img src={avatarUrl(user)} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* A dismissed update still has to be findable; the menu is where it
            lives, so the avatar carries the only hint that it is in there. */}
        {updatePending && <span className="update-dot" aria-hidden="true" />}
      </button>
    </header>
  )
}
