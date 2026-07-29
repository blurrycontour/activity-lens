import { useEffect, useState } from 'react'
import { X, ExternalLink, Copy, Check } from 'lucide-react'
import { api, type BuildInfo } from '../lib/api'
import Logo from './Logo'

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
  const [build, setBuild] = useState<BuildInfo | null>(null)
  const [copied, setCopied] = useState(false)

  // The frontend knows its own version at compile time, but everything else —
  // commit, build date, licence — is baked into the server binary, so it has
  // to be asked for. A failure just leaves those rows out.
  useEffect(() => {
    let cancelled = false
    api.buildInfo().then(b => { if (!cancelled) setBuild(b) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const sourceUrl = build?.source || REPO_URL

  /** Copies the facts a bug report needs in one go. */
  async function copyBuild() {
    const lines = [
      `Activity Lens ${build?.version ?? __APP_VERSION__}`,
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
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
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
            {/* The real logo, not a lucide stand-in: it is an inline SVG whose
                tile is painted with var(--primary), so it follows the accent
                the way the sidebar and login marks do. */}
            <Logo size={48} radius={14} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Activity Lens</h3>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                v{build?.version ?? __APP_VERSION__}
              </span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 4 }}>
            A self-hosted home for your training history. Import runs, rides, hikes and
            swims from .gpx or .tcx files, then see what the numbers actually say —
            trends, consistency, training load, gear wear, and personal bests. Your data
            stays on your own server.
          </p>

          <dl className="about-facts">
            {build?.created && (<><dt>Built</dt><dd>{fmtBuildDate(build.created)}</dd></>)}
            {build?.revision && (
              <><dt>Revision</dt><dd className="about-sha" title={build.revision}>{build.revision.slice(0, 16)}</dd></>
            )}
            {build && (<><dt>Server</dt><dd>{build.goVersion} · {build.platform}</dd></>)}
            <dt>Interface</dt><dd>React &amp; Vite</dd>
            <dt>Version</dt><dd>{__APP_VERSION__}</dd>
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
      </div>
    </>
  )
}
