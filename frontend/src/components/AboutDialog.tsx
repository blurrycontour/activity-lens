import { useEffect, useState } from 'react'
import { X, ExternalLink, Copy, Check } from 'lucide-react'
import { loadAboutInfo, peekAboutInfo } from '../lib/buildInfo'
import { isNative } from '../lib/serverConfig'
import Logo from './Logo'
import Modal from './Modal'
import Skeleton from './Skeleton'

/** Fallback link when the build carries no source URL of its own. */
const REPO_URL = 'https://github.com/blurrycontour/activity-lens'

/** Short, readable rendering of an RFC 3339 build timestamp. */
function fmtBuildDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * "About this app" — name, what it is, and which build you are running. The
 * version is injected at build time from package.json (see vite.config.ts), so
 * it is the single fact worth quoting in a bug report.
 */
export default function AboutDialog({ onClose }: { onClose: () => void }) {
  /*
   * Warmed after sign-in, so this is nearly always already here and the dialog
   * opens at its final size. Only a dialog opened in the first moments of a
   * session waits, and then for one request rather than two.
   */
  const [info, setInfo] = useState(peekAboutInfo)
  const [copied, setCopied] = useState(false)
  const build = info?.build ?? null
  const appVersion = info?.appVersion ?? null
  // `info` being set is the settled signal: it is assigned once, whatever came
  // back, so placeholders cannot outlive a request that failed.
  const settled = info !== null

  useEffect(() => {
    if (info) return
    let cancelled = false
    void loadAboutInfo().then(i => { if (!cancelled) setInfo(i) })
    return () => { cancelled = true }
  }, [info])

  const sourceUrl = build?.source || REPO_URL

  /** Copies the facts a bug report needs in one go. */
  async function copyBuild() {
    const lines = [
      `Activity Lens ${build?.version ?? __APP_VERSION__}`,
      appVersion && `app ${appVersion}`,
      build?.revision && `commit ${build.revision}`,
      build?.created && `built ${build.created}`,
      build && `${build.platform} · ${build.goVersion}`,
      `ui ${__APP_VERSION__}`,
    ].filter(Boolean)
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal onClose={onClose} label="About Activity Lens">
        <div className="modal-box about-box">
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label="Close"
            style={{ position: 'absolute', top: 14, right: 14 }}
          >
            <X size={16} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            {/* The real logo, not a lucide stand-in: it is an inline SVG
                stroked with var(--primary), so it follows the accent the way
                the top bar and login marks do. */}
            <Logo size={48} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Activity Lens</h3>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Self-hosted training log
              </span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 4 }}>
            A self-hosted home for your training history. Import runs, rides, hikes and
            swims from .fit, .gpx or .tcx files, then see what the numbers actually say —
            trends, consistency, training load, gear wear, and personal bests. Your data
            stays on your own server.
          </p>

          {/* The server's rows keep their place while they load, so the dialog
              does not grow under the reader once the request lands. A request
              that fails drops them, exactly as before. */}
          <dl className="about-facts">
            {(build?.created || !settled) && (
              <><dt>Built</dt><dd>{build?.created ? fmtBuildDate(build.created) : <Skeleton width={104} />}</dd></>
            )}
            {(build?.revision || !settled) && (
              <><dt>Revision</dt><dd className="about-sha" title={build?.revision}>
                {build?.revision ? build.revision.slice(0, 16) : <Skeleton width={124} />}
              </dd></>
            )}
            {(build || !settled) && (
              <><dt>Server</dt><dd>{build ? `${build.goVersion} · ${build.platform}` : <Skeleton width={140} />}</dd></>
            )}
            <dt>Interface</dt><dd>React &amp; Vite</dd>
            {/* The server's version, not the bundle's. On web the two are the
                same build so it makes no difference, but in the Android app the
                bundle version is the APK's — which is the row below, and showing
                it twice under two labels said nothing. */}
            <dt>Version</dt><dd>{build?.version ?? (settled ? __APP_VERSION__ : <Skeleton width={56} />)}</dd>
            {/* Android only: the installed APK, which can legitimately lag the
                server. Closing that gap is what the in-app updater is for. */}
            {/* Reserved while loading on Android, where this row always
                arrives — otherwise a cold open grows by a row on the one
                platform that has it. */}
            {(appVersion || (!settled && isNative())) && (
              <><dt>App version</dt><dd>{appVersion ?? <Skeleton width={48} />}</dd></>
            )}
            {build?.licenses && (<><dt>Licence</dt><dd>{build.licenses}</dd></>)}
          </dl>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => void copyBuild()} style={{ flex: 1, justifyContent: 'center' }}>
              {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy build info</>}
            </button>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-ghost"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <ExternalLink size={15} /> Source
            </a>
          </div>
        </div>
    </Modal>
  )
}
