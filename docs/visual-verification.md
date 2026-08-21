# Visual verification with Playwright

How an agent (or a person) drives the real app in a real browser to check that a
UI change looks and behaves the way it was meant to — and how to do it without
burning a small fortune in tokens.

This is deliberately *not* a test suite. There are no spec files, nothing runs
in CI, and nothing here is committed. It is a throwaway script used to answer
one question — "does this actually work on a phone-width screen?" — and then
deleted. Unit tests answer *is the logic right*; this answers *is it on the
screen, in the right place, reachable by a thumb*.

## When it is worth doing

Worth it:

- a layout change (a new list variant, a header cluster, a bottom sheet),
- anything with a fixed or floating element — a FAB has covered a composer
  before, and no unit test noticed,
- a flow that crosses two accounts (sharing, cloning, redaction),
- anything where the question is "does the *other* person see this?".

Not worth it:

- pure logic — a filter predicate, a date bucket, a sort. Write a vitest case
  instead; it is faster, cheaper, and it stays.
- something a type error would already have caught.

## Setup

The Playwright browsers are already downloaded in `~/.cache/ms-playwright`
(`chromium-*/chrome-linux64/chrome`). Only the driver is missing, and it stays
missing on purpose — `playwright-core` is not a dependency of this project and
must not end up in `frontend/package.json`.

```bash
cd /tmp/claude-.../scratchpad          # the session scratchpad, never the repo
pnpm add playwright-core --prefix .    # or: npm i --no-save playwright-core
```

Delete the directory when finished. If it was installed inside `frontend/`
by mistake, `git checkout frontend/package.json frontend/pnpm-lock.yaml` and
remove `node_modules/playwright-core`.

## Which server to point at

| Target | Use it for |
|---|---|
| `http://localhost:9090` | the deployed local instance — real data, real service worker. Read-only checks and anything already shipped. |
| `pnpm build && pnpm preview` (`:4173`) + local backend | a change that is not deployed yet. The production bundle, so the service worker and code-splitting behave as they will. |
| `pnpm dev` (`:5173`) | fast iteration while the layout is still moving. |

Logging in over plain HTTP needs `AL_SECURE_COOKIES=false` on the backend — see
[development.md](development.md); without it login returns 200 and the browser
silently drops the cookie.

## The pattern

One `.mjs` file in the scratchpad that walks the whole flow and writes numbered
screenshots. Run it once, then look at only the shots that answer the question.

```js
import { chromium } from 'playwright-core'

const BROWSER = process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const BASE = 'http://localhost:9090'

const browser = await chromium.launch({ executablePath: BROWSER })

// A phone, because that is the width things break at. 390x844 is an iPhone 14.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

await page.goto(BASE + '/login')
// The sign-in form takes a username or an email in one field.
await page.fill('input[name="identifier"]', 'admin')
await page.fill('input[name="password"]', 'devpassword')
await page.click('button[type="submit"]')
await page.waitForURL(/\/(dashboard|workouts)?$/)

// Keep the session, so the next run skips the login entirely.
await ctx.storageState({ path: 'auth.json' })

await page.goto(BASE + '/plans')
await page.click('[aria-label="Card view"]')
await page.waitForTimeout(200)

// Print the cheap facts. Text costs ~nothing; a picture costs ~1.5k tokens.
console.log('cards:', await page.locator('.plan-grid .plan-card').count())
console.log('fab visible:', await page.locator('.fab').isVisible())

// Clip to the thing under test, not the whole page.
await page.locator('.plan-grid').screenshot({ path: '01-plan-cards.png' })

await browser.close()
```

Then, and only then, read `01-plan-cards.png`.

Two accounts (sharing, redaction) means two contexts in the same script — one
per user — not two runs:

```js
const owner = await browser.newContext({ storageState: 'admin.json', viewport: PHONE })
const viewer = await browser.newContext({ storageState: 'bob.json', viewport: PHONE })
```

The useful assertion in those flows is usually a *negative* one: the viewer must
**not** see the Notes panel, the options menu, the Start button. `expect
(locator).toHaveCount(0)` printed as text is worth more than a screenshot of an
absence.

## Keeping the token cost down

A screenshot is an image, and an image is tokenized by its dimensions — roughly
1–2k tokens for a phone-width shot, more for a desktop one. A ten-screenshot
session costs more than the whole code change did. The rules that matter, in
order of how much they save:

1. **Ask in text first.** `count()`, `isVisible()`, `textContent()`,
   `boundingBox()` — printed to stdout — answer most questions outright. "Is
   the switcher at the right edge?" is `boundingBox().x + width ≈ viewport
   width`, which is a number, not a picture. Reach for pixels only when the
   question is genuinely "does this *look* right".
2. **Clip to the element.** `locator.screenshot()` over `page.screenshot()`.
   A card grid is a fifth of the page and a fifth of the tokens.
3. **Stay at phone width.** 390×844 is where the layouts break *and* it is the
   cheapest useful viewport. Only shoot desktop when the bug is desktop-only.
4. **Never `fullPage: true`** unless the answer is literally about scroll
   length. It multiplies the image by the page height.
5. **One script, one run, N files — then read one or two.** Writing ten
   screenshots to disk is free. *Reading* them is not. Look at the final state
   and, if it is wrong, the step before it — not the whole reel.
6. **Reuse `storageState`.** Logging in each iteration is four actions that can
   fail in four ways, and every failed run is a retry that costs context.
7. **Don't pipe the DOM into context.** `page.content()`, full console logs and
   verbose network dumps are thousands of tokens of noise. Filter to the one
   selector or the one console line you care about.
8. **Don't re-verify what a test proves.** If vitest already asserts the empty
   weeks are in the data, the screenshot is only about how the bars look.
9. **Clean up.** Remove the scratchpad scripts, the `.png`s and
   `playwright-core` when done — and check `git status` before committing, so
   none of it lands in the repo.
