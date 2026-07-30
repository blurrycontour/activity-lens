import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Download, ShieldCheck, X } from 'lucide-react'
import { api } from '../lib/api'
import {
  canSelfUpdate, downloadAndInstall, installedApp, INSTALL_NOT_PERMITTED,
  onUpdateProgress, openInstallSettings, updateAvailable, UPDATE_CHECK_EVENT,
  type UpdateProgress,
} from '../lib/native/appUpdate'

/**
 * When a dismissed version may be offered again.
 *
 * "Not now" snoozes rather than silences. A version dismissed forever is a
 * version the user can never be reminded of — and the reason to dismiss is
 * usually "not while I am about to go for a run", not "never mention this
 * again". A day later is a different moment.
 */
const SNOOZE_KEY = 'al_update_snoozed'
const SNOOZE_MS = 24 * 60 * 60 * 1000

/**
 * How long to leave between checks made on *resume*.
 *
 * Coming back to the foreground happens many times a day, most of them seconds
 * apart as the user switches to a music app and back mid-run. Launching the app
 * does not, so a launch always checks: it is one small request, and it is the
 * moment someone is most receptive to being told about an update.
 */
const RESUME_INTERVAL_MS = 6 * 60 * 60 * 1000
const LAST_CHECK_KEY = 'al_update_checked_at'

type Stage = 'offer' | 'working' | 'needs-permission' | 'failed'

function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * Offers the app build this server publishes, and installs it in place.
 *
 * Only ever rendered in the Android app. The web app updates itself by being
 * reloaded, and the PWA already has the service worker's update toast.
 *
 * The version offered is the server's own, so this is not "is there a newer
 * release on GitHub" but "does this app match the instance it is talking to".
 * That is what keeps a client from running ahead of a server that has not been
 * upgraded yet.
 */
export default function UpdatePrompt() {
  const [offered, setOffered] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('offer')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listener = useRef<{ remove: () => void } | null>(null)

  useEffect(() => {
    if (!canSelfUpdate()) return
    let cancelled = false

    /** Whether this version is still inside its "not now" window. */
    function snoozed(version: string): boolean {
      try {
        const raw = localStorage.getItem(SNOOZE_KEY)
        if (!raw) return false
        const { version: v, until } = JSON.parse(raw) as { version: string; until: number }
        return v === version && Date.now() < until
      } catch {
        return false
      }
    }

    /**
     * @param reason 'launch'  always checks — the app just started.
     *               'resume'  rate-limited; the app came back to the foreground.
     *               'manual'  checks and shows even a snoozed version, because
     *                         saying nothing to someone who just tapped "check
     *                         for updates" looks broken.
     */
    async function check(reason: 'launch' | 'resume' | 'manual') {
      if (reason === 'resume') {
        const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0)
        if (Date.now() - last < RESUME_INTERVAL_MS) return
      }
      try {
        const [app, current] = await Promise.all([api.androidApp(), installedApp()])
        localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
        if (cancelled || !app.available || !app.version) return
        if (!updateAvailable(current.version, app.version)) return
        if (reason !== 'manual' && snoozed(app.version)) return
        setStage('offer')
        setOffered(app.version)
      } catch {
        // An unreachable server, or one too old to have the endpoint. Checking
        // for updates is never worth interrupting the app over.
      }
    }

    void check('launch')

    // Coming back to the app is when a check is both cheapest and most likely
    // to find something: the server may have been upgraded while the phone was
    // in a pocket. visibilitychange rather than a Capacitor resume listener —
    // it is the same signal, already available, and one less dependency.
    function onVisible() {
      if (document.visibilityState === 'visible') void check('resume')
    }
    function onRequested() {
      void check('manual')
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(UPDATE_CHECK_EVENT, onRequested)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(UPDATE_CHECK_EVENT, onRequested)
    }
  }, [])

  // The listener is attached only while an install is running, and removed on
  // unmount — a stale one would keep a dead component's setState alive.
  useEffect(() => () => listener.current?.remove(), [])

  async function install() {
    setStage('working')
    setProgress(null)
    setError(null)
    listener.current = await onUpdateProgress(setProgress)
    try {
      await downloadAndInstall()
      // Success rarely returns: installing over the running app stops this
      // process. If it does come back, the update is done and the dialog has
      // nothing left to say.
      setOffered(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes(INSTALL_NOT_PERMITTED)) {
        setStage('needs-permission')
      } else {
        setError(message)
        setStage('failed')
      }
    } finally {
      listener.current?.remove()
      listener.current = null
    }
  }

  function dismiss() {
    if (offered) {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: offered, until: Date.now() + SNOOZE_MS }))
    }
    setOffered(null)
  }

  if (!offered) return null

  const busy = stage === 'working'
  const pct = progress && progress.total > 0
    ? Math.round((progress.bytes / progress.total) * 100)
    : null

  return (
    <>
      {/* No click-to-dismiss on the overlay: the dialog is dismissible by its
          own controls, and a stray tap during a download would be expensive. */}
      <div className="overlay" />
      <div className="modal" role="dialog" aria-modal="true" aria-label="App update">
      <div className="modal-box" style={{ maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius)', flexShrink: 0,
            background: 'var(--bg-3)', display: 'grid', placeItems: 'center', color: 'var(--primary)',
          }}>
            <Download size={17} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>Update available</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.5 }}>
              Version <span style={{ fontFamily: 'var(--font-mono)' }}>{offered}</span> matches
              this server. Updating keeps the app and your instance in step.
            </p>
          </div>
          {!busy && (
            <button className="btn-icon" onClick={dismiss} aria-label="Not now"><X size={15} /></button>
          )}
        </div>

        {stage === 'needs-permission' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 14 }}>
            <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--primary)' }} />
            <span>
              Android needs your permission for this app to install updates. Allow
              it on the next screen, then tap Update again.
            </span>
          </div>
        )}

        {stage === 'failed' && error && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: '#ef4444', lineHeight: 1.5, marginBottom: 14 }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {busy && (
          <div style={{ marginBottom: 14 }}>
            {/* An indeterminate bar when the server sent no length: a bar stuck
                at 0% reads as a hang, which is what makes people leave. */}
            <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-3)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: pct === null ? '100%' : `${pct}%`,
                background: 'var(--primary)',
                borderRadius: 99,
                transition: 'width 0.2s linear',
                opacity: pct === null ? 0.4 : 1,
              }} />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginTop: 7,
              fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
            }}>
              <span>
                {progress?.phase === 'install' ? 'Installing…' : 'Downloading…'}
              </span>
              <span>
                {progress && progress.total > 0
                  ? `${formatMB(progress.bytes)} / ${formatMB(progress.total)}`
                  : progress ? formatMB(progress.bytes) : ''}
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.5 }}>
              Keep this screen open until Android asks you to confirm.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {!busy && (
            <button className="btn btn-ghost" onClick={dismiss}>Not now</button>
          )}
          {stage === 'needs-permission' ? (
            <button className="btn btn-primary" onClick={() => { void openInstallSettings(); setStage('offer') }}>
              Open settings
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void install()} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Updating…' : stage === 'failed' ? 'Try again' : 'Update'}
            </button>
          )}
        </div>
      </div>
      </div>
    </>
  )
}
