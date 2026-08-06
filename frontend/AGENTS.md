# Activity Lens — frontend

Frontend uses React + Vite. See **Styling** below before writing any CSS.

## Key Files

- `src/App.tsx` - Main application component
- `src/main.tsx` - React entry point
- `src/index.css` - Design tokens, shared component classes, and all responsive rules
- `package.json` - Dependencies and scripts
- `vite.config.ts` - Vite configuration
- `.mise.toml` - Toolchain versions (Node.js, pnpm)

## Styling

Styling is driven by **CSS custom properties and semantic classes in `src/index.css`**, not by
utility classes. Follow what the existing components do:

- Reach for the shared primitives first — `.card`, `.btn` / `.btn-primary` / `.btn-ghost` /
  `.btn-icon`, `.input`, `.select`, `.badge`, `.chip`, `.modal-box`. Add a new semantic class to
  `index.css` when a pattern repeats; use an inline `style` object for one-offs.
- Never hardcode a colour. Everything comes from the tokens on `:root` — `--bg` / `--bg-2` /
  `--bg-3`, `--text` / `--text-2` / `--text-3`, `--border`, and `--primary` / `--primary-dim` /
  `--primary-glow`. The accent is user-selectable across six colours (`src/lib/theme.ts`) and
  light mode is the `.light` class on `:root`, so hardcoding breaks 11 of 12 combinations.
- Radius convention: `var(--radius)` (8px) for controls, `calc(var(--radius) * 1.5)` for cards,
  `calc(var(--radius) * 2)` for modals, `99px` for pills. Cards carry no shadow — separation
  comes from `--bg-2` on `--bg` plus a 1px `--border`.
- Numbers use `var(--font-mono)` with negative letter-spacing; micro-labels are 11px uppercase
  mono in `--text-3`.

Tailwind v4 is installed and loaded via the Vite plugin, but the app does **not** use its utility
classes — `@theme` in `index.css` only supplies the two font tokens. Don't introduce utility
classes into a file that doesn't already have them.

## Brand mark

The logo exists in two places that must stay in sync:

- `public/logo.svg` — the source of truth, and what the raster icons are generated from.
- `src/components/Logo.tsx` — the same geometry inline, stroked with `var(--primary)` so the
  mark follows the user's accent. Static files can't read CSS variables, hence the duplication.

The mark is transparent everywhere it can be. Only `icon-maskable-512.png` and
`apple-touch-icon.png` carry a dark tile, because Android crops maskable icons to its own shape
and iOS flattens alpha to black.

To change it: edit `logo.svg`, mirror the numbers into `Logo.tsx`, then run
`python3 scripts/gen_icons.py` (needs `cairosvg`) to regenerate the seven PNGs.

## Development
Always keep in mind that UI components should be reusable and should work well both on desktop
and mobile devices. Handle screen sizes with media queries in `index.css`; the breakpoint
convention is 768px, with 480px and 640px used where a layout needs a third step.
