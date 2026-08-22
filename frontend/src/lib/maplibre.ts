/**
 * MapLibre, and the two things that must happen before a map is built.
 *
 * Both are one-time global registrations, and both used to sit at the top of
 * RouteMap — so they ran when a workout's map was opened and not otherwise.
 * Open the Maps page first in a fresh app and MapLibre had no worker URL: it
 * asked for a file by a path Vite never emitted, the request fell through to
 * the SPA handler, and nothing rendered. Open a workout first and everything
 * worked from then on, including the page that had just failed, because the
 * registration was standing by then. A bug that depends on which page you
 * visited first is a module that is imported for its side effects by only one
 * of the places that need them.
 *
 * So the import lives here and the registrations come with it. Anything that
 * builds a map takes MapLibre from this module and cannot get the unprepared
 * one by accident; a test holds that.
 */
import * as maplibregl from 'maplibre-gl'
// The worker is a separate module MapLibre fetches at runtime, by a URL it
// builds from a variable — which Vite cannot follow, so without an import the
// file is never emitted, the request falls through to the SPA handler, and the
// browser refuses the index.html it gets back:
//
//   Failed to load module script: ... non-JavaScript MIME type "text/html"
//
// `?worker&url` and not `?url`: the plain asset form copies the worker file
// byte-for-byte, and it opens with `import "./maplibre-gl-shared.mjs"` — a
// sibling Vite never emits, so the worker booted and immediately 404'd on it.
// `?worker` builds it as its own entry with that dependency rolled in.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { installTileCache } from './tileCache'

maplibregl.setWorkerUrl(maplibreWorkerUrl)
// Registered alongside the worker, before any map is built, because the style
// URLs the app uses are already addressed to it.
installTileCache()

export { maplibregl }
