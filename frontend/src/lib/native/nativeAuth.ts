import { registerPlugin } from '@capacitor/core'
import { apiBase, isNative } from '../serverConfig'

/**
 * SSO in the Android app.
 *
 * The web app signs in with SSO by following a link: the server sets a session
 * cookie and redirects back. None of that works here. The WebView is on its own
 * origin, cookies cannot cross that boundary, and following the link at all just
 * hands the user to the system browser looking at someone else's copy of the
 * app — which is exactly the bug this replaces.
 *
 * So the flow is the one RFC 8252 defines for native apps:
 *
 *   1. generate a random verifier, and send only its SHA-256 digest
 *   2. open the provider's flow in a Custom Tab
 *   3. the server deep-links back with a single-use code
 *   4. redeem code + verifier for a bearer token
 *
 * The verifier never leaves the device until step 4, which is what makes the
 * deep link safe to lose: Android lets any app register a custom scheme, so the
 * code has to be worthless to whoever else might receive it.
 */

/** Implemented by mobile/android/.../NativeAuthPlugin.java. */
interface NativeAuthPlugin {
  startSSO(options: { url: string }): Promise<void>
  consumeAuthCode(): Promise<{ code?: string | null }>
  addListener(event: 'authCode', fn: () => void): Promise<{ remove: () => Promise<void> }>
}

const NativeAuth = registerPlugin<NativeAuthPlugin>('NativeAuth')

/** How long to wait for the user to finish signing in before giving up. */
const SSO_TIMEOUT_MS = 5 * 60 * 1000

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * A fresh verifier and the challenge derived from it.
 *
 * crypto.subtle is why the WebView is served over https rather than a custom
 * scheme — see mobile/capacitor.config.ts. It does not exist outside a secure
 * context, and this is one of two places that depends on it.
 */
async function makePKCEPair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

/**
 * Raised when the user came back without finishing. Not an error to report.
 */
export const SSO_CANCELLED = 'sso-cancelled'

/**
 * Waits for the deep link to bring a code back.
 *
 * Both a plugin event and a check on becoming visible, because neither alone is
 * enough: the event is missed if the WebView was destroyed while the browser was
 * in front, and the visibility check is what covers that. They race, and the
 * plugin hands the code out exactly once, so whichever arrives first wins and
 * the other finds nothing.
 *
 * Becoming visible with no code waiting also means something: the user backed
 * out of the browser. Android delivers the deep link through onNewIntent, which
 * runs before the activity resumes, so by the time the page is visible again a
 * successful sign-in has already been stashed. No code at that point is an
 * abandoned one — which is worth detecting, because otherwise backing out
 * leaves a spinner running for the full timeout with nothing coming.
 *
 * That conclusion is only drawn after the app has actually been away. Without
 * that guard, any momentary loss of focus while the browser is still opening
 * would cancel a sign-in the user had not even started.
 */
async function awaitAuthCode(signal: AbortSignal): Promise<string> {
  const existing = await NativeAuth.consumeAuthCode()
  if (existing.code) return existing.code

  return new Promise<string>((resolve, reject) => {
    let done = false
    let wasHidden = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      cleanup().then(fn, fn)
    }

    const collect = async (): Promise<boolean> => {
      if (done) return false
      const { code } = await NativeAuth.consumeAuthCode()
      if (!code) return false
      finish(() => resolve(code))
      return true
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true
        return
      }
      void collect().then(got => {
        if (!got && wasHidden) finish(() => reject(new Error(SSO_CANCELLED)))
      })
    }

    const onEvent = () => { void collect() }

    document.addEventListener('visibilitychange', onVisibility)
    const handle = NativeAuth.addListener('authCode', onEvent)

    const cleanup = async () => {
      document.removeEventListener('visibilitychange', onVisibility)
      signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      try {
        ;(await handle).remove()
      } catch {
        // The listener is gone with the page anyway.
      }
    }

    function onAbort() {
      finish(() => reject(new Error(SSO_CANCELLED)))
    }
    signal.addEventListener('abort', onAbort)
    const timer = setTimeout(
      () => finish(() => reject(new Error('Sign-in timed out. Please try again.'))),
      SSO_TIMEOUT_MS,
    )
  })
}

/** The code and the verifier that proves it is ours to redeem. */
export interface SSOResult {
  code: string
  verifier: string
}

/**
 * Runs the browser half of SSO and resolves once the code is back.
 *
 * Returns null on web, where the plain link works and none of this is needed.
 * The caller exchanges the result for a token; that step is an ordinary API
 * call and lives with the others in api.ts.
 */
export async function startNativeSSO(signal: AbortSignal): Promise<SSOResult | null> {
  if (!isNative()) return null
  const { verifier, challenge } = await makePKCEPair()
  // The scheme is appended by the plugin, which is the only side that knows
  // which build this is.
  await NativeAuth.startSSO({
    url: `${apiBase()}/api/auth/oidc/login?native=${encodeURIComponent(challenge)}`,
  })
  const code = await awaitAuthCode(signal)
  return { code, verifier }
}
