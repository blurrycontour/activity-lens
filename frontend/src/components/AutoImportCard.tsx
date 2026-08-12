import { useEffect, useState } from 'react'
import { BatteryWarning, FolderDown, FolderPlus, Folder, RefreshCw, RotateCcw, X } from 'lucide-react'
import {
  folderSyncStatus, onScanProgress, pickSyncFolder, removeSyncFolder, requestBatteryExemption,
  scanFolderNow, setFolderSyncEnabled, setFolderSyncInterval,
  type FolderSyncStatus, type ScanProgress, type WatchedFolder,
} from '../lib/native/folderSync'
import Field from './Field'
import Dropdown, { type DropdownOption } from './Dropdown'

/**
 * How often to check.
 *
 * This is the mechanism, not a fallback. Android can also start the app the
 * moment a folder changes, but only when the folder's provider announces the
 * change — which it does not for a file another app wrote straight to storage,
 * the usual case here. Fifteen minutes is the shortest the OS allows.
 */
const INTERVALS: DropdownOption<number>[] = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Hourly' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Daily' },
]

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

/** The second line of a folder row: how its last scan went, and when. */
function folderStatus(folder: WatchedFolder): string {
  if (!folder.readable) return 'Cannot be read any more'
  const when = ago(folder.lastScan)
  if (!when) return 'Not checked yet'
  return folder.lastResult ? `${folder.lastResult} · ${when}` : `Checked ${when}`
}

/** Which action is running, so only that control shows a spinner. */
type Pending = 'choose' | 'scan' | 'rescan' | 'settings' | null

/**
 * Auto-import: watching folders for new workout files.
 *
 * Android only, and it says so by simply not existing anywhere else — a browser
 * cannot watch a directory, and the API that comes closest is desktop Chrome
 * only and cannot run in the background at all.
 *
 * Folders are chosen through the system picker, which grants access to that one
 * directory. There is no permission prompt because there is no permission: the
 * app can read the folders you picked and nothing else on the phone.
 */
export default function AutoImportCard() {
  const [status, setStatus] = useState<FolderSyncStatus | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  /** Live counts from the scan in progress, or null when none is running. */
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const busy = pending !== null

  useEffect(() => {
    let active = true
    void folderSyncStatus().then(s => { if (active) setStatus(s) })
    return () => { active = false }
  }, [])

  async function run(what: Exclude<Pending, null>, action: () => Promise<void>) {
    setPending(what)
    setMsg(null)
    try {
      await action()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' })
    } finally {
      setStatus(await folderSyncStatus())
      setPending(null)
    }
  }

  const choose = () => run('choose', async () => {
    const folder = await pickSyncFolder()
    // Choosing a folder is the whole point of the interaction, so it turns the
    // watch on rather than leaving a second switch to find.
    if (folder) await setFolderSyncEnabled(true)
  })

  const scan = (force = false) => run(force ? 'rescan' : 'scan', async () => {
    // Subscribed for the duration of this scan only. A listener that outlived
    // it would leave the bar showing the last scan's numbers next time, before
    // the first event of the new one arrived.
    setProgress(null)
    const stop = onScanProgress(setProgress)
    try {
      const result = await scanFolderNow(force)
      setMsg({
        ok: result.ok,
        text: result.imported > 0
          ? `Imported ${result.imported} workout${result.imported === 1 ? '' : 's'}.`
          : result.message,
      })
    } finally {
      stop()
      setProgress(null)
    }
  })

  // Resolves with the state read back after the dialog, so `run` refreshing the
  // status is what updates the UI — the same path every other action takes.
  const allowBackground = () => run('settings', async () => { await requestBatteryExemption() })

  // Removing the last folder turns the watch off natively, so nothing here has
  // to keep the switch and the list agreeing.
  const remove = (folder: WatchedFolder) => run('settings', () => removeSyncFolder(folder.uri))

  const folders = status?.folders ?? []
  const full = folders.length >= (status?.maxFolders ?? 8)

  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 4 }}>
        <FolderDown size={15} /> Auto import
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
        Imports new workout files from folders on this phone, so a watch or recording app that
        saves here lands in your library on its own.
      </p>

      {folders.length > 0 && (
        <ul className="folder-list">
          {folders.map(folder => (
            <li className="folder-row" key={folder.uri}>
              <Folder size={15} className="folder-row-icon" />
              <div className="folder-row-text">
                <span className="folder-row-name">{folder.label}</span>
                <span className={`folder-row-status${folder.readable ? '' : ' bad'}`}>
                  {folderStatus(folder)}
                </span>
              </div>
              <button
                className="folder-row-remove"
                disabled={busy}
                onClick={() => void remove(folder)}
                title={`Stop watching ${folder.label}`}
                aria-label={`Stop watching ${folder.label}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="btn btn-ghost" disabled={busy || full} onClick={choose}>
        <FolderPlus size={15} /> {folders.length > 0 ? 'Add another folder' : 'Choose a folder'}
      </button>
      {full && (
        <p className="field-hint" style={{ marginTop: 8 }}>
          That is as many folders as can be watched at once.
        </p>
      )}

      {folders.length > 0 && (
        <>
          <label className="switch" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginTop: 16 }}>
            <input
              type="checkbox"
              checked={status?.enabled ?? false}
              disabled={busy}
              onChange={e => void run('settings', () => setFolderSyncEnabled(e.target.checked))}
            />
            <span className="switch-track" />
            Import new files automatically
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
            Checks on a schedule, and sooner when Android notices the change itself. Needs a
            network, and the phone decides the exact moment.
          </p>

          {status?.enabled && !status.batteryUnrestricted && (
            <div className="autoimport-nudge">
              <BatteryWarning size={15} style={{ flexShrink: 0, color: 'var(--warning)' }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
                  Android is limiting this app in the background, so imports may be delayed for
                  hours.
                </p>
                <button className="btn btn-ghost" disabled={busy} onClick={allowBackground}>
                  Allow background activity
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <Field label="Check every" hint="This phone only. Android may run it later to save battery.">
              <div style={{ maxWidth: 200 }}>
                <Dropdown
                  block
                  value={status?.intervalMinutes ?? 15}
                  options={INTERVALS}
                  disabled={busy || !status?.enabled}
                  onChange={v => void run('settings', () => setFolderSyncInterval(v))}
                  ariaLabel="How often to check the folders"
                />
              </div>
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => scan()}>
              <RefreshCw size={15} className={pending === 'scan' ? 'spin' : undefined} />
              {pending === 'scan' ? 'Scanning…' : 'Scan now'}
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => scan(true)}
              title="Re-check every file, including ones already imported before"
            >
              {/* Counter-clockwise glyph, so it spins the way it points. */}
              <RotateCcw size={15} className={pending === 'rescan' ? 'spin-reverse' : undefined} />
              {pending === 'rescan' ? 'Rescanning…' : 'Full rescan'}
            </button>
          </div>

          {/* Only once the scan says how much there is. A bar that appears
              empty and instantly vanishes on a folder with nothing new is
              worse than no bar, and the first event does not arrive until the
              folder has been listed. */}
          {progress && progress.total > 0 && (
            <div className="scan-progress" role="status" aria-live="polite">
              <div className="scan-progress-head">
                <span>{progress.phase === 'read' ? 'Reading files' : 'Uploading'}</span>
                <span className="scan-progress-count">
                  {progress.done} / {progress.total}
                  {' · '}
                  {Math.round((progress.done / progress.total) * 100)}%
                </span>
              </div>
              {/* A native <progress> would be quicker to write and impossible
                  to theme consistently — its appearance is drawn by the OS on
                  Android and ignores every colour token here. */}
              <div className="scan-progress-track">
                <div
                  className="scan-progress-fill"
                  style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}

      {msg && (
        <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--primary)' : 'var(--danger)' }}>{msg.text}</p>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.5 }}>
        Reads <code>.gpx</code> and <code>.tcx</code>, including <code>.gz</code>, at the top level
        of each folder. A file already in your library is never imported twice; a{' '}
        <strong>full rescan</strong> offers every file again, which is how a workout you deleted
        comes back.
      </p>
    </section>
  )
}
