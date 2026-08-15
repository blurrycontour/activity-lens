import { useEffect, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
// Types only, so this module carries no runtime dependency on MapLibre — which
// is the whole point of it. MAP_LAYERS and hasWebGL are read by code deciding
// *whether* to build a map, and that must not have to load the library first.
import type * as maplibregl from 'maplibre-gl'
import { cachedURL } from '../lib/tileScheme'

/*
 * The map furniture that does not itself need MapLibre: the layer catalogue,
 * the two custom controls, and the WebGL probe.
 *
 * These lived in RouteMap, so MapPage imported RouteMap statically to reach
 * them while WorkoutDetail imported it lazily — which meant the lazy import
 * moved nothing into its own chunk, and the build said so. Split out, RouteMap
 * is reachable only through that dynamic import.
 */

export type MapLayerId = 'street' | 'topo' | 'satellite'

export const MAP_LAYER_KEY = 'al_map_layer'

/**
 * A raster style wrapping a plain XYZ tile service, so imagery can sit beside
 * the vector style in the same switcher. MapLibre has no {s} subdomain token,
 * so a server that wants them gets one entry per host and MapLibre spreads
 * requests over them itself.
 */
function rasterStyle(tiles: string[], attribution: string, maxzoom: number): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: tiles.map(cachedURL), tileSize: 256, maxzoom, attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

/**
 * What the layer switcher offers.
 *
 * Street is OpenFreeMap's Liberty, which is vector: the tiles carry geometry
 * rather than pictures of geometry, so the GPU draws them and panning and
 * zooming are continuous instead of a staircase of raster levels. The other two
 * stay raster because there is no vector equivalent — aerial imagery is
 * photographs, and OpenTopoMap's relief shading is baked into its tiles.
 */
export const MAP_LAYERS: Record<MapLayerId, { label: string; style: string | maplibregl.StyleSpecification; maxZoom: number }> = {
  street: {
    label: 'Street',
    style: cachedURL('https://tiles.openfreemap.org/styles/liberty'),
    maxZoom: 20,
  },
  topo: {
    label: 'Topographic',
    style: rasterStyle(
      ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
      'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      17,
    ),
    maxZoom: 17,
  },
  satellite: {
    label: 'Satellite',
    style: rasterStyle(
      ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      19,
    ),
    maxZoom: 19,
  },
}

/**
 * A "back to the whole thing" button, sitting directly on top of MapLibre's own
 * zoom buttons.
 *
 * Panning and zooming a map is easy to do and hard to undo — a few pinches in
 * and there is no way back to the view the page opened on short of reloading
 * it. Every map here has one obvious framing (the route, or every route), so
 * the way back is one button rather than a navigation problem.
 *
 * A MapLibre IControl rather than an absolutely positioned button of our own,
 * so it inherits the corner, the stacking and the theming the zoom buttons
 * already have, and so it cannot drift away from them at some viewport size.
 * Added *before* NavigationControl: controls stack in the order they are added,
 * which in a bottom corner means top to bottom.
 */
export class ResetViewControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null

  constructor(private readonly reset: () => void) {}

  onAdd(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group map-reset-ctrl'
    const button = document.createElement('button')
    button.type = 'button'
    button.title = 'Reset zoom'
    button.setAttribute('aria-label', 'Reset zoom')
    // Inline SVG stroked with currentColor, not MapLibre's own background-image
    // span: those glyphs are dark artwork for a light map and are inverted by a
    // filter in index.css, which this would then have to fight.
    button.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" />'
      + '<path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>'
    button.addEventListener('click', () => this.reset())
    el.appendChild(button)
    this.container = el
    return el
  }

  onRemove(): void {
    this.container?.remove()
    this.container = null
  }
}

export function LayerSwitcher({ layer, onChange, offsetRight = 46 }: {
  layer: MapLayerId
  onChange: (l: MapLayerId) => void
  /** Distance from the right edge, so this sits beside the maximize button when
   *  there is one and in its place when there is not. */
  offsetRight?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div
      className="options-menu-wrap"
      ref={ref}
      // Inline, and not a class: .options-menu-wrap sets `position: relative`
      // further down the stylesheet, so a class here loses to it and the
      // switcher drops back into the flow and out of sight.
      style={{ position: 'absolute', top: 10, right: offsetRight, zIndex: 'var(--z-map-panel)' }}
    >
      <button
        className="btn-icon"
        onClick={() => setOpen(o => !o)}
        title="Map layer"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
      >
        <Layers size={14} />
      </button>
      {open && (
        <div className="options-menu" style={{ animation: 'fadeIn 0.12s ease' }}>
          {(Object.keys(MAP_LAYERS) as MapLayerId[]).map(id => (
            <button
              key={id}
              className={`options-menu-item${layer === id ? ' active' : ''}`}
              onClick={() => { setOpen(false); onChange(id) }}
            >
              {MAP_LAYERS[id].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Whether this browser can give MapLibre the GL context it needs.
 *
 * Checked before constructing a map rather than after: MapLibre throws on
 * construction when WebGL is missing, and that took the whole page down with a
 * blank screen and "failed to initialize WebGL" in the console. Browsers with
 * hardware acceleration switched off, some remote desktops and a few Linux
 * setups without a working GPU stack all land here.
 *
 * Computed once. Nothing about the answer changes within a session, and
 * creating a throwaway context per render is not free.
 */
let webglAnswer: boolean | null = null
export function hasWebGL(): boolean {
  if (webglAnswer !== null) return webglAnswer
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    // Released explicitly: some drivers cap the number of live contexts, and
    // the map is about to want one of its own.
    const lose = (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')
    lose?.loseContext()
    webglAnswer = Boolean(gl)
  } catch {
    webglAnswer = false
  }
  return webglAnswer
}
