import { useState, type FormEvent } from 'react'
import { AlertCircle, Loader2, LogIn, UserPlus, WifiOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ApiError, apiURL } from '../lib/api'
import { isGatewayError, useOnlineStatus } from '../lib/network'
import Logo from '../components/Logo'
import PasswordInput from '../components/PasswordInput'

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
      // An ApiError means the server answered and rejected this; anything else
      // never reached it, and "Something went wrong" would send the user
      // looking for a typo in a password that was never checked.
      const reachedServer = err instanceof ApiError && !isGatewayError(err.status)
      setError(reachedServer
        ? (err as ApiError).message
        : "Can't reach the server. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const online = useOnlineStatus()
  const canRegister = features?.allowRegistration
  const oidc = features?.oidcEnabled
  const registering = mode === 'register'

  function switchMode(next: 'login' | 'register') {
    setMode(next)
    setError(null)
  }

  return (
    <div className="auth-shell">
      <div className="auth-ambient" aria-hidden="true">
        <div className="auth-blob auth-blob-1" />
        <div className="auth-blob auth-blob-2" />
        {/* Each line ends with a straight run off the right edge. For that join
            to read as smooth, the preceding curve has to *exit* along the same
            direction — so every S command's second control point is placed on
            the line between its endpoint and the final point. Move an endpoint
            and you have to move its control point to match, or the curve kinks
            where it meets the straight. */}
        <svg className="auth-trace" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" fill="none">
          <g stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
            <path d="M-40 430 C 120 400 180 250 320 280 S 520 342 660 300 L 860 240" />
            <path d="M-40 520 C 140 500 220 380 360 400 S 572 450 700 410 L 860 360" opacity="0.6" />
            <path d="M-40 330 C 100 300 200 180 300 200 S 508 220 640 190 L 860 140" opacity="0.4" />
          </g>
        </svg>
      </div>

      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-brand">
            <Logo size={40} />
            <span className="auth-brand-name">Activity Lens</span>
          </div>
          <span className="auth-sub">
            {registering ? 'Start logging your training in a minute.' : 'Sign in to your training log.'}
          </span>
        </div>

        {/* Plain buttons with aria-pressed rather than role="tab": these swap
            fields within one form, they don't switch between tabpanels. */}
        {canRegister && (
          <div className="auth-tabs">
            <button type="button" aria-pressed={!registering} onClick={() => switchMode('login')}>
              Sign in
            </button>
            <button type="button" aria-pressed={registering} onClick={() => switchMode('register')}>
              Sign up
            </button>
          </div>
        )}

        <form onSubmit={submit} className="auth-form">
          {registering ? (
            <>
              <Field label="Username">
                <input
                  className="input"
                  name="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  name="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label="Display name — optional">
                <input
                  className="input"
                  name="displayName"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  autoComplete="name"
                  style={{ width: '100%' }}
                />
              </Field>
            </>
          ) : (
            <Field label="Username or email">
              <input
                className="input"
                name="identifier"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                autoFocus
                autoComplete="username"
                style={{ width: '100%' }}
              />
            </Field>
          )}

          {/* Not <Field>: that wraps its children in a <label>, and PasswordInput
              contains a button, which must not be nested inside one. */}
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-password">Password</label>
            <PasswordInput
              id="auth-password"
              name="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'}
              capsLockWarning
            />
          </div>

          {error && (
            <div className="auth-error" role="alert" aria-live="polite">
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <button className="btn btn-primary auth-submit" type="submit" disabled={busy || !online}>
            {busy
              ? <Loader2 size={15} className="spin" />
              : registering ? <UserPlus size={15} /> : <LogIn size={15} />}
            {registering ? 'Create account' : 'Sign in'}
          </button>

          {!online && (
            <span className="auth-note">
              <WifiOff size={13} /> You're offline — reconnect to sign in.
            </span>
          )}
        </form>

        {oidc && (
          <>
            <div className="auth-divider"><span>or continue with</span></div>
            <a className="auth-sso" href={apiURL('/api/auth/oidc/login')}>
              <SsoLogo light={features?.oidcLogoUrl} dark={features?.oidcLogoUrlDark} />
              Continue with {features?.oidcProviderName || 'SSO'}
            </a>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      {children}
    </label>
  )
}

/**
 * The provider's logo on the SSO button.
 *
 * A provider logo is often dark ink that vanishes against the dark login card,
 * so admins can supply a separate dark-theme version. When they have, both
 * images are rendered and CSS picks one off the `.light` class that App.tsx
 * puts on `:root` — that keeps this component ignorant of the theme, and means
 * "system" mode follows the OS without a re-render.
 */
function SsoLogo({ light, dark }: { light?: string; dark?: string }) {
  if (!light && !dark) return null

  const size = { width: 20, height: 20, borderRadius: 4 }
  if (!light || !dark) {
    return <img src={(light || dark) as string} alt="" style={{ ...size, display: 'block' }} />
  }
  return (
    <>
      <img className="auth-sso-logo-light" src={light} alt="" style={size} />
      <img className="auth-sso-logo-dark" src={dark} alt="" style={size} />
    </>
  )
}
