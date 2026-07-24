import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api, ApiError } from '../lib/api'

interface SettingsModalProps {
  onClose: () => void
  accent: string
  onAccentChange: (a: string) => void
}

export const ACCENTS: { name: string; value: string; dim: string; glow: string }[] = [
  { name: 'Electric Green', value: '#00e87a', dim: 'rgba(0,232,122,0.15)', glow: 'rgba(0,232,122,0.3)' },
  { name: 'Electric Blue',  value: '#3b82f6', dim: 'rgba(59,130,246,0.15)', glow: 'rgba(59,130,246,0.3)' },
  { name: 'Vivid Orange',   value: '#ff6b35', dim: 'rgba(255,107,53,0.15)', glow: 'rgba(255,107,53,0.3)' },
  { name: 'Violet',         value: '#a855f7', dim: 'rgba(168,85,247,0.15)', glow: 'rgba(168,85,247,0.3)' },
  { name: 'Cyan',           value: '#06b6d4', dim: 'rgba(6,182,212,0.15)',  glow: 'rgba(6,182,212,0.3)'  },
  { name: 'Rose',           value: '#f43f5e', dim: 'rgba(244,63,94,0.15)',  glow: 'rgba(244,63,94,0.3)'  },
]

export function applyAccent(value: string) {
  const a = ACCENTS.find(a => a.value === value) || ACCENTS[0]
  const root = document.documentElement
  root.style.setProperty('--primary', a.value)
  root.style.setProperty('--primary-dim', a.dim)
  root.style.setProperty('--primary-glow', a.glow)
}

export default function SettingsModal({ onClose, accent, onAccentChange }: SettingsModalProps) {
  const { user, setUser } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pwBusy, setPwBusy] = useState(false)

  function handleAccent(value: string) {
    onAccentChange(value)
    applyAccent(value)
  }

  async function saveProfile() {
    setProfileBusy(true)
    setProfileMsg(null)
    try {
      const { user: updated } = await api.updateProfile(displayName.trim(), email.trim())
      setUser(updated)
      setProfileMsg({ ok: true, text: 'Profile updated' })
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Update failed' })
    } finally {
      setProfileBusy(false)
    }
  }

  async function changePassword() {
    setPwBusy(true)
    setPwMsg(null)
    try {
      await api.changePassword(currentPw, newPw)
      setCurrentPw('')
      setNewPw('')
      setPwMsg({ ok: true, text: 'Password changed' })
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Change failed' })
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Settings</h2>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Account & appearance</p>
            </div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          {/* Account */}
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Account</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Display Name</label>
                <input className="input" style={{ width: '100%' }} value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Email</label>
                <input className="input" type="email" style={{ width: '100%' }} value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button className="btn btn-primary" onClick={saveProfile} disabled={profileBusy} style={{ opacity: profileBusy ? 0.5 : 1 }}>
                {profileBusy ? 'Saving…' : 'Save Profile'}
              </button>
              {profileMsg && (
                <span style={{ fontSize: 12, color: profileMsg.ok ? 'var(--primary)' : '#ef4444' }}>{profileMsg.text}</span>
              )}
            </div>
          </section>

          {/* Password */}
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Change Password</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Current Password</label>
                <input className="input" type="password" autoComplete="current-password" style={{ width: '100%' }} value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>New Password</label>
                <input className="input" type="password" autoComplete="new-password" style={{ width: '100%' }} value={newPw} onChange={e => setNewPw(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button className="btn btn-ghost" onClick={changePassword} disabled={pwBusy || !currentPw || !newPw} style={{ opacity: (pwBusy || !currentPw || !newPw) ? 0.5 : 1 }}>
                {pwBusy ? 'Updating…' : 'Update Password'}
              </button>
              {pwMsg && (
                <span style={{ fontSize: 12, color: pwMsg.ok ? 'var(--primary)' : '#ef4444' }}>{pwMsg.text}</span>
              )}
            </div>
          </section>

          {/* Accent color */}
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Accent Color</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              Used for active states, highlights, and interactive elements.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {ACCENTS.map(a => (
                <button
                  key={a.value}
                  onClick={() => handleAccent(a.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: `1.5px solid ${accent === a.value ? a.value : 'var(--border)'}`,
                    background: accent === a.value ? a.dim : 'var(--bg-3)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: a.value, flexShrink: 0,
                    boxShadow: accent === a.value ? `0 0 8px ${a.glow}` : 'none',
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: accent === a.value ? a.value : 'var(--text-2)', flex: 1, textAlign: 'left' }}>
                    {a.name}
                  </span>
                  {accent === a.value && <Check size={13} color={a.value} />}
                </button>
              ))}
            </div>
          </section>

          {/* Units */}
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Units</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Metric (km, m)', 'Imperial (mi, ft)'].map(u => (
                <button
                  key={u}
                  style={{
                    flex: 1, padding: '8px 12px',
                    borderRadius: 8, border: `1px solid ${u.includes('Metric') ? 'var(--primary)' : 'var(--border)'}`,
                    background: u.includes('Metric') ? 'var(--primary-dim)' : 'var(--bg-3)',
                    color: u.includes('Metric') ? 'var(--primary)' : 'var(--text-2)',
                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {u}
                </button>
              ))}
            </div>
          </section>

          {/* HR zones */}
          <section>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Heart Rate Zones</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Max HR', value: '185', unit: 'bpm' },
                { label: 'Resting HR', value: '52', unit: 'bpm' },
                { label: 'Threshold Pace', value: '5:00', unit: '/km' },
                { label: 'FTP (Cycling)', value: '240', unit: 'W' },
              ].map(f => (
                <div key={f.label}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                  <div style={{ display: 'flex', gap: 0 }}>
                    <input
                      className="input"
                      defaultValue={f.value}
                      style={{ borderRadius: '6px 0 0 6px', flex: 1, minWidth: 0 }}
                    />
                    <span style={{
                      background: 'var(--bg-3)', border: '1px solid var(--border)', borderLeft: 'none',
                      borderRadius: '0 6px 6px 0', padding: '7px 8px', fontSize: 12, color: 'var(--text-3)',
                      fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                    }}>{f.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </>
  )
}
