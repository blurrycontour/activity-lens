import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// Accepted when a workout file is shared into the app. GadgetBridge and several
// other exporters share with a generic or missing MIME type, so the extensions
// are listed alongside the specific types to make sure the share sheet offers
// Activity Lens at all.
const WORKOUT_FILE_TYPES = [
  '.gpx',
  '.tcx',
  // What watches actually record. Its registered type is rare in the wild —
  // most apps share a .fit as octet-stream — so the extension does the work.
  '.fit',
  // Export archives: Strava and Garmin both hand you a zip, and the files
  // inside are often individually gzipped. The app unpacks them client-side.
  '.zip',
  '.gz',
  'application/gpx+xml',
  'application/vnd.garmin.tcx+xml',
  'application/vnd.ant.fit',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/xml',
  'text/xml',
  'application/octet-stream',
]

// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // `--mode development` builds keep sourcemaps and skip minification.
  const emitSourcemaps = mode === 'development'

  return {
    base: '/',
    define: {
      __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || 'dev'),
    },
    build: {
      sourcemap: emitSourcemaps ? 'inline' : false,
      minify: !emitSourcemaps,
      // 500 kB is the default warning threshold and neither of the two vendor
      // chunks below will ever be under it — a mapping engine and a charting
      // library are simply that size. The warning has done its job (MapLibre no
      // longer loads for everyone), so this stops it crying wolf over the split
      // it asked for.
      chunkSizeWarningLimit: 1000,
      rolldownOptions: {
        output: {
          codeSplitting: {
            // Dependencies that change on their own schedule, split out so a
            // release of the app does not invalidate them in every user's
            // cache. Recharts and React together are most of what is left in
            // the entry chunk once MapLibre is lazily loaded (see the dynamic
            // import in WorkoutDetail), and neither changes between releases.
            groups: [
              { name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/ },
              { name: 'charts', test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
    // MapLibre starts its worker with `{ type: 'module' }`, so the bundle we
    // hand it has to be a module rather than Vite's default IIFE.
    worker: {
      format: 'es',
    },
    plugins: [
      react(),
      tailwindcss(),
      reactRefreshBoundaryFallback(),
      VitePWA({
        // injectManifest (rather than generateSW) because the share target
        // needs a hand-written POST handler that no generated worker provides.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        // 'prompt', not 'autoUpdate': the latter reloads the page the moment a
        // new worker activates, which can discard whatever the user was typing.
        registerType: 'prompt',
        // Registration happens explicitly in main.tsx.
        injectRegister: null,
        injectManifest: {
          // `mjs` is here for MapLibre's worker, which is a separate module
          // fetched at runtime rather than imported. Without it the map works
          // online and silently loses tile and GeoJSON parsing offline.
          globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff,woff2}'],
        },
        manifest: {
          name: 'Activity Lens',
          short_name: 'Activity Lens',
          description: 'Multi-sport workout tracking and performance analysis',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#0a0b0e',
          theme_color: '#0a0b0e',
          orientation: 'portrait',
          categories: ['fitness', 'health', 'sports'],
          // Split by purpose rather than reusing one file for both. The mark is
          // transparent so it sits on whatever surface the launcher gives it;
          // only the maskable variant carries a tile, because Android crops it
          // to its own shape and composites transparency to black.
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          // Lets the installed app appear in the Android share sheet when a
          // tracker app shares a workout file. The POST is intercepted by the
          // service worker, which stashes the file and redirects to the app.
          share_target: {
            action: '/share-target',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              title: 'title',
              text: 'text',
              url: 'url',
              files: [{ name: 'file', accept: WORKOUT_FILE_TYPES }],
            },
          },
          // "Open with" for an installed PWA: double-clicking a .gpx offers
          // Activity Lens, and the files arrive via window.launchQueue.
          //
          // Chrome and Edge on desktop only. Android has no file association
          // for PWAs — sharing is that platform's route in, and share_target
          // above already covers it — so this is simply inert there.
          file_handlers: [
            {
              action: '/',
              accept: {
                'application/gpx+xml': ['.gpx'],
                'application/vnd.garmin.tcx+xml': ['.tcx'],
                'application/vnd.ant.fit': ['.fit'],
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
      strictPort: true,
      proxy: {
        '/api': {
          target: process.env.AL_BACKEND || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
    },
  }
})

/**
 * Reload when a module that previously defined a React Refresh boundary stops
 * defining one. This happens when a component moves into a new file and the old
 * module is replaced with a re-export:
 *
 *   export { default } from './app/App'
 *
 * Vite otherwise accepts the update using the previous module's HMR boundary,
 * but the re-export-only transform no longer registers a replacement for the
 * mounted component family. React reports a successful refresh while leaving
 * the old tree mounted until the page is reloaded.
 */
function reactRefreshBoundaryFallback(): Plugin {
  const hadRefreshBoundary = new Map<string, boolean>()
  let sendFullReload: (() => void) | null = null

  return {
    name: 'react-refresh-boundary-fallback',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      sendFullReload = () => server.ws.send({ type: 'full-reload', path: '*' })
    },
    transform(code, id) {
      if (!/\.[jt]sx?(?:\?|$)/.test(id) || id.includes('/node_modules/')) return null

      const moduleId = id.split('?')[0] ?? id
      const hasRefreshBoundary = code.includes('registerExportsForReactRefresh')
      const previousHadRefreshBoundary = hadRefreshBoundary.get(moduleId)
      hadRefreshBoundary.set(moduleId, hasRefreshBoundary)

      if (previousHadRefreshBoundary && !hasRefreshBoundary) {
        queueMicrotask(() => sendFullReload?.())
      }

      return null
    },
  }
}

