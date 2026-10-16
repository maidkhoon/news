import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArticleSearchUrl, searchArticles } from './articleSearch.ts'

const API_BASE = 'https://news-api.example.com'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response
}

test('buildArticleSearchUrl encodes the query and includes pagination params', () => {
  const url = buildArticleSearchUrl(API_BASE + '/', 'RBI rate cut & Nifty', 2, 10)
  assert.equal(url, 'https://news-api.example.com/api/articles?limit=10&page=2&search=RBI+rate+cut+%26+Nifty')
})

test('searchArticles returns an article that was never part of the initially loaded feed page', async () => {
  // Simulates a backend-search hit for an older article that the paginated
  // home feed (page 1, limit 30) would never have loaded into memory.
  const olderArticle = { id: 'old-1', title: 'RBI holds repo rate steady', slug: 'rbi-holds-repo-rate-steady' }
  let requestedUrl = ''
  const fetchImpl = (async (url: string) => {
    requestedUrl = url
    return jsonResponse({ data: [olderArticle], pagination: { hasNextPage: false } })
  }) as typeof fetch

  const result = await searchArticles(API_BASE, 'repo rate', 1, { fetchImpl })

  assert.deepEqual(result, { data: [olderArticle], hasNextPage: false })
  assert.match(requestedUrl, /search=repo\+rate/)
})

test('searchArticles trims the query and does not fetch when the trimmed query is empty', async () => {
  let called = false
  const fetchImpl = (async () => { called = true; return jsonResponse({ data: [] }) }) as typeof fetch

  const result = await searchArticles(API_BASE, '   ', 1, { fetchImpl })

  assert.deepEqual(result, { data: [], hasNextPage: false })
  assert.equal(called, false)
})

test('searchArticles surfaces a readable error on a non-ok response instead of throwing a raw fetch error', async () => {
  const fetchImpl = (async () => jsonResponse({ error: 'boom' }, { ok: false, status: 500 })) as typeof fetch

  await assert.rejects(
    () => searchArticles(API_BASE, 'nifty', 1, { fetchImpl }),
    /Unable to search research/
  )
})

test('searchArticles propagates an AbortError untouched so callers can detect a cancelled/superseded request', async () => {
  const controller = new AbortController()
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    controller.abort()
    const error = new Error('The operation was aborted.')
    error.name = 'AbortError'
    throw error
  }) as typeof fetch

  await assert.rejects(
    () => searchArticles(API_BASE, 'sensex', 1, { fetchImpl, signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError'
  )
})

test('searchArticles reads pagination.hasNextPage so a second search page can be loaded', async () => {
  const fetchImpl = (async (url: string) => {
    assert.match(url, /page=2/)
    return jsonResponse({ data: [{ id: 'a', title: 'A', slug: 'a' }], pagination: { hasNextPage: true } })
  }) as typeof fetch

  const result = await searchArticles(API_BASE, 'crypto', 2, { fetchImpl })
  assert.equal(result.hasNextPage, true)
})

test('searchArticles defaults missing data/pagination fields to a safe empty page', async () => {
  const fetchImpl = (async () => jsonResponse({})) as typeof fetch
  const result = await searchArticles(API_BASE, 'anything', 1, { fetchImpl })
  assert.deepEqual(result, { data: [], hasNextPage: false })
})
