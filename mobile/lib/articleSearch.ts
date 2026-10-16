// Pure fetch/parsing logic for the article search box, split out of App.tsx
// so URL construction, response parsing, and the empty-query short-circuit
// can be unit tested without React Native or a real network.

export type ArticleSearchItem = {
  id: string
  title: string
  slug: string
  [key: string]: unknown
}

export type ArticleSearchPage<T> = {
  data: T[]
  hasNextPage: boolean
}

const DEFAULT_LIMIT = 30

export function buildArticleSearchUrl(apiBase: string, query: string, page: number, limit: number = DEFAULT_LIMIT): string {
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
    search: query,
  })
  return `${apiBase.replace(/\/$/, '')}/api/articles?${params.toString()}`
}

export type SearchArticlesOptions = {
  limit?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

// Thin wrapper over GET /api/articles?search=...: the same endpoint and
// pagination shape the normal feed already uses, just with the `search`
// param wired up. Callers are responsible for debouncing keystrokes and for
// ignoring a resolved response that is no longer the latest request (e.g. by
// comparing against a request-id ref) - this function only owns the fetch
// itself and honours `signal` for cancellation.
export async function searchArticles<T = ArticleSearchItem>(
  apiBase: string,
  query: string,
  page: number,
  options: SearchArticlesOptions = {},
): Promise<ArticleSearchPage<T>> {
  const trimmed = query.trim()
  if (!trimmed) return { data: [], hasNextPage: false }

  const { limit = DEFAULT_LIMIT, signal, fetchImpl = fetch } = options
  const response = await fetchImpl(buildArticleSearchUrl(apiBase, trimmed, page, limit), { signal })
  if (!response.ok) {
    throw new Error('Unable to search research right now. Please try again.')
  }
  const json = await response.json()
  const data: T[] = Array.isArray(json?.data) ? json.data : []
  const hasNextPage = Boolean(json?.pagination?.hasNextPage)
  return { data, hasNextPage }
}
