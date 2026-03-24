// mcp-server/src/types.ts
export interface SearchResponse {
  query: string
  summary: string | null
  sources: Array<{
    url: string
    title: string
    extracted_content: string
    relevance: string
    status: string
    cached: boolean
  }>
  meta: {
    urls_crawled: number
    urls_cached: number
    urls_failed: number
    neurons_used: number
    latency_ms: number
    ai_skipped: boolean
  }
}
