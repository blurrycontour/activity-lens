# Activity Lens — frontend

Frontend uses React + Vite. See **Styling** below before writing any CSS.

## Key Files

- `src/App.tsx` - Main application component
- `src/main.tsx` - React entry point
- `src/index.css` - Design tokens, shared component classes, and all responsive rules
- `package.json` - Dependencies and scripts
- `vite.config.ts` - Vite configuration

Node is pinned by the build image (`node:22.21.1-alpine` in the root `Dockerfile`), not by a
toolchain file. Config code runs as native ESM, so use `import.meta.dirname`, never `__dirname`.

## Styling

**Read [`docs/ui-design.md`](../docs/ui-design.md) before writing or changing any UI.** It is the
single source for tokens, the accent/theme matrix, layout, reuse and chart conventions — kept in
one place so it cannot drift from a second copy here.

The two things worth repeating, because they are what people get wrong:

- Styling is **CSS custom properties and semantic classes in `src/index.css`**, not utility
  classes. Tailwind v4 is installed and loaded, but `@theme` supplies only the two font tokens
  and the app uses no utilities. Don't introduce them.
- **Never hardcode a colour.** The accent is user-selectable across six hues and the theme has
  three modes, so a literal breaks 17 of the 18 combinations.

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
