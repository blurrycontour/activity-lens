# UX audit

Findings from driving the running app at phone width (390×844) and desktop
(1280×900), in both themes, on a non-default accent, signed out, and with the
network cut. Method and tooling: [visual-verification.md](visual-verification.md).
Rules the findings are measured against: [ui-design.md](ui-design.md).

Each entry carries **effort** (S: under an hour · M: half a day · L: more),
**impact** on the person using the app, and a **priority**. Fixed entries are
struck through with the commit that closed them.

The app is in good shape and the list should be read that way. The swipe gesture
already yields to horizontal scrollers, reduced motion is handled in fifteen
places, the tab strip measures its own overflow, and the per-device dashboard
defaults are better reasoned than most. Nearly every hardcoded colour turned out
to be deliberate and documented. What follows is specific, not a verdict.

## P1 — the app is lying, or has stranded someone

### 1. `/equipment/{unknown}` hangs forever · S · high

`load` in `frontend/src/pages/Equipment.tsx` is `setData(await api.getEquipment(id))`
with no `.catch`. A 404 becomes an unhandled rejection — the browser reports
`PAGEERROR: equipment not found` — and `data` stays null, so the component's
`if (!data)` branch renders `Loading…` for as long as the page is open. Back
still works; nothing else does.

### 2. Offline, the workouts page says you have no workouts · M · high

With the network cut, `/workouts` shows `0 of 36` → `0 of 0` and the empty state
*"No workouts found"* — character for character what a brand-new account sees.
The offline bar is up at the top, but the page itself makes a false claim about
the user's own data, and the reflex it invites is panic.

`ui-design.md` already requires empty states to distinguish "none yet" from
"none in this filter". This is the third case, "we could not ask", and no page
has it.

### 3. The hidden offline bar is announced on every page load · S · med

`OfflineBar` stays mounted and collapsed to `height: 0; overflow: hidden` so both
directions animate. Zero height does not remove an element from the accessibility
tree, and the bar carries `role="status" aria-live="polite"`. The string
`Offline — showing saved data` is therefore present in the aria snapshot of every
page in the app, signed in or out, online or not — and a screen reader announces
it on arrival at each one.

### 4. `/users/{bad-id}` renders the raw backend string · S · med

Unstyled body text reading `invalid user id`. No `StatusMsg`, no retry, no
explanation, no suggestion of where to go instead.

### 5. Five "not found" routes, five behaviours · M · high

| URL | What happens |
|---|---|
| `/workouts/{unknown}` | silent redirect to the list |
| `/plans/{unknown}` | silent redirect to the list |
| `/equipment/{unknown}` | hangs forever (#1) |
| `/users/{unknown}` | raw backend error (#4) |
| `/totally-unknown` | renders the Dashboard **and leaves the wrong URL in the bar** |

None of the five says the thing you asked for is not there. The last is the worst
of them: reloading or sharing that URL lands on the same lie again.

## P2 — visibly wrong, cheap to fix

### 6. `5.7 kcal ×1k` · S · med

The dashboard's calories tile divides by 1000 unconditionally and labels the unit
`kcal ×1k` — a notation nobody writes — sitting beside a clean `41 km` and
`146 bpm`. It degrades at low volume: 400 kcal renders as `0.4 kcal ×1k`. The
elevation tile does the same thing, so 80 m of gain reads `0.1 km`.

### 7. The year heatmap opens on the oldest month · S · med

On `/consistency` the grid measures `scrollWidth 682` inside a `clientWidth 372`
card, at `scrollLeft: 0`. You land on last September and have to scroll right to
find this week — the only part of a consistency view anyone opens it for. The
scroll container is `.card` itself rather than the grid, so the heading and the
Less/More legend scroll away with it.

### 8. Two date formats in adjacent rows of one list · S · med

`/plans` shows `4 days ago` directly above `8/17/2026`. `relativeDay` in
`pages/plans/PlansPage.tsx` falls back to a bare `toLocaleDateString()` — the only
call in the app that produces `M/D/YYYY`. A better near-copy of the same helper
already exists as `whenLabel` in `components/WorkoutSocial.tsx`, whose fallback is
`{ day, month }`. Two implementations of "time ago", one of them wrong: the drift
`ui-design.md` warns about, already drifted.

### 9. `Last 30 days` is clipped to `Last 30 day` · S · low

Measured `scrollWidth 79` in a `clientWidth 73` trigger at 390px. It is the
*default* state of the range dropdown on both `/analysis` and `/consistency`, so
most people meet the app with a truncated word on screen.

### 10. The sidebar answers a different version question from About · S · low

*Corrected after the first draft.* The sidebar prints `Version: 2.1.0` and the
update notifications say `2.2.1-2-g54496c7`, which looks like drift and is not:
the first is the **server's** version and the second is the **APK's**, and they
are genuinely separate artifacts that update on their own schedules. `AboutDialog`
already gets this right, with a `Version` row and an `App version` row and a
comment explaining why.

What was actually wrong is smaller. The sidebar read `__APP_VERSION__`, the
build-time constant, rather than the server's `/build` — so inside the Android
app it was quietly answering the APK question under a label that means the
server, three taps from a dialog answering it the other way. On web the two
coincide, which is why this never looked broken.

### 11. The notification list is flooded · M · med

Eight near-identical entries, one per commit:

> Update 2.2.1-2-g54496c7 available — A new version of app is ready. Don't be a
> dinosaur and Update now!

Only the newest can be acted on; the rest are individually dismissable noise. An
update notice should supersede its unread predecessor rather than stack on it.
The joke also stops being one somewhere around the third repetition.

### 12. Personal records show meaningless zeros · S · low

`/analysis` renders a Strength card reading `Longest 0.0 km` and
`Most Elevation 0 m`. Neither figure means anything for strength work. Records
also carry no date — a personal best without a "when" is half a fact.

### 13. The notifications panel has no close button · S · low

The app's own rule: *every dialog that is not a confirmation carries a close
button*. Of seventeen `Modal`s, this is the one without. Its rows are also
`<button>`s containing a nested Dismiss `<button>`, which is invalid and makes
the row's accessible name absorb the word "Dismiss".

## P3 — systemic, recorded and awaiting a decision

### 14. The accent doubles as the success colour · M · high

`--primary` is used to mean *achievement*: the "New personal best" banner, best-pace
figures on the records cards, and `.goal-verdict.done`. That last one is the
clearest case, because its three siblings are semantic:

```css
.goal-verdict.done   { background: var(--primary); }
.goal-verdict.ahead  { color: var(--success); }
.goal-verdict.on     { color: var(--text-2); }
.goal-verdict.behind { color: var(--warning); }
```

On the Rose accent, a **completed** goal is pink and an **in-progress** one is
green — done looks worse than ahead — and the personal-best banner reads as an
error dialog. `ui-design.md` states the rule this breaks: *the accent is the
user's choice and carries no meaning*. `--success` exists and is used 15 times
against `--primary`'s 118.

Fix: repoint achievement and completion states onto `--success`. Held back
because it changes the dashboard on the default green too.

### 15. Content rows are unreachable by keyboard · M · med

`.workout-row` and the equipment `.card` are `<div onClick>` with no `role`, no
`tabIndex` and no key handler. The reasoning is documented in `ItemList.tsx` and
is correct as far as it goes — the byline inside is its own button, and a button
cannot legally contain another. The conclusion does not follow: a stretched,
absolutely-positioned `<button>` behind the content gives the row a name, focus
and Enter without nesting anything.

This matters more here than it would elsewhere, because the app ships `G`-then-key
shortcuts and therefore already has keyboard users.

### 16. Four treatments of "a row you tap" · M · med

Plans rows and Discover people are real `<button>`s. Workouts rows, Equipment
cards and the Discover feed are divs. The Plans list also drops the left accent
stripe and the coloured figure the Workouts list uses, so the two library pages
do not read as one system despite `FeedRow` deliberately borrowing
`.workout-row`'s classes to make them.

### 17. Nothing in the mobile chrome reaches a 44px touch target · M · med

Measured at 390px:

| Control | Size |
|---|---|
| `InfoTip` trigger | **17×17** |
| Row share | 29×29 |
| Library options | 29×29 |
| Top-bar theme / notifications | 31×31 |
| Avatar | 32×32 |
| Filters | 41×29 |
| View switcher | 39×27 |
| Tab strip item | 37 tall |

`ui-design.md` notes that touch targets "are not hypothetical" given the Capacitor
app. The 17px InfoTip is the worst of them, and it is the only route to what a
chart actually means. The fix is hit area via padding or a `::before` overlay, not
visual size — these are correctly proportioned, just not tappable.

### 18. Light mode's tertiary text fails WCAG AA · S · med

`--text-3: #9ca3af` on `--bg-2: #ffffff` is **2.5:1** — under even the 3:1 floor
for large text — and it is the token behind every 11px micro-label, hint and
description. The light overrides deepen `--text-2`, `--danger`, `--success` and
`--warning` against the white ground but make `--text-3` *lighter* than the dark
theme's `#6b7280`, which is backwards. `#6b7280` on white is 4.8:1 and passes.

One token, wide visual effect.

### 19. Two hardcoded colours that are not justified · S · low

Most literals in the tree are correct and explained: MapLibre has no DOM to
resolve a custom property against, `shareCard` renders a standalone PNG, and
`hrZones` documents its own reasoning at length. Two are drift — `#f97316` for
Max HR in `pages/Analysis.tsx`, surrounded by tokens on every neighbouring line,
and `CADENCE_COLOR = '#ec4899'` in `pages/WorkoutDetail.tsx`.

### 20. Date formatting is scattered across ~16 call sites · M · med

Eight hardcode `'en-US'` — `ItemList`, `Dashboard` (×3), `Analysis` (×2),
`WorkoutCard`, `Workouts` — so a European user is shown `Aug 23, 2026` rather
than `23 Aug 2026`. Eight more pass `undefined` and follow the locale properly.
The same screen can show both. A `lib/date.ts` exporting `shortDate`, `longDate`
and `relativeDay` collapses all of them and closes #8 permanently.

### 21. `index.css` is 7,466 lines in one file · M · low

1,171 class selectors, 50 media queries, 4 container queries. The convention is
good and worth keeping — no utilities, media queries centralised, semantic classes.
The single file is the debt. Splitting into `@import`ed parts (tokens, base,
components, pages) preserves cascade order exactly and costs nothing at build time.

### 22. `.field-label` vs `.form-label` · S · low

The duality `ui-design.md` already admits to, at 11 files to 4. Both are classes,
so it is the one-line decision the doc says it is.

### 23. Loose ends · S · low

- The workout-detail back button has no accessible name; every other page's says "Back".
- The route scrubber is announced as `slider: "7268"` — a raw sample index. It wants `aria-valuetext` with the elapsed time.
- Landmark labels are inconsistent in case and grammar: "Workout sections", "plan sections", "Analysis sections", "Which workouts", "What to discover".
- Chart headings on WorkoutDetail absorb the InfoTip into their accessible name (`heading "Heart Rate About Heart Rate"`); `ChartCard` elsewhere keeps them separate.
- The login page has no `<h1>`.

## The charts on Analysis and Consistency

Looked at separately, tab by tab, at 390px. The chart *system* is in good order —
`denseXAxis` measures real label widths, `width="auto"` sizes the y axis, margins
come from `useChartSpace`, every card has an `InfoTip` saying what it means, and
the "correlation, not a cause" line under the weather scatter is the kind of
honesty most fitness apps skip. These are the places the individual charts fall
short of that system.

### 33. The Efficiency charts plot time as if it were evenly spaced · M · high

`Efficiency Factor` and `Pace at Fixed HR` put one point per activity on a
categorical axis labelled **"Activity date"**. Six activities across four weeks
are therefore drawn six equal steps apart: Jul 30 → Aug 7 is eight days, Aug 7 →
Aug 8 is one, and both are the same width on screen.

The shape of the line is what these charts are *for* — "falling is improving",
says the caption — and that shape is an artefact of the spacing. The dramatic
spike between Aug 7 and Aug 8 is one day of data given eight days of width.
Either the axis becomes a real time scale (`type="number"`, `scale="time"`), or
the caption stops describing the curve as a trend.

Same root cause, visible symptom: **the axis repeats labels**, reading
`Jul 30 · Jul 30 · Aug 7 · Aug 8 · Aug 23 · Aug 23`, because two activities on
one day are two categories with one name and nothing distinguishes them.

### 34. Fitted lines and an `r` on two and three points · S · high

The weather scatter prints `Run 3 · r -0.48` beside `Hike 2`. `pearson` guards
at `n < 3`, which lets a three-point correlation through — and a correlation
coefficient on three points is near-guaranteed to be large whatever the data.
The legend also lists a two-point group as though it were a fitted series.

`lib/weather.ts` already reasons carefully about the degenerate case ("zero
means measured and unrelated, which is a real finding"). The threshold is just
set below the point where the number carries information. Raising it — five is
the usual floor, eight is defensible — is a judgement about statistics rather
than a defect with one right answer, which is why it is recorded rather than
changed.

Related: `Temperature vs Pace` describes itself as "one line per sport, in 2 °C
bands" and renders five disconnected dots, because no band holds enough points
to make a line. The caption promises a chart the data cannot produce.

### 35. Rotated y-axis labels are clipped at phone width · S · med

"Adjusted pace (min/km)" renders as "usted pace (min/km)". The DOM box is
correct — a rotated SVG label is 12px wide and extends visually beyond it, past
`margin.left: 0` (which `useChartSpace` sets on mobile) and into the card's
padding, where it is cut. It affects every chart with a y-axis label on a phone;
it only *shows* when the label is long enough to reach the edge.

### 36. Charts are exposed to screen readers three different ways · S · low

Recharts' default `role="application"` on Analysis and Consistency, `role="img"`
on WorkoutDetail, and the calendar heatmap as a bare run of text. `application`
is the worst of the three — it puts a screen reader into forms mode for a
picture. A `role="img"` with an `aria-label` summarising the trend in a sentence
would serve better than any of them, and the data for that sentence is already
computed for the captions.

### 37. Series colours borrow the status palette · S · med

`Efficiency Factor` draws its only series in `--danger`, and `Max HR` in
`Analysis.tsx` is a hardcoded `#f97316`. `ui-design.md` reserves the status
colours ("never reuse `--danger` as series 2") for exactly this reason: a red
line reads as a warning, and this one is just a measurement. `SERIES_COLORS`
exists.

### 38. Legends are built two ways · S · low

Consistency's year and week comparisons render their legend as bare text nodes
(`2024`, `2025`, `2026`), while the Dashboard's weekly trend builds a real
`<ul>` with swatch images. Same information, same page family, two
implementations — and only one of them pairs the colour with anything a screen
reader can use.

### 39. Fractional counts on a count axis · S · med — *fixed*

"Week over Week" measured in activities was labelled `0 · 0.5 · 1 · 1.5 · 2`.
Recharts allows decimals by default and picks ticks from the range, so this only
appears on small numbers — which is where a new account lives. `WHOLE_NUMBERS`
in `ChartAxis.tsx` now covers the count axes, and the monthly and yearly
breakdowns stop saying "1 activities".

### 40. The tabs are uneven, and nothing says what is behind them · S · low

Records has two blocks, Trends one, Efficiency four, Load two, Weather two. A
reader on a phone sees one tab strip with the fifth item off the edge (the fade
is there and works) and no sense of what the tabs hold or which is worth the
scroll. Consistency has the same shape with three.

Worth considering whether Efficiency's four charts are four questions or one
question asked four ways — `HR vs Pace` and `Distance vs Pace` are the same
scatter with a different x — and whether Records, which is a table rather than a
chart, belongs in a tab strip of charts at all.

## Missing features and ideas

### 24. No password reset · M · high

The login page offers sign-in and SSO, and nothing else. Email is already wired —
account deletion sends a confirmation code through it — so the plumbing exists.
On a multi-user instance meant to run for years, this is the likeliest support
request there is, and today the only answer is an admin editing the database.

### 25. Sign-in errors are raw backend strings · S · med

`invalid credentials`, lowercase, no guidance, no distinction between a wrong
password and an unknown account (correctly, for security — but then say so in a
sentence a person would write). It is the first thing the app ever says to
someone.

### 26. Sparse pages are dead space rather than opportunity · M · med

`/plans` with three plans and `/equipment` with one item are roughly 75% empty on
a phone. These are the natural homes for "resume your last session", "next
scheduled day", or gear approaching replacement — and the dashboard already
computes that last one.

### 27. The FAB permanently occludes content · S · med

On the Dashboard it sits over the goal history bars at every scroll position; on
Workouts, over a row. `.with-fab` reserves padding at the bottom of the scroll,
but the button floats above mid-content the whole time. Hiding it on scroll-down
is the standard behaviour and would cost little.

### 28. Share is the promoted action on every workout row · S · med

A rare action, given the only visible affordance on each row, at a 29px target,
while open, edit and delete live behind a long press. Worth reconsidering what
earns that slot.

### 29. Haptics exist only inside the session runner · S · med

`lib/sessionFeedback.ts` is careful and complete about vibration during a workout.
Long-press, the pull-to-refresh commit, tab switches and goal completion are all
silent in the Android app.

### 30. The map heatmap has no legend · S · low

A blue→red density ramp with nothing saying what the ends mean, while the
consistency calendar one page over labels its scale "Less … More".

### 31. Help is out of date · S · med

- "Analysis … split into four tabs: Records, Trends, Efficiency and Load" — there are five; Weather was added.
- "Add your first workout with the **Add Workout** button in the sidebar" — there is no sidebar on a phone.
- "The pages" documents every page except Map.

### 32. Workouts search survives navigation and reload · S · low

Coming back to a library that says "No workouts match these filters" because of a
search typed minutes ago on a different page is startling. The "Clear filters"
button is there and is the right recovery, so this is a question of whether the
persistence is worth the surprise.
