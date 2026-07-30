import { useState } from 'react'
import { Server, ArrowRight, AlertCircle, Loader2 } from 'lucide-react'
import Logo from '../components/Logo'
import { normalizeServerURL, probeServer, setServerURL } from '../lib/serverConfig'

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

  async function connect() {
    const url = normalizeServerURL(value)
    if (!url) {
      setError('Enter your server address')
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
      <div className="auth-card">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 22 }}>
          <Logo size={52} />
          <h1 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 14 }}>Activity Lens</h1>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6, textAlign: 'center', lineHeight: 1.5 }}>
            Connect to your server to get started.
          </p>
        </div>

        <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
          Server address
        </label>
        <div style={{ position: 'relative' }}>
          <Server
            size={15}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}
          />
          <input
            className="input"
            style={{ width: '100%', paddingLeft: 34 }}
            placeholder="activity.example.com"
            value={value}
            onChange={e => { setValue(e.target.value); setError(null) }}
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
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          The same address you use in a browser. <code>https://</code> is assumed if you leave it out.
        </p>

        {error && (
          <div style={{ display: 'flex', gap: 6, marginTop: 14, alignItems: 'flex-start', color: '#ef4444', fontSize: 12 }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={() => void connect()}
          disabled={busy || value.trim() === ''}
          style={{ width: '100%', justifyContent: 'center', marginTop: 18, opacity: busy || !value.trim() ? 0.5 : 1 }}
        >
          {busy ? (
            <><Loader2 size={15} style={{ animation: 'spin 0.9s linear infinite' }} /> Checking…</>
          ) : (
            <>Connect <ArrowRight size={15} /></>
          )}
        </button>
      </div>
    </div>
  )
}
