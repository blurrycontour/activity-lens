import { useEffect, useRef, useState } from 'react'
import { User, Settings, Shield, LogOut, X, Info } from 'lucide-react'
import AboutDialog from './AboutDialog'
import { avatarUrl } from './UserAvatar'
import type { ApiUser } from '../lib/api'

interface UserMenuProps {
  onClose: () => void
  onAccount: () => void
  onSettings: () => void
  onAdmin: () => void
  onLogout: () => void | Promise<void>
  user: ApiUser
}

export default function UserMenu({ onClose, onAccount, onSettings, onAdmin, onLogout, user }: UserMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [showAbout, setShowAbout] = useState(false)

  useEffect(() => {
    if (showAbout) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handle), 50)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose, showAbout])


  const items = [
    { icon: <User size={15} />, label: 'Account', sub: 'Profile, password, sessions', action: () => { onClose(); onAccount() } },
    { icon: <Settings size={15} />, label: 'Settings', sub: 'Appearance & preferences', action: () => { onClose(); onSettings() } },
    ...(user.isAdmin ? [{ icon: <Shield size={15} />, label: 'Admin Panel', sub: 'Users, email, SSO', action: () => { onClose(); onAdmin() } }] : []),
    { icon: <Info size={15} />, label: 'About', sub: 'Version & app info', action: () => setShowAbout(true) },
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
          <img src={avatarUrl(user)} alt="Avatar" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: 'var(--bg-3)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{user.displayName || user.username}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{user.email}</div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ marginLeft: 'auto' }}>
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
              <span style={{ color: 'var(--text-2)', flexShrink: 0 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
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
              color: '#ef4444', transition: 'background 0.12s',
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
