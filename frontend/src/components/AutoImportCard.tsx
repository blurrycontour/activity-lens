import { useEffect, useState } from 'react'
import { BatteryWarning, FolderDown, FolderSearch, RefreshCw, RotateCcw } from 'lucide-react'
import {
  disableFolderSync, folderSyncStatus, pickSyncFolder, requestBatteryExemption, scanFolderNow,
  setFolderSyncEnabled, setFolderSyncInterval, type FolderSyncStatus,
} from '../lib/native/folderSync'
import Field from './Field'
import Dropdown, { type DropdownOption } from './Dropdown'

/**
 * How often the backstop sweep runs.
 *
 * Not how soon a file imports — Android starts the watch when the folder
 * changes, so that is a matter of seconds. This only catches what a change
 * notification cannot: a file that arrived while the phone was off, and folders
 * whose provider never announces its changes at all.
 *
 * The short intervals the old polling watch needed are gone. Quarter-hourly is
 * ninety-six wake-ups a day to answer a question the OS now answers for free,
 * and keeping the option would invite exactly that.
 */
const INTERVALS = [
  { minutes: 60, label: 'Hourly' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 1440, label: 'Daily' },
]

const INTERVAL_OPTIONS: DropdownOption<number>[] =
  INTERVALS.map(i => ({ value: i.minutes, label: i.label }))

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
/** Which action is running, so only that button shows a spinner. */
type Pending = 'choose' | 'scan' | 'rescan' | 'stop' | 'settings' | null

export default function AutoImportCard() {
  const [status, setStatus] = useState<FolderSyncStatus | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
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
    const result = await scanFolderNow(force)
    setMsg({
      ok: result.ok,
      text: result.imported > 0
        ? `Imported ${result.imported} workout${result.imported === 1 ? '' : 's'}.`
        : result.message,
    })
  })

  // Resolves with the state read back after the dialog, so `run` refreshing the
  // status is what updates the UI — the same path every other action takes.
  const allowBackground = () => run('settings', async () => { await requestBatteryExemption() })

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
            <p style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 12, lineHeight: 1.5 }}>
              This folder can no longer be read. If it was on an SD card or in a cloud app,
              choose it again.
            </p>
          )}

          <label className="switch" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={status?.enabled ?? false}
              disabled={busy}
              onChange={e => void run('settings', () => setFolderSyncEnabled(e.target.checked))}
            />
            <span className="switch-track" />
            Check for new files automatically
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
            Android wakes the app when the folder changes, so a new file usually imports within
            a minute. It needs a network, and the phone decides the exact moment. You get a
            notification when something is imported.
          </p>

          {status && status.enabled && !status.batteryUnrestricted && (
            <div className="autoimport-nudge">
              <BatteryWarning size={15} style={{ flexShrink: 0, color: 'var(--warning)' }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
                  Android is limiting this app in the background, so imports may be delayed by
                  hours or wait until you next open the app. Allowing it to run in the
                  background is what makes them arrive when the file does.
                </p>
                <button className="btn btn-ghost" disabled={busy} onClick={allowBackground}>
                  Allow background activity
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <Field
              label="Also check every"
              hint="A sweep for anything the folder never announced — files that arrived while the phone was off, mostly. This phone only; it is not shared with your other devices."
            >
              <div style={{ maxWidth: 220 }}>
                <Dropdown
                  block
                  value={status?.intervalMinutes ?? 15}
                  options={INTERVAL_OPTIONS}
                  disabled={busy || !status?.enabled}
                  onChange={v => void run('settings', () => setFolderSyncInterval(v))}
                  ariaLabel="How often to sweep the folder"
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
            <button className="btn btn-ghost" disabled={busy} onClick={() => run('stop', disableFolderSync)}>
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
        <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--primary)' : 'var(--danger)' }}>{msg.text}</p>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.5 }}>
        Imports <code>.gpx</code> and <code>.tcx</code> files, including <code>.gz</code>
        {' '}compressed ones. Anything else in the folder is left alone, and a file already in
        your library is never imported twice. A <strong>full rescan</strong> offers every file
        again, which is how a workout you deleted comes back.
      </p>
    </section>
  )
}
