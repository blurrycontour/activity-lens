import { registerPlugin } from '@capacitor/core'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../SystemBarsPlugin.java. */
interface SystemBarsPlugin {
  setColors(options: { background: string; dark: boolean }): Promise<void>
  getInsets(): Promise<SafeAreaInsets>
  addListener(event: 'insets', fn: (e: SafeAreaInsets) => void): Promise<{ remove: () => void }>
}

/** How much of each edge the system bars and any display cutout occupy, in CSS px. */
interface SafeAreaInsets {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

/**
 * Colours the Android status and navigation bars to match the app's theme.
 *
 * The bars are transparent and the page is drawn behind them, so the colour
 * itself comes from the page. What is still needed natively is the icon
 * contrast — light icons on a dark background and vice versa — and the window
 * colour behind the WebView for the moment before the page paints.
 *
 * A no-op in a browser, and failures are swallowed: bars in the last theme's
 * colour are a blemish, not a reason to break rendering.
 */
export function applySystemBars(background: string, dark: boolean): void {
  if (!isNative()) return
  void SystemBars.setColors({ background, dark }).catch(() => {})
}

/**
 * Publishes the real system bar insets as CSS variables.
 *
 * `env(safe-area-inset-*)` is the standard way to do this and is what the CSS
 * falls back to, but in an Android WebView it reports the display cutout alone —
 * the camera notch — and knows nothing about the status bar or the gesture
 * handle. On a phone without a cutout every value is zero, which puts the top
 * bar under the clock and the bottom bar under the gesture handle. The native
 * side can measure them properly, so it does, and the result overrides the
 * fallback on :root.
 *
 * Re-applied on every change, because the insets are not constant: rotating
 * moves the cutout, and switching between gesture and button navigation changes
 * the bottom inset by about 30px.
 */
export async function trackSafeAreaInsets(): Promise<void> {
  if (!isNative()) return

  const apply = (insets: SafeAreaInsets) => {
    const root = document.documentElement.style
    root.setProperty('--safe-top', `${insets.top ?? 0}px`)
    root.setProperty('--safe-bottom', `${insets.bottom ?? 0}px`)
    root.setProperty('--safe-left', `${insets.left ?? 0}px`)
    root.setProperty('--safe-right', `${insets.right ?? 0}px`)
  }

  try {
    // Asked for once as well as subscribed to: the first inset dispatch happens
    // at layout, which is usually before any of this JavaScript has run, and a
    // page that only ever listens would miss it and lay out under the bars.
    await SystemBars.addListener('insets', apply)
    apply(await SystemBars.getInsets())
  } catch {
    // An older build of the app without the plugin. The CSS env() fallback
    // still applies, which is worse but not broken.
  }
}
