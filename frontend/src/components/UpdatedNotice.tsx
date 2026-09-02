import { useEffect, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import Modal from './Modal'
import { canSelfUpdate, installedApp } from '../lib/native/appUpdate'

/** The app version last seen running, so an update can be told from a reopen. */
const VERSION_KEY = 'al_installed_version'

/**
 * A one-time "app updated" confirmation, shown after an in-place Android update.
 *
 * Robust against the two cases it must stay quiet for. A fresh install has no
 * recorded version, so it records the current one silently. A plain reopen has
 * the same version already recorded, so there is nothing to announce. Only a
 * launch whose version differs from the one last seen — an update that has just
 * replaced the app in place, keeping its stored data — shows the notice.
 *
 * Native only: the web app has no APK version to move between, and updates by
 * being reloaded.
 */
export default function UpdatedNotice() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!canSelfUpdate()) return
    let cancelled = false
    installedApp().then(info => {
      if (cancelled || !info.version) return
      const prev = localStorage.getItem(VERSION_KEY)
      localStorage.setItem(VERSION_KEY, info.version)
      if (prev && prev !== info.version) setVersion(info.version)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!version) return null
  const close = () => setVersion(null)
  return (
    <Modal dismissable onClose={close} label="App updated">
      <div className="modal-box" style={{ maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius)', flexShrink: 0,
            background: 'var(--bg-3)', display: 'grid', placeItems: 'center', color: 'var(--success)',
          }}>
            <ShieldCheck size={17} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>App updated</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.5 }}>
              You&rsquo;re now on version <span style={{ fontFamily: 'var(--font-mono)' }}>{version}</span>,
              matching the server this app is connected to.
            </p>
          </div>
          <button className="btn-icon" onClick={close} aria-label="Close"><X size={15} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={close}>Done</button>
        </div>
      </div>
    </Modal>
  )
}
