# UX audit — open items

The audit that produced this file ran over August 2026: every page driven at
phone width (390×844) and desktop, in both themes, on a non-default accent,
signed out, and with the network cut. Forty-six findings came out of it. All of
them are now either fixed or declined, so the findings themselves have been
removed rather than left as a list of ticks to scroll past — `git log` on this
file is the record, and each fix's reasoning is in the commit that made it.

What the audit changed that outlives it lives where it will be read:

- **[ui-design.md](ui-design.md)** — the palette separation rule, the two
  display switches, and the one form-label style, all now part of the guide
  rather than a finding against it.
- **`lib/__tests__/paletteSeparation.test.ts`** — reads `index.css` and fails if
  any sport, status or item colour drifts back within 20 ΔE of an accent, or
  below its contrast floor. This is the one finding that could silently return,
  so it is the one with a test.
- **`components/ChartAxis.tsx`** — `denseXAxis`, `timeXAxis`, `END_PADDING`,
  `EDGE_PADDING_Y`, `WHOLE_NUMBERS`. Most of the chart findings were one of
  these missing; the conventions are exported so the next chart gets them free.

## Still open

Three, all judgement calls rather than defects, and none urgent.

### A. Are the Efficiency tab's four charts four questions? · M · low

`HR vs Pace` and `Distance vs Pace` are the same scatter with a different x, and
`Efficiency Factor` and `Pace at Fixed HR` are two renderings of one idea. Four
charts is more than the tab has questions, and on a phone that is a long scroll
to reach the last.

Left alone because the answer is editorial: deciding which two to keep needs
someone who reads their own training data, not someone reading the code.

*(The remainder of the original #40 — one line under the strip saying what each
tab holds — is done.)*

### B. Does Records belong in a strip of charts? · S · low

It is a table of best figures, sitting in a tab strip whose other four members
are charts, and it is the one the page opens on. Nothing is wrong with it; it
just answers a different kind of question from its neighbours, and the strip
implies otherwise.

### C. No password reset · M · high

The login page offers sign-in and SSO and nothing else. Email is already wired —
account deletion sends a confirmation code through it — so the plumbing exists.
On a multi-user instance meant to run for years this is the likeliest support
request there is, and today the only answer is an administrator editing the
database.

Declined once during the audit as out of scope for a UX pass. It is not a UX
finding; it is a missing feature, recorded here so it is not lost.

## Deliberate silences

Things that look like gaps and are not, so they are not re-proposed:

- **Pull-to-refresh and tab switches do not buzz.** Both confirm themselves
  visibly, and a buzz on every tab switch is what gets vibration turned off
  wholesale. Long press and goal completion do buzz.
- **`--success` may coincide with the green accent.** Success is green because
  success is green, and one of the six accents is green for the same reason.
  Both readings of that colour are "good". The exemption is in the palette test.
- **Max HR, lowest average HR, calories and steps are not personal bests.** A
  ceiling is not an accomplishment and celebrating one invites chasing it; the
  way to set a lowest-average-HR is to go slowly; calories and steps track
  duration and distance closely enough to say the same thing twice. The
  reasoning is in `recentPersonalBests` and its Go counterpart.
- **The doubled API requests in development** are React's StrictMode
  double-invoking effects. A production build issues each once.
