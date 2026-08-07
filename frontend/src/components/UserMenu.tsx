import { useEffect, useRef, useState } from 'react'
import { Settings, Shield, LogOut, X, Info, ArrowUpCircle } from 'lucide-react'
import AboutDialog from './AboutDialog'
import { applyPendingUpdate, useUpdatePending } from '../lib/appUpdate'
import { avatarUrl } from './UserAvatar'
import type { ApiUser } from '../lib/api'

interface UserMenuProps {
  onClose: () => void
  onSettings: () => void
  /** Opens the Profile section of Settings, from the header. */
  onProfile: () => void
  onAdmin: () => void
  onLogout: () => void | Promise<void>
  user: ApiUser
}

export default function UserMenu({ onClose, onSettings, onProfile, onAdmin, onLogout, user }: UserMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [showAbout, setShowAbout] = useState(false)
  // Dismissing the update toast should not lose the update; this is where it
  // stays reachable afterwards.
  const updatePending = useUpdatePending()

  useEffect(() => {
    if (showAbout) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handle), 50)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose, showAbout])


  const items = [
    // Account used to be a peer of Settings; it is a group inside it now, so
    // there is one door into everything configurable rather than two.
    { icon: <Settings size={15} />, label: 'Settings', sub: 'Profile, security and preferences', action: () => { onClose(); onSettings() } },
    ...(user.isAdmin ? [{ icon: <Shield size={15} />, label: 'Admin', sub: 'Users, email, SSO, storage', action: () => { onClose(); onAdmin() } }] : []),
    { icon: <Info size={15} />, label: 'About', sub: 'Version & app info', action: () => setShowAbout(true) },
    ...(updatePending
      // Closed first: on web this reloads and the menu goes with the page, but
      // in the Android app it opens the install dialog, which would otherwise
      // appear underneath a menu still sitting on top of it.
      ? [{ icon: <ArrowUpCircle size={15} />, label: 'Update app', sub: 'A new version is ready', accent: true, action: () => { onClose(); void applyPendingUpdate() } }]
      : []),
  ]

  if (showAbout) return <AboutDialog onClose={() => { setShowAbout(false); onClose() }} />

  return (
    <>
      <div
        className="overlay"
        onClick={onClose}
      />
      <div
        ref={ref}
        style={{
          position: 'fixed',
          top: 56,
          right: 12,
          width: 300,
          background: 'var(--bg-2)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          zIndex: 1101,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* The picture and name are the obvious thing to press to get at your
              own account, so they are the shortcut rather than decoration. */}
          <button
            className="user-menu-identity"
            onClick={() => { onClose(); onProfile() }}
            aria-label="Open your profile"
          >
            <img src={avatarUrl(user)} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: 'var(--bg-3)' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName || user.username}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            </div>
          </button>
          <button className="btn-icon" onClick={onClose} style={{ marginLeft: 'auto', flexShrink: 0 }} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 8 }}>
          {items.map(item => (
            <button
              key={item.label}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8, background: 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.12s', color: 'var(--text)',
              }}
              onClick={item.action}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: item.accent ? 'var(--primary)' : 'var(--text-2)', flexShrink: 0 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: item.accent ? 'var(--primary)' : undefined }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{item.sub}</div>
              </div>
            </button>
          ))}
        </div>

        <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => { onClose(); void onLogout() }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 8, background: 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              color: 'var(--danger)', transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <LogOut size={15} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Log Out</span>
          </button>
        </div>
      </div>
    </>
  )
}
