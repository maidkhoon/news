// Pure parsing/classification for the Google OAuth deep-link callback, split
// out of App.tsx so the distinct outcomes (success / cancelled / provider
// error / malformed redirect) can be unit tested without React Native.

export type WebBrowserAuthResult = { type: string; url?: string }

export type GoogleAuthCallbackResult =
  | { type: 'success'; code: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | { type: 'unexpected'; message: string }

function readParam(url: URL, name: string): string | null {
  const fromQuery = url.searchParams.get(name)
  if (fromQuery) return fromQuery
  // Some providers return errors after the fragment (implicit-flow shape)
  // even when the happy path is a PKCE `code` query param.
  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
    return hashParams.get(name)
  }
  return null
}

export function parseGoogleAuthCallback(
  browserResult: WebBrowserAuthResult,
  expectedRedirectTo: string
): GoogleAuthCallbackResult {
  if (browserResult.type === 'cancel' || browserResult.type === 'dismiss') {
    return { type: 'cancelled' }
  }
  if (browserResult.type !== 'success' || !browserResult.url) {
    return { type: 'error', message: 'Google sign-in was not completed. Please try again.' }
  }

  let callbackUrl: URL
  try {
    callbackUrl = new URL(browserResult.url)
  } catch {
    return { type: 'unexpected', message: 'Google sign-in returned an unrecognized callback link. Please try again.' }
  }

  let expected: URL
  try {
    expected = new URL(expectedRedirectTo)
  } catch {
    return { type: 'unexpected', message: 'Google sign-in redirect target is misconfigured. Please try again.' }
  }

  const stripTrailingSlash = (path: string) => path.replace(/\/$/, '')
  const matchesExpectedTarget =
    callbackUrl.protocol === expected.protocol &&
    callbackUrl.host === expected.host &&
    stripTrailingSlash(callbackUrl.pathname) === stripTrailingSlash(expected.pathname)
  if (!matchesExpectedTarget) {
    return { type: 'unexpected', message: 'Google sign-in returned an unexpected redirect. Please try again.' }
  }

  const code = readParam(callbackUrl, 'code')
  if (code) return { type: 'success', code }

  const errorDescription = readParam(callbackUrl, 'error_description')
  const errorCode = readParam(callbackUrl, 'error')
  if (errorDescription || errorCode) {
    return { type: 'error', message: errorDescription || errorCode || 'Google sign-in failed.' }
  }

  return { type: 'error', message: 'Google sign-in callback did not contain an authorization code.' }
}
