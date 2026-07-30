import { registerPlugin } from '@capacitor/core'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../SystemBarsPlugin.java. */
interface SystemBarsPlugin {
  setColors(options: { background: string; dark: boolean }): Promise<void>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

/**
 * Colours the Android status and navigation bars to match the app's theme.
 *
 * The exact native counterpart of the `theme-color` meta tag the web app already
 * maintains — that tag is what makes the installed PWA's system bars match, and
 * a WebView has no equivalent because the bars belong to the Activity, not the
 * page. Both are updated from the same place for the same reason.
 *
 * A no-op in a browser, and failures are swallowed: bars in last theme's colour
 * are a blemish, not a reason to break rendering.
 */
export function applySystemBars(background: string, dark: boolean): void {
  if (!isNative()) return
  void SystemBars.setColors({ background, dark }).catch(() => {})
}
