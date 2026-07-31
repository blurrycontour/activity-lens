import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, Loader2, LogIn, Server, Smartphone, UserPlus, WifiOff } from 'lucide-react'
import { clearCachedUser, useAuth } from '../context/AuthContext'
import { api, ApiError, apiURL, type AndroidApp } from '../lib/api'
import { apiBase, forgetServer, isNative } from '../lib/serverConfig'
import { SSO_CANCELLED } from '../lib/native/nativeAuth'
import { isGatewayError, useOnlineStatus } from '../lib/network'
import Logo from '../components/Logo'
import PasswordInput from '../components/PasswordInput'
import AuthBackdrop from '../components/AuthBackdrop'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Login() {
  const { login, loginWithSSO, register, features } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The native SSO round trip: the user leaves for a browser and comes back,
  // which can take as long as their provider takes. The abort controller is how
  // leaving this page stops the wait rather than resolving into a page that is
  // no longer mounted.
  const [ssoBusy, setSsoBusy] = useState(false)
  const ssoAbort = useRef<AbortController | null>(null)
  useEffect(() => () => ssoAbort.current?.abort(), [])

  async function ssoSignIn() {
    setError(null)
    setSsoBusy(true)
    ssoAbort.current?.abort()
    const controller = new AbortController()
    ssoAbort.current = controller
    try {
      await loginWithSSO(controller.signal)
    } catch (err) {
      // Two silent cases: this component unmounting, and the user backing out
      // of the browser. Neither is a failure, and "Sign-in failed" in front of
      // someone who just changed their mind reads as the app being broken.
      const cancelled = controller.signal.aborted
        || (err instanceof Error && err.message === SSO_CANCELLED)
      if (!cancelled) {
        setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.')
      }
    } finally {
      if (!controller.signal.aborted) setSsoBusy(false)
    }
  }

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

  // What Android build this server publishes. Only asked for in a browser: in
  // the app itself the answer is an update prompt, not a download button.
  const [androidApp, setAndroidApp] = useState<AndroidApp | null>(null)
  useEffect(() => {
    if (isNative()) return
    let cancelled = false
    api.androidApp()
      .then(app => { if (!cancelled) setAndroidApp(app) })
      // An older server has no such endpoint; the button simply stays hidden.
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  /**
   * Returns to the server picker.
   *
   * Reachable without signing in on purpose: a mistyped-but-reachable address,
   * or a server you have no account on, leaves you at this screen with no other
   * way out. Settings has the same action for the signed-in case.
   */
  const [confirmChange, setConfirmChange] = useState(false)

  async function changeServer() {
    setConfirmChange(false)
    // The cached identity belongs to the server being left; leaving it would
    // show the next server a name it never issued.
    clearCachedUser()
    // Returns to the setup screen in place. A reload would re-run the whole
    // boot and, in the Android WebView, briefly show the window background
    // through a blank page; see forgetServer.
    await forgetServer()
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
      {confirmChange && (
        <ConfirmDialog
          title="Connect to a different server?"
          message={`This app will forget ${apiBase().replace(/^https?:\/\//, '')} and return to the setup screen. Nothing on the server is changed.`}
          confirmLabel="Change server"
          onConfirm={() => void changeServer()}
          onCancel={() => setConfirmChange(false)}
        />
      )}
      <AuthBackdrop />

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
            {/* A link in a browser, a button in the app.

                Following the link natively is what the old bug was: the WebView
                sends an off-origin navigation to the system browser, which then
                shows the server's own web app — signing the *browser* in and
                leaving the app exactly as it was. Natively the flow has to be
                driven, not followed; see lib/native/nativeAuth.ts. */}
            {isNative() ? (
              <button type="button" className="auth-sso" onClick={ssoSignIn} disabled={ssoBusy}>
                {ssoBusy
                  ? <Loader2 className="spin" size={16} />
                  : <SsoLogo light={features?.oidcLogoUrl} dark={features?.oidcLogoUrlDark} />}
                {ssoBusy ? 'Waiting for sign-in…' : `Continue with ${features?.oidcProviderName || 'SSO'}`}
              </button>
            ) : (
              <a className="auth-sso" href={apiURL('/api/auth/oidc/login')}>
                <SsoLogo light={features?.oidcLogoUrl} dark={features?.oidcLogoUrlDark} />
                Continue with {features?.oidcProviderName || 'SSO'}
              </a>
            )}
          </>
        )}

        {/* Web only: hand the visitor the app that goes with this server. The
            version is the server's own, so what they install matches what they
            are signing in to. */}
        {androidApp?.available && (
          <a
            className="auth-app-link"
            href={apiURL(androidApp.downloadPath ?? '/api/app/android/download')}
          >
            <Smartphone size={14} />
            <span>Get the Android app</span>
            <span className="auth-app-version">{androidApp.version}</span>
          </a>
        )}

        {/* Native only: which server this app is pointed at, and a way out. */}
        {isNative() && (
          <div className="auth-server">
            <Server size={12} />
            <span className="auth-server-url">{apiBase().replace(/^https?:\/\//, '')}</span>
            <button type="button" className="auth-server-change" onClick={() => setConfirmChange(true)}>
              Change
            </button>
          </div>
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
