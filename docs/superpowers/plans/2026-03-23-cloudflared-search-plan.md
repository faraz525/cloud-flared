# CloudFlared Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted AI-powered search/crawl API on Cloudflare Workers that integrates with OpenClaw via MCP, giving it web search capabilities.

**Architecture:** Pi runs SearXNG (URL discovery) and an MCP server (bridge). Cloudflare Worker receives URLs, fetches content via Browser Rendering `/markdown` endpoint, extracts structured data via Workers AI, caches in D1, and returns AI-summarized results. Two independent packages: `worker/` (Cloudflare) and `mcp-server/` (Pi).

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, D1 (SQLite), Workers AI (Llama 3.3 70B), Browser Rendering REST API, @modelcontextprotocol/sdk, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-cloudflared-search-design.md`

---

## Spec Deviations

The spec describes using Browser Rendering `/crawl` + `/json` as separate steps. This plan uses `/markdown` + Workers AI (`env.AI.run`) instead because:
- The `/crawl` endpoint is **async** (returns a job ID, requires polling) — designed for site-wide crawls, not individual pages.
- Since SearXNG provides us specific URLs (not seed URLs for discovery), single-page endpoints are simpler and faster.
- The `/markdown` endpoint is synchronous, cheaper (no AI neurons burned), and gives us raw content we can cache independently.
- We call Workers AI directly for extraction, giving us full control over the prompt and schema per query.

The end result is functionally equivalent to the spec: render page → extract → cache → summarize.

## File Structure

```
cloud-flared/
├── .gitignore                           # node_modules, dist, .wrangler
├── worker/                              # Cloudflare Worker (search API)
│   ├── wrangler.toml                    # Bindings: D1, AI. Compat flags.
│   ├── package.json                     # Dependencies: wrangler, vitest
│   ├── tsconfig.json
│   ├── vitest.config.ts                 # Vitest config with CF types
│   ├── schema.sql                       # D1 table definitions
│   ├── src/
│   │   ├── index.ts                     # Entry point: routing + orchestration
│   │   ├── types.ts                     # Shared types (Env, request/response shapes)
│   │   ├── validate.ts                  # Request validation (URL schemes, max_urls)
│   │   ├── cache.ts                     # D1 read/write (lookup by url_hash, store, TTL check)
│   │   ├── crawl.ts                     # Browser Rendering /markdown calls
│   │   ├── extract.ts                   # Workers AI: markdown -> structured content
│   │   ├── summarize.ts                 # Workers AI: all content + query -> summary
│   │   └── hash.ts                      # SHA-256 URL hashing utility
│   └── tests/
│       ├── validate.test.ts
│       ├── cache.test.ts
│       ├── crawl.test.ts
│       ├── extract.test.ts
│       ├── summarize.test.ts
│       └── index.test.ts               # Integration: full pipeline
├── mcp-server/                          # MCP server (runs on Pi)
│   ├── package.json                     # Dependencies: @modelcontextprotocol/sdk, zod
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                     # MCP server entry: registers web_search tool
│   │   ├── types.ts                     # SearchResponse type (shared with Worker)
│   │   ├── searxng.ts                   # SearXNG HTTP client
│   │   ├── filter.ts                    # URL dedup, blocklist, diversity
│   │   └── worker-client.ts             # Cloudflare Worker HTTP client
│   └── tests/
│       ├── searxng.test.ts
│       ├── filter.test.ts
│       └── worker-client.test.ts
└── docs/
```

---

## Task 1: Worker Project Scaffolding

**Files:**
- Create: `.gitignore`
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/vitest.config.ts`
- Create: `worker/wrangler.toml`
- Create: `worker/src/types.ts`

- [ ] **Step 0: Create root .gitignore**

```
node_modules/
dist/
.wrangler/
.dev.vars
```

- [ ] **Step 1: Create worker/package.json**

```json
{
  "name": "cloud-flared-worker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260301.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create worker/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Note: `tests/` is included so that `@cloudflare/workers-types` ambient types (`Ai`, `D1Database`, etc.) are available in test files.

- [ ] **Step 2b: Create worker/vitest.config.ts**

Vitest runs in Node.js, which doesn't have Cloudflare-specific globals. This config ensures tests can reference CF types.

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
  },
})
```

- [ ] **Step 3: Create worker/wrangler.toml**

Note: `database_id` will be filled in after running `wrangler d1 create`. The `CF_ACCOUNT_ID` and `CF_API_TOKEN` are set as secrets via `wrangler secret put`.

```toml
name = "cloud-flared"
main = "src/index.ts"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "cloud-flared-cache"
database_id = "<fill-after-d1-create>"
```

- [ ] **Step 4: Create worker/src/types.ts**

These are the shared types used across all modules. The `Env` interface matches the wrangler.toml bindings.

```typescript
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
```

- [ ] **Step 5: Install dependencies and verify**

Run: `cd worker && npm install`
Expected: node_modules created, no errors

- [ ] **Step 6: Commit**

```bash
git add .gitignore worker/package.json worker/tsconfig.json worker/vitest.config.ts worker/wrangler.toml worker/src/types.ts
git commit -m "feat: scaffold worker project with types and config"
```

---

## Task 2: URL Hashing Utility

**Files:**
- Create: `worker/src/hash.ts`
- Create: `worker/tests/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// worker/tests/hash.test.ts
import { describe, it, expect } from "vitest"
import { hashUrl } from "../src/hash"

describe("hashUrl", () => {
  it("returns a 64-char hex string for a URL", async () => {
    const result = await hashUrl("https://example.com")
    expect(result).toMatch(/^[a-f0-9]{64}$/)
  })

  it("returns the same hash for the same URL", async () => {
    const a = await hashUrl("https://example.com/page")
    const b = await hashUrl("https://example.com/page")
    expect(a).toBe(b)
  })

  it("returns different hashes for different URLs", async () => {
    const a = await hashUrl("https://example.com/a")
    const b = await hashUrl("https://example.com/b")
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run tests/hash.test.ts`
Expected: FAIL — `hashUrl` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// worker/src/hash.ts
export async function hashUrl(url: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(url)
  const buffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(buffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}
```

Note: Uses the Web Crypto API (`crypto.subtle`), which is available in both Cloudflare Workers and Node.js. No external dependencies needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run tests/hash.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/hash.ts worker/tests/hash.test.ts
git commit -m "feat: add SHA-256 URL hashing utility"
```

---

## Task 3: Request Validation

**Files:**
- Create: `worker/src/validate.ts`
- Create: `worker/tests/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/tests/validate.test.ts
import { describe, it, expect } from "vitest"
import { validateSearchRequest } from "../src/validate"

describe("validateSearchRequest", () => {
  it("accepts a valid request", () => {
    const result = validateSearchRequest({
      urls: ["https://example.com"],
      query: "test query",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_urls).toBe(5) // default
    }
  })

  it("rejects missing urls", () => {
    const result = validateSearchRequest({ query: "test" })
    expect(result.success).toBe(false)
  })

  it("rejects empty urls array", () => {
    const result = validateSearchRequest({ urls: [], query: "test" })
    expect(result.success).toBe(false)
  })

  it("rejects missing query", () => {
    const result = validateSearchRequest({ urls: ["https://example.com"] })
    expect(result.success).toBe(false)
  })

  it("rejects non-HTTP URLs", () => {
    const result = validateSearchRequest({
      urls: ["file:///etc/passwd"],
      query: "test",
    })
    expect(result.success).toBe(false)
  })

  it("rejects javascript: URLs", () => {
    const result = validateSearchRequest({
      urls: ["javascript:alert(1)"],
      query: "test",
    })
    expect(result.success).toBe(false)
  })

  it("rejects URLs longer than 2048 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(2040)
    const result = validateSearchRequest({
      urls: [longUrl],
      query: "test",
    })
    expect(result.success).toBe(false)
  })

  it("caps max_urls at 10", () => {
    const result = validateSearchRequest({
      urls: ["https://example.com"],
      query: "test",
      max_urls: 50,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_urls).toBe(10)
    }
  })

  it("filters out invalid URLs and keeps valid ones", () => {
    const result = validateSearchRequest({
      urls: ["https://good.com", "ftp://bad.com", "https://also-good.com"],
      query: "test",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.urls).toEqual(["https://good.com", "https://also-good.com"])
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run tests/validate.test.ts`
Expected: FAIL — `validateSearchRequest` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// worker/src/validate.ts
import type { SearchRequest } from "./types"

const MAX_URL_LENGTH = 2048
const MAX_URLS_CEILING = 10
const DEFAULT_MAX_URLS = 5

interface ValidationSuccess {
  success: true
  data: Required<SearchRequest>
}

interface ValidationFailure {
  success: false
  error: string
}

type ValidationResult = ValidationSuccess | ValidationFailure

function isValidUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

export function validateSearchRequest(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { success: false, error: "Request body must be a JSON object" }
  }

  const { urls, query, max_urls } = body as Record<string, unknown>

  if (!Array.isArray(urls) || urls.length === 0) {
    return { success: false, error: "urls must be a non-empty array" }
  }

  if (typeof query !== "string" || query.trim().length === 0) {
    return { success: false, error: "query must be a non-empty string" }
  }

  const validUrls = urls.filter(
    (u): u is string => typeof u === "string" && isValidUrl(u)
  )

  if (validUrls.length === 0) {
    return { success: false, error: "No valid HTTP/HTTPS URLs provided" }
  }

  const cappedMaxUrls = Math.min(
    typeof max_urls === "number" && max_urls > 0 ? max_urls : DEFAULT_MAX_URLS,
    MAX_URLS_CEILING
  )

  return {
    success: true,
    data: {
      urls: validUrls,
      query: query.trim(),
      max_urls: cappedMaxUrls,
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run tests/validate.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/validate.ts worker/tests/validate.test.ts
git commit -m "feat: add request validation with URL scheme and length checks"
```

---

## Task 4: D1 Cache Module

**Files:**
- Create: `worker/schema.sql`
- Create: `worker/src/cache.ts`
- Create: `worker/tests/cache.test.ts`

- [ ] **Step 1: Create the D1 schema**

```sql
-- worker/schema.sql
CREATE TABLE IF NOT EXISTS crawled_pages (
  url_hash     TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  title        TEXT,
  content      TEXT,
  raw_markdown TEXT,
  crawled_at   INTEGER NOT NULL,
  ttl_hours    INTEGER DEFAULT 24
);

CREATE TABLE IF NOT EXISTS search_log (
  id           TEXT PRIMARY KEY,
  query        TEXT NOT NULL,
  urls         TEXT NOT NULL,
  summary      TEXT,
  neurons_used INTEGER,
  latency_ms   INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_log_query ON search_log(query);
```

- [ ] **Step 2: Write the failing tests**

Cache tests use a mock D1Database. We test the logic, not the real database.

```typescript
// worker/tests/cache.test.ts
import { describe, it, expect, vi } from "vitest"
import { lookupCachedPages, storeCachedPage, logSearch } from "../src/cache"

function mockD1() {
  const rows: Record<string, unknown>[] = []
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({ success: true }),
  }
  const db = {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn().mockResolvedValue([]),
  }
  return { db: db as unknown as D1Database, stmt, rows }
}

describe("lookupCachedPages", () => {
  it("returns empty map when no pages are cached", async () => {
    const { db } = mockD1()
    const result = await lookupCachedPages(db, ["hash1", "hash2"])
    expect(result.size).toBe(0)
  })

  it("calls prepare with correct SQL for batch lookup", async () => {
    const { db } = mockD1()
    await lookupCachedPages(db, ["hash1"])
    expect(db.prepare).toHaveBeenCalled()
  })
})

describe("storeCachedPage", () => {
  it("calls prepare with INSERT OR REPLACE", async () => {
    const { db } = mockD1()
    await storeCachedPage(db, {
      url_hash: "abc123",
      url: "https://example.com",
      title: "Test",
      content: "extracted content",
      raw_markdown: "# Test",
      crawled_at: Date.now(),
      ttl_hours: 24,
    })
    const sql = db.prepare.mock.calls[0][0] as string
    expect(sql).toContain("INSERT OR REPLACE")
  })
})

describe("logSearch", () => {
  it("inserts a search log entry", async () => {
    const { db } = mockD1()
    await logSearch(db, {
      query: "test query",
      urls: ["https://example.com"],
      summary: "test summary",
      neurons_used: 100,
      latency_ms: 500,
    })
    const sql = db.prepare.mock.calls[0][0] as string
    expect(sql).toContain("INSERT INTO search_log")
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd worker && npx vitest run tests/cache.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Write minimal implementation**

```typescript
// worker/src/cache.ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && npx vitest run tests/cache.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add worker/schema.sql worker/src/cache.ts worker/tests/cache.test.ts
git commit -m "feat: add D1 cache module with lookup, store, and search logging"
```

---

## Task 5: Browser Rendering Crawl Module

**Files:**
- Create: `worker/src/crawl.ts`
- Create: `worker/tests/crawl.test.ts`

This module calls the Browser Rendering `/markdown` REST API endpoint for each URL. The endpoint renders the page in headless Chrome (handling JavaScript) and returns clean markdown.

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/tests/crawl.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { crawlUrls, type CrawlResult } from "../src/crawl"

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch)
  mockFetch.mockReset()
})

describe("crawlUrls", () => {
  it("returns markdown content for a successful crawl", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: true,
        result: "# Page Title\n\nSome content here."
      }), { status: 200 })
    )

    const results = await crawlUrls(
      ["https://example.com"],
      "test-account-id",
      "test-api-token"
    )

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://example.com")
    expect(results[0].success).toBe(true)
    expect(results[0].markdown).toContain("Page Title")
  })

  it("marks failed URLs without throwing", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    )

    const results = await crawlUrls(
      ["https://down-site.com"],
      "test-account-id",
      "test-api-token"
    )

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBeDefined()
  })

  it("crawls multiple URLs in parallel", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result: "# Content"
      }), { status: 200 })
    )

    const urls = ["https://a.com", "https://b.com", "https://c.com"]
    const results = await crawlUrls(urls, "acct", "token")

    expect(results).toHaveLength(3)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it("sends correct auth headers and body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: "# Content" }), { status: 200 })
    )

    await crawlUrls(["https://example.com"], "my-account", "my-token")

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toContain("my-account")
    expect(url).toContain("/browser-rendering/markdown")
    expect(options.headers["Authorization"]).toBe("Bearer my-token")
    expect(JSON.parse(options.body)).toEqual({ url: "https://example.com" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run tests/crawl.test.ts`
Expected: FAIL — `crawlUrls` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// worker/src/crawl.ts
export interface CrawlResult {
  url: string
  success: boolean
  markdown: string | null
  error?: string
}

async function crawlSingleUrl(
  url: string,
  accountId: string,
  apiToken: string
): Promise<CrawlResult> {
  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/markdown`

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    })

    if (!response.ok) {
      return {
        url,
        success: false,
        markdown: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = (await response.json()) as { success: boolean; result: string }

    if (!data.success) {
      return { url, success: false, markdown: null, error: "API returned success: false" }
    }

    return { url, success: true, markdown: data.result }
  } catch (err) {
    return {
      url,
      success: false,
      markdown: null,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

export async function crawlUrls(
  urls: string[],
  accountId: string,
  apiToken: string
): Promise<CrawlResult[]> {
  const results = await Promise.all(
    urls.map((url) => crawlSingleUrl(url, accountId, apiToken))
  )
  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run tests/crawl.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/crawl.ts worker/tests/crawl.test.ts
git commit -m "feat: add Browser Rendering crawl module with parallel fetching"
```

---

## Task 6: AI Extraction Module

**Files:**
- Create: `worker/src/extract.ts`
- Create: `worker/tests/extract.test.ts`

This module takes raw markdown from the crawl step and uses Workers AI to extract structured content (title, main content, relevance to query).

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/tests/extract.test.ts
import { describe, it, expect, vi } from "vitest"
import { extractContent, type ExtractionResult } from "../src/extract"

function mockAi(response: unknown) {
  return {
    run: vi.fn().mockResolvedValue(response),
  } as unknown as Ai
}

describe("extractContent", () => {
  it("extracts title and content from markdown", async () => {
    const ai = mockAi({
      response: JSON.stringify({
        title: "Best Pizza NYC",
        main_content: "Joe's Pizza is the best...",
        relevance: "high",
      }),
    })

    const result = await extractContent(
      ai,
      "# Best Pizza NYC\n\nJoe's Pizza is the best...",
      "https://example.com/pizza",
      "best pizza in NYC"
    )

    expect(result.title).toBe("Best Pizza NYC")
    expect(result.main_content).toContain("Joe's Pizza")
    expect(result.relevance).toBe("high")
  })

  it("returns fallback on malformed AI response", async () => {
    const ai = mockAi({ response: "not valid json" })

    const result = await extractContent(
      ai,
      "# Some Page\n\nContent here",
      "https://example.com",
      "test query"
    )

    expect(result.title).toBe("")
    expect(result.main_content).toContain("Some Page")
    expect(result.relevance).toBe("medium")
  })

  it("returns fallback when AI throws", async () => {
    const ai = {
      run: vi.fn().mockRejectedValue(new Error("rate limited")),
    } as unknown as Ai

    const result = await extractContent(
      ai,
      "# Fallback\n\nRaw content",
      "https://example.com",
      "test"
    )

    expect(result.main_content).toContain("Fallback")
    expect(result.extraction_failed).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run tests/extract.test.ts`
Expected: FAIL — `extractContent` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// worker/src/extract.ts
export interface ExtractionResult {
  title: string
  main_content: string
  relevance: "high" | "medium" | "low"
  extraction_failed: boolean
}

interface AiExtraction {
  title: string
  main_content: string
  relevance: "high" | "medium" | "low"
}

function truncateMarkdown(markdown: string, maxChars: number): string {
  return markdown.length > maxChars
    ? markdown.slice(0, maxChars) + "\n\n[truncated]"
    : markdown
}

function fallbackExtraction(markdown: string): ExtractionResult {
  return {
    title: "",
    main_content: truncateMarkdown(markdown, 2000),
    relevance: "medium",
    extraction_failed: true,
  }
}

export async function extractContent(
  ai: Ai,
  markdown: string,
  url: string,
  query: string
): Promise<ExtractionResult> {
  try {
    const prompt = `You are a content extraction assistant. Given a webpage's markdown content, extract structured information.

The user's search query was: "${query}"
The page URL is: ${url}

Extract the following as JSON (no markdown, no code fences):
{
  "title": "the page title",
  "main_content": "the relevant content from the page, focused on what relates to the user's query. Max 1500 characters.",
  "relevance": "high" if directly answers the query, "medium" if somewhat related, "low" if barely related
}

Page content:
${truncateMarkdown(markdown, 4000)}`

    const response = (await ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as BaseAiTextGenerationModels,
      { prompt }
    )) as { response?: string }

    const text = response.response ?? ""
    const parsed = JSON.parse(text) as AiExtraction

    return {
      title: parsed.title ?? "",
      main_content: parsed.main_content ?? "",
      relevance: parsed.relevance ?? "medium",
      extraction_failed: false,
    }
  } catch {
    return fallbackExtraction(markdown)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run tests/extract.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/extract.ts worker/tests/extract.test.ts
git commit -m "feat: add Workers AI content extraction with fallback"
```

---

## Task 7: AI Summarization Module

**Files:**
- Create: `worker/src/summarize.ts`
- Create: `worker/tests/summarize.test.ts`

Takes all extracted content + the original query and produces a focused synthesis.

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/tests/summarize.test.ts
import { describe, it, expect, vi } from "vitest"
import { summarizeSources, type SummarizeResult } from "../src/summarize"

function mockAi(response: string) {
  return {
    run: vi.fn().mockResolvedValue({ response }),
  } as unknown as Ai
}

describe("summarizeSources", () => {
  it("produces a summary from multiple sources", async () => {
    const ai = mockAi("Based on multiple sources, Joe's Pizza is the top pick.")

    const result = await summarizeSources(ai, "best pizza NYC", [
      { url: "https://a.com", title: "Pizza Guide", content: "Joe's is #1" },
      { url: "https://b.com", title: "NYC Eats", content: "Joe's and Di Fara" },
    ])

    expect(result.summary).toContain("Joe's Pizza")
    expect(result.ai_skipped).toBe(false)
  })

  it("returns null summary when AI fails", async () => {
    const ai = {
      run: vi.fn().mockRejectedValue(new Error("429 rate limited")),
    } as unknown as Ai

    const result = await summarizeSources(ai, "test", [
      { url: "https://a.com", title: "Test", content: "content" },
    ])

    expect(result.summary).toBeNull()
    expect(result.ai_skipped).toBe(true)
  })

  it("returns null summary for empty sources", async () => {
    const ai = mockAi("should not be called")

    const result = await summarizeSources(ai, "test", [])

    expect(result.summary).toBeNull()
    expect(ai.run).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run tests/summarize.test.ts`
Expected: FAIL — `summarizeSources` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// worker/src/summarize.ts
interface SourceInput {
  url: string
  title: string
  content: string
}

export interface SummarizeResult {
  summary: string | null
  ai_skipped: boolean
}

export async function summarizeSources(
  ai: Ai,
  query: string,
  sources: SourceInput[]
): Promise<SummarizeResult> {
  if (sources.length === 0) {
    return { summary: null, ai_skipped: false }
  }

  try {
    const sourceText = sources
      .map(
        (s, i) =>
          `[Source ${i + 1}: ${s.title}](${s.url})\n${s.content}`
      )
      .join("\n\n---\n\n")

    const prompt = `You are a research assistant. The user searched for: "${query}"

Below are excerpts from ${sources.length} web sources. Synthesize a clear, concise answer to the user's query. Cite sources using [Source N] notation. Focus on directly answering the query. If sources disagree, note the disagreement.

${sourceText}

Provide your synthesis (2-4 paragraphs max):`

    const response = (await ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as BaseAiTextGenerationModels,
      { prompt }
    )) as { response?: string }

    const summary = response.response?.trim() ?? null

    return { summary, ai_skipped: false }
  } catch {
    return { summary: null, ai_skipped: true }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run tests/summarize.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/summarize.ts worker/tests/summarize.test.ts
git commit -m "feat: add Workers AI summarization with graceful degradation"
```

---

## Task 8: Worker Entry Point (Orchestration)

**Files:**
- Create: `worker/src/index.ts`
- Create: `worker/tests/index.test.ts`

This wires all modules together into the Worker's `fetch` handler. This is the pipeline from the spec: validate → cache lookup → crawl → extract → cache store → summarize → respond.

- [ ] **Step 1: Write the failing tests**

```typescript
// worker/tests/index.test.ts
import { describe, it, expect, vi } from "vitest"

// We test the handler by calling it directly with mock env
// These are integration-style tests of the orchestration logic

describe("Worker handler", () => {
  it("returns 405 for non-POST requests", async () => {
    const { default: worker } = await import("../src/index")
    const request = new Request("https://worker.dev/search", { method: "GET" })
    const response = await worker.fetch(request, mockEnv())
    expect(response.status).toBe(405)
  })

  it("returns 404 for unknown routes", async () => {
    const { default: worker } = await import("../src/index")
    const request = new Request("https://worker.dev/unknown", { method: "POST" })
    const response = await worker.fetch(request, mockEnv())
    expect(response.status).toBe(404)
  })

  it("returns 400 for invalid request body", async () => {
    const { default: worker } = await import("../src/index")
    const request = new Request("https://worker.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bad: "data" }),
    })
    const response = await worker.fetch(request, mockEnv())
    expect(response.status).toBe(400)
  })
})

function mockEnv() {
  return {
    AI: { run: vi.fn().mockResolvedValue({ response: "{}" }) },
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
    },
    CF_ACCOUNT_ID: "test-account",
    CF_API_TOKEN: "test-token",
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run tests/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// worker/src/index.ts
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

      // Cache the result (fire and forget — don't block response)
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
    const okSources = allSources.filter((s) => s.status === "ok" || s.status === "extract_failed")

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
        neurons_used: 0, // Workers AI doesn't expose neuron count per call
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run tests/index.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Run all worker tests**

Run: `cd worker && npx vitest run`
Expected: All tests across all files PASS

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/tests/index.test.ts
git commit -m "feat: wire up Worker entry point with full pipeline orchestration"
```

---

## Task 9: MCP Server — SearXNG Client

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/src/searxng.ts`
- Create: `mcp-server/tests/searxng.test.ts`

- [ ] **Step 1: Create mcp-server/package.json**

```json
{
  "name": "cloud-flared-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create mcp-server/tsconfig.json**

Note: Uses `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` because the MCP server is compiled with plain `tsc` and run directly by Node.js (`node dist/index.js`). Node.js ESM requires explicit `.js` extensions on imports, and `NodeNext` enforces this at compile time. This differs from the Worker's tsconfig which uses `"bundler"` because Wrangler handles bundling.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "tests", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd mcp-server && npm install`

- [ ] **Step 4: Write the failing tests**

```typescript
// mcp-server/tests/searxng.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { querySearxng, type SearxngResult } from "../src/searxng"

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch)
  mockFetch.mockReset()
})

describe("querySearxng", () => {
  it("returns parsed results from SearXNG", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        results: [
          { url: "https://a.com", title: "Result A", content: "Snippet A" },
          { url: "https://b.com", title: "Result B", content: "Snippet B" },
        ],
      }))
    )

    const results = await querySearxng("http://localhost:8080", "test query")

    expect(results).toHaveLength(2)
    expect(results[0].url).toBe("https://a.com")
    expect(results[0].title).toBe("Result A")
    expect(results[0].snippet).toBe("Snippet A")
  })

  it("passes query as URL param with format=json", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }))
    )

    await querySearxng("http://localhost:8080", "my search")

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain("q=my+search")
    expect(calledUrl).toContain("format=json")
  })

  it("returns empty array when SearXNG is down", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))

    const results = await querySearxng("http://localhost:8080", "test")

    expect(results).toEqual([])
  })

  it("returns empty array for malformed response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not json", { status: 200 })
    )

    const results = await querySearxng("http://localhost:8080", "test")

    expect(results).toEqual([])
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd mcp-server && npx vitest run tests/searxng.test.ts`
Expected: FAIL — `querySearxng` not found

- [ ] **Step 6: Write minimal implementation**

Note: All relative imports in MCP server source files must use `.js` extensions (e.g., `import { foo } from "./bar.js"`) because we use `module: "NodeNext"`. TypeScript resolves `.js` imports to `.ts` files at compile time, then the compiled output has the correct `.js` extension for Node.js ESM.

```typescript
// mcp-server/src/searxng.ts
export interface SearxngResult {
  url: string
  title: string
  snippet: string
}

interface SearxngApiResponse {
  results: Array<{
    url: string
    title: string
    content: string
  }>
}

export async function querySearxng(
  baseUrl: string,
  query: string
): Promise<SearxngResult[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: "json",
    })

    const response = await fetch(`${baseUrl}/search?${params}`)
    const data = (await response.json()) as SearxngApiResponse

    if (!Array.isArray(data.results)) return []

    return data.results.map((r) => ({
      url: r.url,
      title: r.title ?? "",
      snippet: r.content ?? "",
    }))
  } catch {
    return []
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd mcp-server && npx vitest run tests/searxng.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 8: Commit**

```bash
git add mcp-server/package.json mcp-server/tsconfig.json mcp-server/src/searxng.ts mcp-server/tests/searxng.test.ts
git commit -m "feat: add MCP server scaffolding and SearXNG client"
```

---

## Task 10: MCP Server — URL Filtering

**Files:**
- Create: `mcp-server/src/filter.ts`
- Create: `mcp-server/tests/filter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/tests/filter.test.ts
import { describe, it, expect } from "vitest"
import { filterUrls } from "../src/filter"
import type { SearxngResult } from "../src/searxng"

function result(url: string, title = "Title"): SearxngResult {
  return { url, title, snippet: "snippet" }
}

describe("filterUrls", () => {
  it("deduplicates URLs with same domain and similar path", () => {
    const results = [
      result("https://example.com/article/pizza"),
      result("https://example.com/article/pizza?ref=twitter"),
    ]
    const filtered = filterUrls(results, 5)
    expect(filtered).toHaveLength(1)
  })

  it("removes blocklisted domains", () => {
    const results = [
      result("https://pinterest.com/pin/12345"),
      result("https://quora.com/What-is-pizza"),
      result("https://good-site.com/article"),
    ]
    const filtered = filterUrls(results, 5)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].url).toContain("good-site.com")
  })

  it("enforces source diversity — max 2 per domain", () => {
    const results = [
      result("https://food.com/a"),
      result("https://food.com/b"),
      result("https://food.com/c"),
      result("https://other.com/x"),
    ]
    const filtered = filterUrls(results, 5)
    const foodCount = filtered.filter((r) => r.url.includes("food.com")).length
    expect(foodCount).toBeLessThanOrEqual(2)
  })

  it("limits output to maxUrls", () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      result(`https://site-${i}.com/page`)
    )
    const filtered = filterUrls(results, 5)
    expect(filtered).toHaveLength(5)
  })

  it("returns empty array for empty input", () => {
    expect(filterUrls([], 5)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npx vitest run tests/filter.test.ts`
Expected: FAIL — `filterUrls` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// mcp-server/src/filter.ts
import type { SearxngResult } from "./searxng.js"

const BLOCKED_DOMAINS = new Set([
  "pinterest.com",
  "quora.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linkedin.com",
  "youtube.com",
])

const MAX_PER_DOMAIN = 2

function getDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname
    // Strip www. prefix
    return hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function getPathKey(url: string): string {
  try {
    const parsed = new URL(url)
    // Normalize: strip query params and trailing slash for dedup
    return parsed.hostname + parsed.pathname.replace(/\/$/, "")
  } catch {
    return url
  }
}

function isBlocklisted(domain: string): boolean {
  return BLOCKED_DOMAINS.has(domain) ||
    [...BLOCKED_DOMAINS].some((blocked) => domain.endsWith(`.${blocked}`))
}

export function filterUrls(
  results: SearxngResult[],
  maxUrls: number
): SearxngResult[] {
  const seen = new Set<string>()
  const domainCount = new Map<string, number>()
  const filtered: SearxngResult[] = []

  for (const result of results) {
    if (filtered.length >= maxUrls) break

    const domain = getDomain(result.url)
    if (!domain || isBlocklisted(domain)) continue

    const pathKey = getPathKey(result.url)
    if (seen.has(pathKey)) continue
    seen.add(pathKey)

    const count = domainCount.get(domain) ?? 0
    if (count >= MAX_PER_DOMAIN) continue
    domainCount.set(domain, count + 1)

    filtered.push(result)
  }

  return filtered
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npx vitest run tests/filter.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/filter.ts mcp-server/tests/filter.test.ts
git commit -m "feat: add URL filtering with dedup, blocklist, and diversity"
```

---

## Task 11: MCP Server — Worker Client

**Files:**
- Create: `mcp-server/src/worker-client.ts`
- Create: `mcp-server/tests/worker-client.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/tests/worker-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callWorker } from "../src/worker-client"

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch)
  mockFetch.mockReset()
})

describe("callWorker", () => {
  const config = {
    workerUrl: "https://cloud-flared.example.workers.dev",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  }

  it("sends correct headers and body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        query: "test",
        summary: "result",
        sources: [],
        meta: {},
      }))
    )

    await callWorker(config, ["https://a.com"], "test query", 5)

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe("https://cloud-flared.example.workers.dev/search")
    expect(options.headers["CF-Access-Client-Id"]).toBe("test-client-id")
    expect(options.headers["CF-Access-Client-Secret"]).toBe("test-client-secret")

    const body = JSON.parse(options.body)
    expect(body.urls).toEqual(["https://a.com"])
    expect(body.query).toBe("test query")
  })

  it("throws on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 })
    )

    await expect(
      callWorker(config, ["https://a.com"], "test", 5)
    ).rejects.toThrow()
  })

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))

    await expect(
      callWorker(config, ["https://a.com"], "test", 5)
    ).rejects.toThrow("ECONNREFUSED")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npx vitest run tests/worker-client.test.ts`
Expected: FAIL — `callWorker` not found

- [ ] **Step 3a: Create mcp-server/src/types.ts**

```typescript
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
```

- [ ] **Step 3b: Write minimal implementation**

```typescript
// mcp-server/src/worker-client.ts
import type { SearchResponse } from "./types.js"

export interface WorkerConfig {
  workerUrl: string
  clientId: string
  clientSecret: string
}

export async function callWorker(
  config: WorkerConfig,
  urls: string[],
  query: string,
  maxUrls: number
): Promise<SearchResponse> {
  const response = await fetch(`${config.workerUrl}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Access-Client-Id": config.clientId,
      "CF-Access-Client-Secret": config.clientSecret,
    },
    body: JSON.stringify({ urls, query, max_urls: maxUrls }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Worker returned ${response.status}: ${text}`)
  }

  return (await response.json()) as SearchResponse
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npx vitest run tests/worker-client.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/worker-client.ts mcp-server/src/types.ts mcp-server/tests/worker-client.test.ts
git commit -m "feat: add Worker HTTP client with Cloudflare Access auth"
```

---

## Task 12: MCP Server Entry Point

**Files:**
- Create: `mcp-server/src/index.ts`

This wires the SearXNG client, URL filter, and Worker client into an MCP server that exposes a `web_search` tool.

- [ ] **Step 1: Write the implementation**

```typescript
// mcp-server/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { querySearxng } from "./searxng.js"
import { filterUrls } from "./filter.js"
import { callWorker } from "./worker-client.js"

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080"
const WORKER_URL = process.env.WORKER_URL ?? ""
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID ?? ""
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? ""
const MAX_URLS = 5

const server = new McpServer({
  name: "cloud-flared",
  version: "0.1.0",
})

server.tool(
  "web_search",
  "Search the web using SearXNG and Cloudflare-powered crawling and AI summarization. Returns a synthesized answer with sources.",
  {
    query: z.string().describe("The search query"),
  },
  async ({ query }) => {
    // Step 1: Query SearXNG
    const searxngResults = await querySearxng(SEARXNG_URL, query)

    if (searxngResults.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "no_results",
              message: `No search results found for: "${query}"`,
            }),
          },
        ],
      }
    }

    // Step 2: Filter URLs
    const filtered = filterUrls(searxngResults, MAX_URLS)
    const urls = filtered.map((r) => r.url)

    // Step 3: Call Worker
    try {
      const result = await callWorker(
        {
          workerUrl: WORKER_URL,
          clientId: CF_ACCESS_CLIENT_ID,
          clientSecret: CF_ACCESS_CLIENT_SECRET,
        },
        urls,
        query,
        MAX_URLS
      )

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "worker_error",
              message: `Failed to process search: ${message}`,
            }),
          },
        ],
      }
    }
  }
)

async function main() {
  if (!WORKER_URL) {
    console.error("WORKER_URL environment variable is required")
    process.exit(1)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Note: never use console.log in stdio MCP servers — it corrupts the JSON-RPC stream.
  // Use console.error for diagnostics.
  console.error("cloud-flared MCP server running on stdio")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify build**

Run: `cd mcp-server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all MCP server tests**

Run: `cd mcp-server && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat: wire up MCP server entry point with web_search tool"
```

---

## Task 13: Deploy Worker + Create D1 Database

**Files:**
- Modify: `worker/wrangler.toml` (fill in database_id)

- [ ] **Step 1: Create D1 database**

Run: `cd worker && npx wrangler d1 create cloud-flared-cache`
Expected: Database created. Copy the `database_id` from the output.

- [ ] **Step 2: Update wrangler.toml with database_id**

Replace `<fill-after-d1-create>` with the actual database_id from step 1.

- [ ] **Step 3: Apply schema to D1**

Run: `cd worker && npx wrangler d1 execute cloud-flared-cache --remote --file=schema.sql`
Expected: Tables created successfully.

- [ ] **Step 4: Set Worker secrets**

Run:
```bash
cd worker
npx wrangler secret put CF_ACCOUNT_ID
# paste your account ID when prompted
npx wrangler secret put CF_API_TOKEN
# paste your API token when prompted
```

- [ ] **Step 5: Deploy Worker**

Run: `cd worker && npx wrangler deploy`
Expected: Worker deployed to `https://cloud-flared.<subdomain>.workers.dev`

- [ ] **Step 6: Smoke test with curl**

Run:
```bash
curl -X POST https://cloud-flared.<subdomain>.workers.dev/search \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://en.wikipedia.org/wiki/Pizza"], "query": "what is pizza", "max_urls": 1}'
```
Expected: JSON response with summary and sources.

Note: This will fail with 403 if Cloudflare Access is already configured. Set up Access after confirming the Worker itself works, or temporarily test without Access.

- [ ] **Step 7: Commit**

```bash
git add worker/wrangler.toml
git commit -m "chore: configure D1 database and deploy worker"
```

---

## Task 14: Configure Cloudflare Access

Protect the Worker endpoint so only your Pi can call it.

- [ ] **Step 1: Create a Service Token**

In the Cloudflare Zero Trust dashboard:
1. Go to Access → Service Auth → Service Tokens
2. Click "Create Service Token"
3. Name it `cloud-flared-pi`
4. Save the `CF-Access-Client-Id` and `CF-Access-Client-Secret` values — they're only shown once.

- [ ] **Step 2: Create an Access Application**

In the Cloudflare Zero Trust dashboard:
1. Go to Access → Applications → Add an Application
2. Choose "Self-hosted"
3. Set the application domain to `cloud-flared.<your-subdomain>.workers.dev`
4. Add a policy: "Service Token" → select `cloud-flared-pi`
5. Save

- [ ] **Step 3: Verify auth is enforced**

Test without auth (should be blocked):
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://cloud-flared.<subdomain>.workers.dev/search \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"], "query": "test"}'
```
Expected: `403`

Test with auth (should succeed):
```bash
curl -X POST https://cloud-flared.<subdomain>.workers.dev/search \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: <your-client-id>" \
  -H "CF-Access-Client-Secret: <your-client-secret>" \
  -d '{"urls": ["https://en.wikipedia.org/wiki/Pizza"], "query": "what is pizza", "max_urls": 1}'
```
Expected: JSON response with summary.

---

## Task 15: End-to-End Manual Test

This is the "tweet test" from the spec.

- [ ] **Step 1: Start SearXNG on Pi**

If not already running:
```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng
```

Verify: `curl http://localhost:8080/search?q=test&format=json` returns results.

- [ ] **Step 2: Build and start MCP server**

```bash
cd mcp-server && npm run build
```

Test manually (send JSON-RPC over stdio):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  WORKER_URL=https://cloud-flared.<subdomain>.workers.dev \
  SEARXNG_URL=http://localhost:8080 \
  CF_ACCESS_CLIENT_ID=<id> \
  CF_ACCESS_CLIENT_SECRET=<secret> \
  node dist/index.js
```
Expected: Response listing the `web_search` tool.

- [ ] **Step 3: Configure OpenClaw**

Add to OpenClaw's MCP config (path depends on your OpenClaw setup):
```json
{
  "mcpServers": {
    "cloud-flared": {
      "command": "node",
      "args": ["/path/to/cloud-flared/mcp-server/dist/index.js"],
      "env": {
        "SEARXNG_URL": "http://localhost:8080",
        "WORKER_URL": "https://cloud-flared.<subdomain>.workers.dev",
        "CF_ACCESS_CLIENT_ID": "<from Zero Trust dashboard>",
        "CF_ACCESS_CLIENT_SECRET": "<from Zero Trust dashboard>"
      }
    }
  }
}
```

- [ ] **Step 4: Test full pipeline via OpenClaw**

Ask OpenClaw: "What are the best pizza places in NYC?"

Verify:
1. OpenClaw calls the `web_search` tool
2. SearXNG returns URLs
3. Worker crawls, extracts, summarizes
4. OpenClaw displays a coherent answer with sources

- [ ] **Step 5: Test caching**

Ask the same question again. Check `meta.urls_cached` in the response — it should be > 0 and the response should be faster.

- [ ] **Step 6: Commit any final config changes**

```bash
git add -A
git commit -m "chore: finalize end-to-end integration"
```

---

## Design Decision Notes

- **`max_urls` after cache lookup:** The Worker trims uncached URLs to `max_urls` but returns ALL cached hits (they're free). This means total sources returned can exceed `max_urls`. This is intentional — cached results cost nothing to serve, and dropping them would degrade response quality. The `max_urls` cap controls cost (crawl budget), not response size.
- **`ai_skipped: false` for empty sources:** When there are zero sources, AI is not called and `ai_skipped` is `false`. This is technically accurate — AI wasn't "skipped due to failure," it simply had nothing to process.
