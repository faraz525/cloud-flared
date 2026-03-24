import type { CachedPage } from "./types"

export async function lookupCachedPages(
  db: D1Database,
  urlHashes: string[]
): Promise<Map<string, CachedPage>> {
  const result = new Map<string, CachedPage>()
  if (urlHashes.length === 0) return result

  const now = Math.floor(Date.now() / 1000)

  const lookups = urlHashes.map((hash) =>
    db
      .prepare(
        "SELECT * FROM crawled_pages WHERE url_hash = ? AND (crawled_at + ttl_hours * 3600) > ?"
      )
      .bind(hash, now)
      .first<CachedPage>()
  )

  const rows = await Promise.all(lookups)

  for (const row of rows) {
    if (row) {
      result.set(row.url_hash, row)
    }
  }

  return result
}

export async function storeCachedPage(
  db: D1Database,
  page: CachedPage
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO crawled_pages
       (url_hash, url, title, content, raw_markdown, crawled_at, ttl_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      page.url_hash,
      page.url,
      page.title,
      page.content,
      page.raw_markdown,
      page.crawled_at,
      page.ttl_hours
    )
    .run()
}

interface SearchLogEntry {
  query: string
  urls: string[]
  summary: string | null
  neurons_used: number
  latency_ms: number
}

export async function logSearch(
  db: D1Database,
  entry: SearchLogEntry
): Promise<void> {
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  await db
    .prepare(
      `INSERT INTO search_log
       (id, query, urls, summary, neurons_used, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      entry.query,
      JSON.stringify(entry.urls),
      entry.summary,
      entry.neurons_used,
      entry.latency_ms,
      now
    )
    .run()
}
