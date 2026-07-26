import { useState, type FormEvent } from 'react'
import { LogIn, UserPlus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../lib/api'
import Logo from '../components/Logo'

export default function Login() {
  const { login, register, features } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(identifier, password)
      } else {
        await register({ username, email, displayName: displayName || username, password })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const canRegister = features?.allowRegistration
  const oidc = features?.oidcEnabled

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 8 }}>
          <Logo size={40} radius={12} />
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Activity Lens</span>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, marginBottom: 24 }}>
          {mode === 'login' ? 'Sign in to your training log' : 'Create your account'}
        </p>

        <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'login' ? (
            <Field label="Username or email">
              <input className="input" value={identifier} onChange={e => setIdentifier(e.target.value)} autoFocus autoComplete="username" style={{ width: '100%' }} />
            </Field>
          ) : (
            <>
              <Field label="Username">
                <input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" style={{ width: '100%' }} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" style={{ width: '100%' }} />
              </Field>
              <Field label="Display name (optional)">
                <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} style={{ width: '100%' }} />
              </Field>
            </>
          )}
          <Field label="Password">
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} style={{ width: '100%' }} />
          </Field>

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 10px' }}>
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center', marginTop: 4 }}>
            {mode === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

          {oidc && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Or continue with</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <a className="btn btn-ghost" href="/api/auth/oidc/login" style={{ justifyContent: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                {features?.oidcLogoUrl && (
                  <img src={features.oidcLogoUrl} alt="" width={18} height={18} style={{ borderRadius: 4, display: 'block' }} />
                )}
                Continue with {features?.oidcProviderName || 'SSO'}
              </a>
            </>
          )}
        </form>

        {canRegister && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', marginTop: 16 }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
