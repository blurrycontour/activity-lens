import { Menu, Sun, Moon, Monitor, HelpCircle } from 'lucide-react'
import type { ApiUser } from '../lib/api'

export type ThemeMode = 'dark' | 'light' | 'system'

interface TopBarProps {
  onToggleSidebar: () => void
  themeMode: ThemeMode
  onCycleTheme: () => void
  onUserMenu: () => void
  onHelp: () => void
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

export default function TopBar({ onToggleSidebar, themeMode, onCycleTheme, onUserMenu, onHelp, isMobile, user }: TopBarProps) {
  const initials = (user.displayName || user.username || '?')
    .split(/\s+/)
    .map(s => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <header className="topbar">
      {!isMobile && (
        <button className="btn-icon" onClick={onToggleSidebar} title="Toggle sidebar">
          <Menu size={18} />
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="/logo.png" alt="Activity Lens" width={28} height={28} style={{ borderRadius: 8, display: 'block' }} />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Activity Lens
        </span>
      </div>

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

      <button
        onClick={onUserMenu}
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: user.avatarPath ? 'transparent' : 'linear-gradient(135deg, var(--primary) 0%, var(--blue) 100%)',
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
        {user.avatarPath
          ? <img src={user.avatarPath} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initials}
      </button>
    </header>
  )
}
