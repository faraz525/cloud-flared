export interface Env {
  AI: Ai
  DB: D1Database
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
}

export interface SearchRequest {
  urls: string[]
  query: string
  max_urls?: number
}

export interface SourceResult {
  url: string
  title: string
  extracted_content: string
  relevance: "high" | "medium" | "low"
  status: "ok" | "crawl_failed" | "extract_failed"
  cached: boolean
}

export interface SearchResponse {
  query: string
  summary: string | null
  sources: SourceResult[]
  meta: {
    urls_crawled: number
    urls_cached: number
    urls_failed: number
    neurons_used: number
    latency_ms: number
    ai_skipped: boolean
  }
}

export interface CachedPage {
  url_hash: string
  url: string
  title: string
  content: string
  raw_markdown: string
  crawled_at: number
  ttl_hours: number
}
