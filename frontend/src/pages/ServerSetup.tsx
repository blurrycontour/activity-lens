import { useState } from 'react'
import { AlertCircle, ArrowRight, Loader2, Server } from 'lucide-react'
import Logo from '../components/Logo'
import AuthBackdrop from '../components/AuthBackdrop'
import { isInsecureURL, normalizeServerURL, probeServer, setServerURL } from '../lib/serverConfig'
import InsecureWarning from '../components/InsecureWarning'

/**
 * First run in the Android app: which server does this belong to?
 *
 * The app ships no address of its own. It is one binary anyone can install and
 * point at their own instance, so the server is configuration rather than
 * something baked in at build time — that is the whole reason this screen
 * exists, and why the APK is not per-deployment.
 *
 * The address is checked before it is stored. Typing it wrong is the most
 * likely thing to go wrong here, and finding out at "connect" is much better
 * than finding out after entering a password into whatever answered.
 */
export default function ServerSetup({ onConfigured }: { onConfigured: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Typing http:// is allowed — a LAN or Tailscale instance is a legitimate
  // setup — but not by accident, so it takes a second, deliberate press.
  const [acceptedInsecure, setAcceptedInsecure] = useState(false)

  const insecure = isInsecureURL(normalizeServerURL(value))

  async function connect() {
    const url = normalizeServerURL(value)
    if (!url) {
      setError('Enter your server address')
      return
    }
    if (isInsecureURL(url) && !acceptedInsecure) {
      setAcceptedInsecure(true)
      return
    }
    setBusy(true)
    setError(null)
    const result = await probeServer(url)
    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }
    await setServerURL(url)
    onConfigured()
  }

  return (
    <div className="auth-shell">
      <AuthBackdrop />

      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-brand">
            <Logo size={40} />
            <span className="auth-brand-name">Activity Lens</span>
          </div>
          <span className="auth-sub">Connect to your server to get started.</span>
        </div>

        <div className="auth-form">
          <div className="auth-field">
            <label className="auth-label" htmlFor="server-url">Server address</label>
            <div style={{ position: 'relative', display: 'flex' }}>
              <Server
                size={15}
                aria-hidden="true"
                style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}
              />
              <input
                id="server-url"
                className="input"
                style={{ width: '100%', paddingLeft: 34 }}
                placeholder="activity.example.com"
                value={value}
                onChange={e => { setValue(e.target.value); setError(null); setAcceptedInsecure(false) }}
                onKeyDown={e => { if (e.key === 'Enter' && !busy) void connect() }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                // A URL keyboard, and never a capitalised first letter — both are
                // small things that make this materially less annoying to type on
                // a phone, which is the only place this screen is ever shown.
                inputMode="url"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="auth-error" role="alert" aria-live="polite">
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {insecure && <InsecureWarning />}

          <button
            className="btn btn-primary auth-submit"
            onClick={() => void connect()}
            disabled={busy || value.trim() === ''}
          >
            {busy
              ? <><Loader2 size={15} className="spin" /> Checking…</>
              : insecure && !acceptedInsecure
                ? <>Connect anyway <ArrowRight size={15} /></>
                : <>Connect <ArrowRight size={15} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
