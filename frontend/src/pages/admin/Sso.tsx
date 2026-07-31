import { useState } from 'react'
import { api, ApiError, type AdminSettings, type OidcInput } from '../../lib/api'
import PasswordInput from '../../components/PasswordInput'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

interface Props {
  settings: AdminSettings
  onSaved: (s: AdminSettings) => void
}

export default function SsoAdmin({ settings, onSaved }: Props) {
  const s = settings.oidc
  const ov = s.overridden || {}
  const [enabled, setEnabled] = useState(s.enabled)
  const [issuerUrl, setIssuerUrl] = useState(s.issuerUrl)
  const [clientId, setClientId] = useState(s.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUrl, setRedirectUrl] = useState(s.redirectUrl)
  const [adminGroup, setAdminGroup] = useState(s.adminGroup)
  const [providerName, setProviderName] = useState(s.providerName)
  const [logoUrl, setLogoUrl] = useState(s.logoUrl)
  const [logoUrlDark, setLogoUrlDark] = useState(s.logoUrlDark)
  const [allowRegistration, setAllowRegistration] = useState(s.allowRegistration)
  const [scopes, setScopes] = useState((s.scopes || []).join(' '))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  async function save() {
    setBusy(true); setMsg(null)
    const payload: OidcInput = {
      enabled, issuerUrl, clientId, clientSecret, redirectUrl,
      adminGroup, providerName, logoUrl, logoUrlDark, allowRegistration,
      scopes: scopes.split(/\s+/).map(x => x.trim()).filter(Boolean),
    }
    try {
      onSaved(await api.saveOIDC(payload))
      setClientSecret('')
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  return (
    <>
      <SettingsCard title="Provider">
        <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
          <input type="checkbox" checked={enabled} disabled={ov.enabled} onChange={e => setEnabled(e.target.checked)} />
          <span className="switch-track" />
          Enable single sign-on
          {ov.enabled && <span className="field-badge">set by .env</span>}
        </label>

        <div className="field-grid">
          <Field label="Issuer URL" overridden={ov.issuerUrl}>
            <input className="input" style={{ width: '100%' }} value={issuerUrl} disabled={ov.issuerUrl} onChange={e => setIssuerUrl(e.target.value)} />
          </Field>
          <Field
            label="Redirect URL"
            overridden={ov.redirectUrl}
            hint="Must end in /api/auth/oidc/callback and match the provider's allowed callback."
          >
            <input className="input" style={{ width: '100%' }} value={redirectUrl} disabled={ov.redirectUrl} placeholder="https://your-domain/api/auth/oidc/callback" onChange={e => setRedirectUrl(e.target.value)} />
          </Field>
          <Field label="Client ID" overridden={ov.clientId}>
            <input className="input" style={{ width: '100%' }} value={clientId} disabled={ov.clientId} onChange={e => setClientId(e.target.value)} />
          </Field>
          <Field label="Client secret" overridden={ov.clientSecret}>
            <PasswordInput
              placeholder={s.clientSecretSet ? '•••••••• (unchanged)' : ''}
              value={clientSecret} disabled={ov.clientSecret} onChange={e => setClientSecret(e.target.value)} />
          </Field>
          <Field label="Admin group" overridden={ov.adminGroup} info="Members of this group become administrators.">
            <input className="input" style={{ width: '100%' }} value={adminGroup} disabled={ov.adminGroup} onChange={e => setAdminGroup(e.target.value)} />
          </Field>
          <Field label="Scopes" overridden={ov.scopes} hint="Space-separated. Sensible defaults are used when empty.">
            <input className="input" style={{ width: '100%' }} value={scopes} disabled={ov.scopes} onChange={e => setScopes(e.target.value)} />
          </Field>
        </div>

        <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
          <input type="checkbox" checked={allowRegistration} disabled={ov.allowRegistration} onChange={e => setAllowRegistration(e.target.checked)} />
          <span className="switch-track" />
          Create an account on first successful sign-in
          {ov.allowRegistration && <span className="field-badge">set by .env</span>}
        </label>
      </SettingsCard>

      <SettingsCard title="Sign-in button" description="How the provider appears on the login screen.">
        <div className="field-grid">
          <Field label="Provider name" overridden={ov.providerName} hint="Shown as “Continue with …”.">
            <input className="input" style={{ width: '100%' }} value={providerName} disabled={ov.providerName} onChange={e => setProviderName(e.target.value)} />
          </Field>
          <Field label="Logo URL" overridden={ov.logoUrl} hint="Used in both themes unless a dark version is set.">
            <input className="input" style={{ width: '100%' }} value={logoUrl} disabled={ov.logoUrl} placeholder="https://example.com/logo.svg" onChange={e => setLogoUrl(e.target.value)} />
          </Field>
          <Field
            label="Logo URL — dark theme"
            overridden={ov.logoUrlDark}
            hint="Optional. Set this when the logo above is dark ink that disappears on the dark login card."
          >
            <input className="input" style={{ width: '100%' }} value={logoUrlDark} disabled={ov.logoUrlDark} placeholder="https://example.com/logo-light.svg" onChange={e => setLogoUrlDark(e.target.value)} />
          </Field>
        </div>
      </SettingsCard>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <StatusMsg msg={msg} />
      </div>
    </>
  )
}
