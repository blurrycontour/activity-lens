# figma-make-app

Frontend uses React + Vite + Tailwind CSS

## Key Files

- `src/App.tsx` - Main application component
- `src/main.tsx` - React entry point
- `src/index.css` - Global styles and Tailwind CSS import
- `package.json` - Dependencies and scripts
- `vite.config.ts` - Vite configuration
- `.mise.toml` - Toolchain versions (Node.js, pnpm)

## Styling

This project uses **Tailwind CSS v4** for styling. Use Tailwind utility classes directly in JSX. Tailwind is loaded via the Vite plugin — no PostCSS config needed.

## Development
Always keep in mind that UI components should be reusable and should work well both on desktop and mobile devices. Use Tailwind's responsive utilities to handle different screen sizes.
