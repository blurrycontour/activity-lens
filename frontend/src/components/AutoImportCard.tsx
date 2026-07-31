import { useEffect, useState } from 'react'
import { FolderDown, FolderSearch, RefreshCw } from 'lucide-react'
import {
  disableFolderSync, folderSyncStatus, pickSyncFolder, scanFolderNow, setFolderSyncEnabled,
  type FolderSyncStatus,
} from '../lib/native/folderSync'

/** "3m ago", or nothing at all when it has never run. */
function ago(millis: number): string | null {
  if (!millis) return null
  const mins = Math.floor((Date.now() - millis) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Auto-import: watching a folder for new workout files.
 *
 * Android only, and it says so by simply not existing anywhere else — a browser
 * cannot watch a directory, and the API that comes closest is desktop Chrome
 * only and cannot run in the background at all.
 *
 * The folder is chosen through the system picker, which grants access to that
 * one directory. There is no permission prompt because there is no permission:
 * the app can read the folder you picked and nothing else on the phone.
 */
export default function AutoImportCard() {
  const [status, setStatus] = useState<FolderSyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void folderSyncStatus().then(s => { if (active) setStatus(s) })
    return () => { active = false }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMsg(null)
    try {
      await action()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setStatus(await folderSyncStatus())
      setBusy(false)
    }
  }

  const choose = () => run(async () => {
    const folder = await pickSyncFolder()
    // Choosing a folder is the whole point of the interaction, so it turns the
    // watch on rather than leaving a second switch to find.
    if (folder) await setFolderSyncEnabled(true)
  })

  const scan = () => run(async () => {
    const result = await scanFolderNow()
    setMsg({
      ok: result.ok,
      text: result.imported > 0
        ? `Imported ${result.imported} workout${result.imported === 1 ? '' : 's'}.`
        : result.message,
    })
  })

  const watching = Boolean(status?.folder)

  return (
    <section className="card">
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <FolderDown size={15} /> Auto import
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
        Watches a folder on this phone and imports any new workout files it finds, so a watch
        or a recording app that saves here lands in your library on its own.
      </p>

      {!watching ? (
        <button className="btn btn-ghost" disabled={busy} onClick={choose}>
          <FolderSearch size={15} /> Choose a folder
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <FolderSearch size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {status?.folder}
            </span>
          </div>

          {status && !status.readable && (
            <p style={{ fontSize: 11, color: '#ef4444', marginBottom: 12, lineHeight: 1.5 }}>
              This folder can no longer be read. If it was on an SD card or in a cloud app,
              choose it again.
            </p>
          )}

          <label className="switch" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={status?.enabled ?? false}
              disabled={busy}
              onChange={e => void run(() => setFolderSyncEnabled(e.target.checked))}
            />
            <span className="switch-track" />
            Check for new files automatically
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
            About every 15 minutes, when the phone has a network. Android decides exactly when,
            so a file may take a little longer to appear — it will not be missed. You get a
            notification when something is imported.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" disabled={busy} onClick={scan}>
              <RefreshCw size={15} /> Scan now
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => run(disableFolderSync)}>
              Stop watching
            </button>
          </div>

          {status?.lastScan ? (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 12 }}>
              Last checked {ago(status.lastScan)}
              {status.lastResult ? ` · ${status.lastResult}` : ''}
            </p>
          ) : null}
        </>
      )}

      {msg && (
        <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--primary)' : '#ef4444' }}>{msg.text}</p>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.5 }}>
        Imports <code>.gpx</code> and <code>.tcx</code> files, including <code>.gz</code>
        {' '}compressed ones. Anything else in the folder is left alone, and a file already in
        your library is never imported twice.
      </p>
    </section>
  )
}
