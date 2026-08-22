/**
 * A signed-in browser, without rewriting the login every time.
 *
 * Visual checks are occasional here — a layout change, a floating element, a
 * two-account flow — so there is no test framework and no spec files. But the
 * boring half is the same every time: find the browser, size it like a phone,
 * sign in, and keep the session so the next run does not. That half lives here.
 *
 * Usage (from anywhere, with playwright-core installed in the scratchpad):
 *
 *   import { open, close } from '<repo>/scripts/visual/session.mjs'
 *   const { page } = await open()               // admin, phone-sized
 *   await page.goto(BASE + '/plans')
 *   console.log(await tree(page, '.page-content'))
 *   await close()
 *
 * See docs/dev/visual-verification.md for the whole approach, and in
 * particular for why the answer is usually text rather than a screenshot.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where storage states are cached — outside the repo, so nothing can be committed. */
const STATE_DIR = join(tmpdir(), 'al-visual')

export const BASE = process.env.AL_BASE ?? 'http://localhost:9090'
export const PHONE = { width: 390, height: 844 }
export const DESKTOP = { width: 1280, height: 900 }

/** The Chromium Playwright already downloaded, whichever build is present. */
function browserPath() {
  const root = join(homedir(), '.cache', 'ms-playwright')
  const dir = readdirSync(root).find(d => d.startsWith('chromium-'))
  if (!dir) throw new Error(`no chromium in ${root} — run: pnpm dlx playwright install chromium`)
  return join(root, dir, 'chrome-linux64', 'chrome')
}

let browser = null

/**
 * A page signed in as `user`, reusing a saved session when there is one.
 *
 * Two accounts is two calls — `open()` and `open({ user: 'bob', pass: … })` —
 * each with its own context, in one script rather than two runs.
 */
export async function open({ user = 'admin', pass = process.env.AL_PASS ?? 'devpassword', viewport = PHONE } = {}) {
  // Resolved from the caller's directory, not this file's: playwright-core is
  // deliberately not a dependency of this repo, it is installed in whatever
  // scratch directory the check is being run from.
  const { chromium } = createRequire(join(process.cwd(), 'noop.js'))('playwright-core')
  browser ??= await chromium.launch({ executablePath: browserPath() })

  mkdirSync(STATE_DIR, { recursive: true })
  const statePath = join(STATE_DIR, `${user}.json`)
  const ctx = await browser.newContext({
    viewport,
    storageState: existsSync(statePath) ? statePath : undefined,
  })
  const page = await ctx.newPage()

  await page.goto(BASE + '/')
  // A saved session that has expired lands back on the login form, so the
  // check is what is on screen rather than whether the file existed.
  if (await page.locator('input[name="identifier"]').isVisible().catch(() => false)) {
    await page.fill('input[name="identifier"]', user)
    await page.fill('input[name="password"]', pass)
    await page.click('button[type="submit"]')
    await page.waitForSelector('input[name="identifier"]', { state: 'detached', timeout: 15000 })
    await ctx.storageState({ path: statePath })
  }
  return { ctx, page }
}

/**
 * The accessibility tree under `selector`, as YAML — roles and names, no
 * markup, no styling.
 *
 * This is the cheap answer to almost every question worth asking: what is on
 * this screen, in what order, and is the thing that should not be there
 * absent. A few hundred tokens instead of a picture's few thousand, and it
 * diffs, which a picture does not.
 */
export async function tree(page, selector = 'body') {
  return await page.locator(selector).ariaSnapshot()
}

export async function close() {
  await browser?.close()
  browser = null
}
