import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGoogleAuthCallback } from './googleAuthCallback.ts'

const REDIRECT_TO = 'bazaarnexa://auth/callback'

test('success: extracts the authorization code from a matching callback', () => {
  const result = parseGoogleAuthCallback(
    { type: 'success', url: `${REDIRECT_TO}?code=abc123&state=xyz` },
    REDIRECT_TO
  )
  assert.deepEqual(result, { type: 'success', code: 'abc123' })
})

test('cancelled: user dismissing the browser is silent, not an error', () => {
  assert.deepEqual(parseGoogleAuthCallback({ type: 'cancel' }, REDIRECT_TO), { type: 'cancelled' })
  assert.deepEqual(parseGoogleAuthCallback({ type: 'dismiss' }, REDIRECT_TO), { type: 'cancelled' })
})

test('error: provider error_description surfaces as a distinct error message', () => {
  const result = parseGoogleAuthCallback(
    { type: 'success', url: `${REDIRECT_TO}?error=access_denied&error_description=User+denied+access` },
    REDIRECT_TO
  )
  assert.deepEqual(result, { type: 'error', message: 'User denied access' })
})

test('error: missing code and no error params reports the original callback bug', () => {
  const result = parseGoogleAuthCallback({ type: 'success', url: `${REDIRECT_TO}?state=xyz` }, REDIRECT_TO)
  assert.deepEqual(result, {
    type: 'error',
    message: 'Google sign-in callback did not contain an authorization code.'
  })
})

test('unexpected: callback URL does not match the redirect scheme/host/path', () => {
  const result = parseGoogleAuthCallback(
    { type: 'success', url: 'https://evil.example.com/auth/callback?code=abc123' },
    REDIRECT_TO
  )
  assert.equal(result.type, 'unexpected')
})

test('unexpected: malformed callback URL does not throw', () => {
  const result = parseGoogleAuthCallback({ type: 'success', url: 'not a url' }, REDIRECT_TO)
  assert.equal(result.type, 'unexpected')
})

test('error: browser result type is neither success, cancel, nor dismiss', () => {
  const result = parseGoogleAuthCallback({ type: 'opened' }, REDIRECT_TO)
  assert.equal(result.type, 'error')
})

test('error params found in the URL fragment instead of the query string are still read', () => {
  const result = parseGoogleAuthCallback(
    { type: 'success', url: `${REDIRECT_TO}#error=server_error&error_description=Something+broke` },
    REDIRECT_TO
  )
  assert.deepEqual(result, { type: 'error', message: 'Something broke' })
})
