import { useEffect, useRef } from 'react'
import { User, Settings, Shield, LogOut, X } from 'lucide-react'
import type { ApiUser } from '../lib/api'

interface UserMenuProps {
  onClose: () => void
  onSettings: () => void
  onLogout: () => void | Promise<void>
  user: ApiUser
}

export default function UserMenu({ onClose, onSettings, onLogout, user }: UserMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handle), 50)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const initials = (user.displayName || user.username || '?')
    .split(/\s+/)
    .map(s => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const items = [
    { icon: <User size={15} />, label: 'User Details', sub: `${user.displayName || user.username} · ${user.email}`, action: onClose },
    { icon: <Settings size={15} />, label: 'Settings', sub: 'Appearance, profile, security', action: () => { onClose(); onSettings() } },
    ...(user.isAdmin ? [{ icon: <Shield size={15} />, label: 'Role', sub: `Administrator`, action: onClose }] : []),
  ]

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 150 }}
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
          zIndex: 200,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--blue) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {initials}
          </div>
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
