# Checking a change in a real browser

Occasionally a change has to be looked at rather than tested: a layout, a
floating element, or a flow that crosses two accounts. There is no end-to-end
suite here and no spec files — this is a throwaway script driving Chromium,
kept lean on purpose.

The one thing that *is* kept is [`scripts/visual/session.mjs`][session]: finding
the browser, sizing it like a phone, signing in and caching the session. That
was the part being rewritten every time.

[session]: https://github.com/blurrycontour/activity-lens/blob/main/scripts/visual/session.mjs

## When it is worth it

Worth it: a layout change, anything that floats over the page (a FAB has
covered a comment box before, and no unit test noticed), a two-account flow —
sharing, cloning, redaction — and any question of the form "does the *other*
person see this?".

Not worth it: logic. A filter predicate, a date bucket, a sort order — write a
Vitest case, it is faster and it stays.

## Setup

Playwright's Chromium lives in `~/.cache/ms-playwright`. Install the driver
somewhere scratch, never in this repo:

```bash
cd /tmp/scratch && npm i --no-save playwright-core
```

On a bare Debian the browser also needs its system libraries — without them it
exits with `error while loading shared libraries: libnspr4.so`:

```bash
sudo npx playwright install-deps chromium     # or: apt install libnss3 libnspr4 libasound2
```

Point at whichever server suits: `:9090` for the deployed local instance,
`pnpm dev` (`:5173`) while a layout is still moving, or `pnpm preview` (`:4173`)
for the production bundle with its service worker. Over plain HTTP the backend
needs `AL_SECURE_COOKIES=false`, or sign-in silently drops the cookie — see
[setup](setup.md).

## The pattern

The credentials come from the environment, so nothing is written down:

```bash
set -a && . .env && set +a
AL_USER="$AL_ADMIN_USER" AL_PASS="$AL_ADMIN_PASS" node check.mjs
```

```js
import { open, tree, close, BASE, DESKTOP } from '<repo>/scripts/visual/session.mjs'

const { page } = await open()                    // admin, 390×844
await page.goto(BASE + '/plans')

// The accessibility tree: roles and names, as text.
console.log(await tree(page, '.page-content'))

// Geometry, when the question is about position rather than content.
const box = await page.locator('.view-switch').boundingBox()
console.log('right edge:', box.x + box.width, 'of 390')

await close()
```

Two accounts is two `open()` calls in one script, not two runs:

```js
const { page: owner } = await open()
const { page: viewer } = await open({ user: 'bob', pass: '…' })
```

Sessions are cached under `/tmp/al-visual/`, so only the first run logs in.
Delete that directory if a password changes.

## Ask the accessibility tree, not a screenshot

`tree(page, sel)` returns Playwright's aria snapshot — the browser's
accessibility object model as YAML. It is what a screen reader would announce,
which is very close to what you actually want to verify:

```yaml
- heading "Push Day" [level=1]
- button "Clone"
- link "By admin"
- heading "Discussion" [level=3]
- textbox "Write a comment…"
```

That answers most questions outright — is the Clone button there, is the
byline attributed to the right person, is the Notes panel **absent** for a
viewer — for a few hundred tokens, and unlike an image it diffs, so two
accounts' trees can be compared directly. Scope it to a container; a whole page
including the nav is mostly noise.

It cannot answer geometry. "Is the FAB covering the composer" and "does this
card grid wrap" are pixels, and for those there is `boundingBox()` first and a
screenshot only if that is not enough.

## If a screenshot really is needed

An image costs 1–2k tokens; a tree costs a few hundred. So:

- clip to the element — `locator.screenshot()`, not `page.screenshot()`;
- stay at phone width, which is where layouts break anyway;
- never `fullPage: true` unless the question is about scroll length;
- write several, read one or two — writing is free, reading is not;
- don't pipe `page.content()` or raw console output anywhere.

Clean up the scratch directory when done, and check `git status` before
committing — no scripts, no PNGs, no `playwright-core` in the repo.
