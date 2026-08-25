# UI design guide

How this app's interface is built. Read before writing or changing any UI.
Everything here is a rule the existing code already follows — match it rather
than introducing a parallel approach.

## The styling system

**CSS custom properties + semantic classes in `frontend/src/index.css`.**
Tailwind v4 is installed and loaded, but the app does **not** use utility
classes — `@theme` supplies only the two font tokens. Do not add utility
classes to a file that has none.

Three places styling can live, in order of preference:

1. An existing shared class (`.card`, `.btn`, `.input`, …).
2. A new semantic class in `index.css` — the moment a pattern appears twice.
3. An inline `style` object — one-offs only, never for anything responsive.

Media queries belong in `index.css`, never in a component.

## Colour

**Never hardcode a colour.** Every value comes from a token on `:root`.

| Group | Tokens |
|---|---|
| Surfaces | `--bg` `--bg-2` `--bg-3` |
| Text | `--text` `--text-2` `--text-3` |
| Lines | `--border` `--border-strong` |
| Accent | `--primary` `--primary-dim` `--primary-glow` |
| Fixed hues | `--blue` `--purple` `--accent` (+ `-dim`) |
| Sports | `--run` `--ride` `--hike` `--swim` `--strength` `--other` |
| Status | `--success` `--warning` `--danger` (+ `-dim`, `-border`) |

Three rules that follow from this:

- **The accent is the user's choice and carries no meaning.** Six accents
  (`src/lib/theme.ts`) × three theme modes (dark default, `.light` on `:root`,
  system) = 18 combinations. A hardcoded colour breaks 17 of them.
- **Status colours are reserved.** Never reuse `--danger` as "series 2", and
  never signal state with colour alone — pair it with an icon or a label.
- **Sport colours mean the sport**, everywhere, always. Use `TYPE_COLOR` from
  `src/data/workouts.ts`; never repaint by rank or position.

Deriving a tint from a token — an 8% wash behind an error, say — is
`color-mix(in srgb, var(--danger) 8%, transparent)`, never the token's hex
retyped as `rgba(…)`. A literal cannot follow the theme, and the failure is
quiet: it looks right in whichever mode it was written in.

Known gap: form labels exist in two styles — `.field-label` (uppercase mono,
what `<Field>` uses) and `.form-label` (sentence case, used inside dialogs).
Both are classes now, so unifying them is a one-line decision rather than a
hunt, but it is a visible restyle and has not been made.

## Type & shape

- Base 14px. Card titles 13px/600. Descriptions and hints 11px in `--text-3`.
- **Numbers use `var(--font-mono)`** with slight negative letter-spacing.
- Micro-labels: 11px uppercase mono, `letter-spacing: 0.06em`, `--text-3`.
- Radius: `var(--radius)` (8px) controls · `calc(var(--radius) * 1.5)` cards ·
  `calc(var(--radius) * 2)` modals · `99px` pills.
- **Cards carry no shadow.** Separation is `--bg-2` on `--bg` plus a 1px
  `--border`.

## Layout & responsiveness

- **The breakpoint is 768px** (`MOBILE_QUERY` in `src/lib/useIsMobile.ts`, kept
  in sync with the CSS). 480/640px exist where a layout needs a third step.
- **Ask what is actually constraining the element.** A media query is right when
  the answer is the screen. When it is a fixed-width column — a settings card, a
  dashboard tile — use `@container` on that column instead, and keep the
  breakpoint in the container's own units. The goal editor is the worked
  example: keyed to the viewport, its rows stayed in the wide layout on every
  desktop and crushed a dropdown inside a 720px card, while the phone widths the
  query named were never the thing squeezing them.
- **The app shell never scrolls** — `html, body, #root` are
  `height: 100%; overflow: hidden`. A page manages its own scrolling. Use
  `100dvh`, not `100vh`.
- Reserved space is tokenised: `--topbar-h`, `--sidebar-w`, `--bottombar-h`,
  `--safe-top` / `--safe-bottom`. Read them; never re-derive the sums.
- **There is a Capacitor Android app** running the same build. Safe-area insets
  and touch targets are not hypothetical.
- Every screen must work on phone and desktop. Design both, not one then a
  patch.
- Ambient animation must be disabled under
  `@media (prefers-reduced-motion: reduce)`.

## Reuse before building

Check `src/components/` first — the common cases already exist:

`PageHeader` · `ChartCard` · `SettingsCard` / `SettingsRow` · `Field` ·
`Dropdown` (the app's picker — not a native `<select>`) · `PasswordInput` ·
`SearchInput` · `MenuButton` · `StatusMsg` · `TabStrip` · `ConfirmDialog` ·
`InfoTip` · `FilterSheet` · `TypeIcon` / `TypeLegend` · `Sparkline` · `EmptyPlot` ·
`ViewSwitcher` (list/card toggle, with its per-device remembering) ·
`ItemFilterBar` (search, per-kind filters and sorting for workouts, plans and
sessions) · `ShareDialog` / `ShareBadge` · `NotesAndSocial` · `UserAvatar`

If something is used twice, it becomes a component or a class. A near-copy of
an existing component is a bug — it will drift.

## Anything that floats over the page

- **Dialogs, sheets and panels go through `Modal`.** It portals to the body
  (pages render inside the swipe pager, a stacking context, so a dialog left in
  place is painted over by the top and bottom bars), dims and blurs the page,
  and gives every surface the same way out: tap outside, Escape, and the system
  back gesture. Never hand-roll the backdrop.
- **Never hand-roll Escape on a `Modal`** — it already has it, and a second
  listener dismisses twice. For popovers that are not `Modal`s (dropdowns,
  menus, tooltips) use the `useEscape` hook.
- **Back is not optional.** On a phone the back gesture is the close button; a
  surface that ignores it navigates the page away instead. `Modal` handles this
  via `useDismissOnBack`, which keeps one guard history entry for the whole
  overlay stack and lets only the topmost surface respond.
- **Every dialog that is not a confirmation carries a close button** — a
  `.btn-icon` with an `X` and `aria-label="Close"`, top right, in a
  `.dialog-head` row. Confirmations are exempt: their Cancel *is* the way out,
  and a second one is noise.
- **Reserve the space data will occupy.** A dialog that renders its rows only
  once a fetch lands grows under the reader a moment after opening. Use
  `Skeleton` at roughly the value's width, and track whether the request has
  *settled* — otherwise a failed one shimmers forever.
- **Stacking order is named, not numbered.** Use the `--z-*` tokens on `:root`
  (`--z-chrome`, `--z-overlay`, `--z-dialog`, `--z-menu`, `--z-tooltip`,
  `--z-status`, `--z-floating`, …). Pick the layer the thing belongs to; do not
  invent a number big enough to win. Small local values inside a component's own
  stacking context are fine and stay raw.

## Charts

Recharts. Shared helpers live in `src/components/ChartAxis.tsx` and
`src/lib/chartColors.ts` (`AXIS_TICK`, `GRID_PROPS`, `HOVER_FILL`,
`recencyRamp`, `SERIES_COLORS`).

- **X axis (dates/categories): spread `denseXAxis(fontSize?)`.** It sets
  `interval="preserveStartEnd"`, which makes Recharts measure the real label
  text, keep the first and last, nudge them inward so they cannot clip, and
  drop only what would collide. Never pass a **numeric** `interval` — that
  makes Recharts skip measurement entirely and is what caused end labels to
  overlap.
- **Y axis: `width="auto"`.** Recharts measures the widest tick and the rotated
  label and leaves a gap. A fixed width is a guess against the longest text the
  chart might produce, and it will be wrong.
- **Margins: `useChartSpace().margin()`** — narrower gutters on mobile.
- **One axis.** Never two y-scales on one chart; use two charts.
- Ordered series (years, recency) → `recencyRamp()`. Unordered → fixed
  `SERIES_COLORS`, assigned in order, never cycled.
- **≥2 series needs a legend**, and colour is never the only encoding — name
  the category in the tooltip too.
- Thin marks, recessive grid, no number on every point.

## Content

Say the thing once, briefly. Long explanations go behind an `InfoTip`, not into
the page body. Empty states say what is missing *and* why, distinguishing "none
yet" from "none in this filter".

## Known gaps

Findings from driving the real app — inconsistencies, unreachable states and
ideas, each with an effort and a priority — live in [ux-audit.md](ux-audit.md).
Read it before starting UI work: what looks like a free hand may already be
recorded there as debt with a fix attached.

## Before calling it done

1. `pnpm typecheck` and `pnpm test` clean.
2. Looked at it — mobile width and desktop — not just reasoned about it.
3. Light mode and a non-default accent.
4. No hardcoded colour, no duplicated component, no inline media query.

> Chrome headless here needs `libnspr4`/`libnss3`; they can be fetched with
> `apt-get download` and extracted under `LD_LIBRARY_PATH` without touching the
> system. It also refuses to lay out below ~500px CSS width — pin a fixed-width
> container to test phone widths.
