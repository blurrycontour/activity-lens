import { isNative } from './serverConfig'

/**
 * A rolling record of what the app has been complaining about, for attaching to
 * a feedback report.
 *
 * The problem this solves: the useful half of a bug report is the console, and
 * nobody reads their console. On a phone almost nobody *can* — the Android app
 * is a WebView with no devtools attached, so an error there is seen by no one at
 * all unless the user happens to be plugged into a laptop.
 *
 * So the console is recorded as it happens. Only warnings, errors and uncaught
 * failures: `console.log` is where routine chatter lives, and keeping it would
 * push the one message that mattered out of a bounded buffer.
 *
 * Nothing is sent anywhere by itself. The buffer sits in memory until a user
 * ticks the box on the feedback form, which is the only thing that ever reads
 * it — this is a diagnostic aid, not telemetry.
 */

/** How many entries to keep. Enough for a session's worth of real problems. */
const CAPACITY = 200

/** Longest single entry. One stack trace, not a serialised application state. */
const MAX_ENTRY = 2000

export interface LogEntry {
  /** ms since the page loaded, which is what matters for ordering. */
  at: number
  level: 'warn' | 'error'
  text: string
}

const entries: LogEntry[] = []

function record(level: LogEntry['level'], args: unknown[]) {
  const text = args.map(format).join(' ').slice(0, MAX_ENTRY)
  entries.push({ at: Math.round(performance.now()), level, text })
  if (entries.length > CAPACITY) entries.shift()
}

function format(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  try {
    return JSON.stringify(value)
  } catch {
    // Circular structures and anything with a throwing getter land here.
    return String(value)
  }
}

let installed = false

/**
 * Starts recording. Safe to call more than once.
 *
 * The original console methods are still called, so devtools behaves exactly as
 * it did — this observes, it does not replace.
 */
export function installDebugLog() {
  if (installed) return
  installed = true

  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      record(level, args)
      original(...args)
    }
  }

  window.addEventListener('error', e => {
    record('error', [e.message, `${e.filename}:${e.lineno}:${e.colno}`])
  })
  // Rejected promises nobody caught. These never reach console.error on their
  // own in every browser, and they are the most common shape of a real bug.
  window.addEventListener('unhandledrejection', e => {
    record('error', ['Unhandled rejection:', e.reason])
  })
}

/** Everything recorded so far, oldest first. */
export function debugLogEntries(): LogEntry[] {
  return entries.slice()
}

/**
 * The whole diagnostic bundle, as the JSON string the API stores.
 *
 * Deliberately narrow. It carries what is needed to reproduce a bug — build,
 * platform, screen, connectivity — and nothing that identifies the person: no
 * username, no email, no workout data. The account behind a report is already
 * known from the request, so repeating it here would add exposure and no
 * information.
 */
export function collectDiagnostics(): string {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string }
    deviceMemory?: number
  }
  return JSON.stringify({
    version: __APP_VERSION__,
    platform: isNative() ? 'android-app' : 'web',
    userAgent: navigator.userAgent,
    language: navigator.language,
    // Chart and map layout problems are almost always about one of these.
    screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
    connection: nav.connection?.effectiveType ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    at: new Date().toISOString(),
    logs: debugLogEntries(),
  }, null, 2)
}
