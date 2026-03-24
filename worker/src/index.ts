import type { Env, SearchResponse, SourceResult } from "./types"
import { validateSearchRequest } from "./validate"
import { lookupCachedPages, storeCachedPage, logSearch } from "./cache"
import { crawlUrls } from "./crawl"
import { extractContent } from "./extract"
import { summarizeSources } from "./summarize"
import { hashUrl } from "./hash"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname !== "/search") {
      return new Response("Not found", { status: 404 })
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }

    const startTime = Date.now()

    // Step 1: Validate
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400)
    }

    const validation = validateSearchRequest(body)
    if (!validation.success) {
      return jsonResponse({ error: validation.error }, 400)
    }

    const { urls, query, max_urls } = validation.data

    // Step 2: Cache lookup
    const urlHashPairs = await Promise.all(
      urls.map(async (u) => ({ url: u, hash: await hashUrl(u) }))
    )

    let cachedPages = new Map<string, import("./types").CachedPage>()
    try {
      cachedPages = await lookupCachedPages(
        env.DB,
        urlHashPairs.map((p) => p.hash)
      )
    } catch {
      // Cache unavailable — proceed without it
    }

    // Separate cached from uncached
    const cachedResults: SourceResult[] = []
    const uncachedPairs: { url: string; hash: string }[] = []

    for (const pair of urlHashPairs) {
      const cached = cachedPages.get(pair.hash)
      if (cached) {
        cachedResults.push({
          url: cached.url,
          title: cached.title ?? "",
          extracted_content: cached.content ?? "",
          relevance: "medium",
          status: "ok",
          cached: true,
        })
      } else {
        uncachedPairs.push(pair)
      }
    }

    // Trim uncached to max_urls (cached are free, so we keep all of them)
    const toFetch = uncachedPairs.slice(0, max_urls)

    // Step 3: Crawl uncached URLs in parallel
    const crawlResults = toFetch.length > 0
      ? await crawlUrls(
          toFetch.map((p) => p.url),
          env.CF_ACCOUNT_ID,
          env.CF_API_TOKEN
        )
      : []

    // Steps 4 + 5: Extract and cache
    const freshResults: SourceResult[] = []

    const extractAndCacheTasks = crawlResults.map(async (crawl, i) => {
      if (!crawl.success || !crawl.markdown) {
        freshResults.push({
          url: crawl.url,
          title: "",
          extracted_content: "",
          relevance: "low",
          status: "crawl_failed",
          cached: false,
        })
        return
      }

      const extraction = await extractContent(
        env.AI,
        crawl.markdown,
        crawl.url,
        query
      )

      const source: SourceResult = {
        url: crawl.url,
        title: extraction.title,
        extracted_content: extraction.main_content,
        relevance: extraction.relevance,
        status: extraction.extraction_failed ? "extract_failed" : "ok",
        cached: false,
      }
      freshResults.push(source)

      // Cache the result
      const hash = toFetch[i].hash
      try {
        await storeCachedPage(env.DB, {
          url_hash: hash,
          url: crawl.url,
          title: extraction.title,
          content: extraction.main_content,
          raw_markdown: crawl.markdown,
          crawled_at: Math.floor(Date.now() / 1000),
          ttl_hours: 24,
        })
      } catch {
        // Cache write failed — non-fatal
      }
    })

    await Promise.all(extractAndCacheTasks)

    // Combine all sources
    const allSources = [...cachedResults, ...freshResults]
    const okSources = allSources.filter(
      (s) => s.status === "ok" || s.status === "extract_failed"
    )

    // Step 6: Summarize
    const summarizeInput = okSources.map((s) => ({
      url: s.url,
      title: s.title,
      content: s.extracted_content,
    }))

    const { summary, ai_skipped } = await summarizeSources(
      env.AI,
      query,
      summarizeInput
    )

    // Step 7: Respond
    const latencyMs = Date.now() - startTime

    const response: SearchResponse = {
      query,
      summary,
      sources: allSources,
      meta: {
        urls_crawled: freshResults.filter((s) => s.status !== "crawl_failed").length,
        urls_cached: cachedResults.length,
        urls_failed: freshResults.filter((s) => s.status === "crawl_failed").length,
        neurons_used: 0,
        latency_ms: latencyMs,
        ai_skipped,
      },
    }

    // Log search (fire and forget)
    try {
      await logSearch(env.DB, {
        query,
        urls,
        summary,
        neurons_used: 0,
        latency_ms: latencyMs,
      })
    } catch {
      // Logging failed — non-fatal
    }

    return jsonResponse(response, 200)
  },
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
