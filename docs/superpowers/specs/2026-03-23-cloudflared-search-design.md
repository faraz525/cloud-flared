# CloudFlared Search — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Repo:** cloud-flared

## Overview

CloudFlared Search is a self-hosted AI-powered web search and crawl API built on Cloudflare Workers. It serves as a web_search provider for an OpenClaw personal AI assistant running on a Raspberry Pi.

The system splits work between the Pi (lightweight query routing) and Cloudflare's edge (heavy crawling, AI extraction, and summarization), giving OpenClaw high-quality, RAG-optimized search results without third-party API keys or expensive infrastructure.

## Architecture (Approach B — Pi does Stage 1, Worker does Stage 2+3)

```
OpenClaw (Pi) -> SearXNG (localhost) -> gets URLs
       |
       |-- URLs --> Cloudflare Worker
                         |
                    +---------+---------+
                    |                   |
                 /crawl             Workers AI
                (Browser            (summarize)
                Rendering)
                    |
                D1 cache
                    |
              structured response
                    |
               OpenClaw (Pi)
```

### Why this architecture

- **Separation of concerns** — Pi handles lightweight local queries, Cloudflare handles heavy crawling and AI.
- **No tunnel dependency** — the Worker does not need to reach back to the Pi. If the tunnel goes down, the Worker still works given URLs.
- **Easiest to build and test** — the Worker has a dead simple interface: "here are URLs, crawl and summarize them." Can be tested with curl.

## Components

| Component | Where | What it does |
|---|---|---|
| SearXNG | Pi (Docker) | Stage 1 — query to URLs |
| MCP Server | Pi (Node.js/TypeScript) | Bridge — filters URLs, calls Worker |
| Worker | Cloudflare | Stage 2+3 — crawl, extract, summarize |
| D1 | Cloudflare | Cache — crawled pages + search history |
| Browser Rendering | Cloudflare | Headless Chrome for /crawl + /json |
| Workers AI | Cloudflare | Llama 3.3 70B for summarization |
| Cloudflare Access | Cloudflare | Auth — only the Pi can call the Worker |

## Authentication

The Worker endpoint is protected by a **Cloudflare Access Service Token**. This is a service-to-service auth mechanism (not browser-based).

**Setup:**
1. Create a Service Token in Cloudflare Zero Trust dashboard (generates a `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`)
2. Create an Access Application policy for the Worker's URL that requires the service token
3. The MCP server includes both headers on every request to the Worker

**MCP server sends these headers on every request:**
```
CF-Access-Client-Id: <client_id>
CF-Access-Client-Secret: <client_secret>
```

**Worker-side:** If the request reaches the Worker, it is already authenticated — Cloudflare Access sits in front and rejects unauthorized requests before they hit the Worker code. No token validation logic needed in the Worker itself.

## API Interface

### POST /search

**Request:**

```json
{
  "urls": [
    "https://example.com/article-1",
    "https://example.com/article-2"
  ],
  "query": "what are the best pizza places in NYC",
  "max_urls": 5
}
```

- `urls` — list of URLs to crawl and summarize (provided by SearXNG via the MCP server)
- `query` — the original search query, used to focus the AI summarization
- `max_urls` — optional safety valve, defaults to 5

**Response:**

```json
{
  "query": "what are the best pizza places in NYC",
  "summary": "Based on multiple sources, the top-rated pizza places in NYC are...",
  "sources": [
    {
      "url": "https://example.com/article-1",
      "title": "NYC's Best Pizza 2026",
      "extracted_content": "...",
      "relevance": "high",
      "status": "ok",
      "cached": false
    }
  ],
  "meta": {
    "urls_crawled": 5,
    "urls_cached": 2,
    "urls_failed": 0,
    "neurons_used": 847,
    "latency_ms": 3200,
    "ai_skipped": false
  }
}
```

### Design decisions

- **`urls` not a search query** — the Worker crawls and summarizes, it does not search. SearXNG already did that. Keeps the Worker focused and testable.
- **`query` passed along** — tells Workers AI what to focus on when summarizing. Without it, the AI would summarize everything blindly.
- **`max_urls`** — controls cost per request. Crawling is the expensive operation.
- **`meta`** — debugging visibility and Twitter demo material. Includes `ai_skipped` (boolean, true when Workers AI was unavailable) and `urls_failed` count.
- **`status` per source** — `"ok"`, `"crawl_failed"`, or `"cached"`. Communicates what happened for each URL.
- **`cached` per source** — transparency into what came from D1 vs fresh crawls.

## Worker Pipeline

```
Request arrives (POST /search)
    |
    v
1. Validate    -- Parse body, check auth, enforce max_urls
    |
    v
2. Cache lookup -- Check D1 for each URL (crawled recently?)
    |
    +--- cached URLs --> skip to step 6
    |
    v
3. Crawl       -- Browser Rendering /crawl for uncached URLs
    |
    v
4. Extract     -- /json endpoint, AI extracts structured content
    |
    v
5. Cache store -- Save extracted content to D1 with TTL
    |
    v
6. Summarize   -- Workers AI: given query + all content, produce focused summary
    |
    v
7. Respond     -- Return structured JSON
```

### Step details

1. **Validate** — malformed request rejected. URLs must be HTTP/HTTPS only (reject `file://`, `javascript:`, etc.), max 2048 chars each. URLs trimmed to max_urls **after** cache lookup (so cached URLs aren't discarded — they're free to serve). Auth handled by Cloudflare Access (if request reaches Worker, it is authorized).
2. **Cache lookup** — D1 lookup by URL hash. TTL-based: `crawled_at + (ttl_hours * 3600) > now()`. Expired entries get re-crawled.
3. **Crawl** — Cloudflare Browser Rendering `/crawl`. Headless Chrome renders JavaScript, handles SPAs. This is the expensive step. **Uncached URLs are crawled in parallel** (`Promise.all`) to stay within the Worker's 30-second CPU time limit. Sequential crawling of 5 URLs at ~2s each would risk hitting that ceiling.
4. **Extract** — `/json` endpoint sends page through Workers AI (Llama 3.3 70B) with a schema for title, main_content, author, date. Returns clean structured data.
5. **Cache store** — Save to D1 with 24h default TTL. Hash URL as key for fast lookups.
6. **Summarize** — Workers AI receives all extracted content + original query. Produces a focused synthesis with citations.
7. **Respond** — Package into response format and return.

### Why steps 3 and 4 are separate

The `/json` endpoint can crawl AND extract in one call. But separating them lets us cache at the raw content level and re-summarize cached content with different queries later without re-crawling.

## Data Model (D1)

```sql
-- What we've crawled
crawled_pages (
  url_hash     TEXT PRIMARY KEY,   -- SHA-256 of the URL
  url          TEXT NOT NULL,
  title        TEXT,
  content      TEXT,               -- extracted clean content
  raw_markdown TEXT,               -- raw crawl output (fallback)
  crawled_at   INTEGER NOT NULL,   -- unix timestamp
  ttl_hours    INTEGER DEFAULT 24
)

-- Search history
search_log (
  id           TEXT PRIMARY KEY,   -- UUID
  query        TEXT NOT NULL,
  urls         TEXT NOT NULL,      -- JSON array of URLs sent
  summary      TEXT,               -- the AI summary returned
  neurons_used INTEGER,
  latency_ms   INTEGER,
  created_at   INTEGER NOT NULL
)
```

### Design decisions

- **Two tables** — `crawled_pages` is URL-centric (shared across queries), `search_log` is query-centric (analytics, debugging, demo).
- **`url_hash` as primary key** — URLs can be 2000+ chars with special characters. SHA-256 hash is always 64 chars, fast lookups, no encoding issues.
- **`raw_markdown` alongside `content`** — fallback if AI extraction misses something. Avoids re-crawling to re-process.
- **TTL-based cache invalidation** — simple, predictable. 24h default. Expired entries re-crawled on next request. No active eviction — stale rows remain in D1 until re-requested. D1's 5GB free storage means this is a non-issue for personal usage (thousands of pages before it matters). If needed later, a scheduled Worker cron can purge entries older than 30 days.
- **Index on `search_log.query`** — `CREATE INDEX idx_search_log_query ON search_log(query)` for efficient lookup/analytics by query text.

## MCP Server (Pi-side integration)

A lightweight TypeScript MCP server (~100-150 lines) that bridges OpenClaw to the Cloudflare Worker.

### Pipeline

```
OpenClaw calls: web_search({ query: "best pizza in NYC" })
    |
    v
1. Query SearXNG     -- GET localhost:8080/search?q=...&format=json
   (~500-3000ms)       SearXNG queries upstream engines, returns 10-20 URLs
    |
    v
2. Filter & rank     -- Deduplicate, remove junk domains,
   URLs                pick top 5 most relevant
    |
    v
3. Call Worker        -- POST cloud-flared.workers.dev/search
                        { urls: [...], query: "...", max_urls: 5 }
    |
    v
Return structured results to OpenClaw
```

### URL filtering (Step 2)

SearXNG returns many URLs, some low-value. Filtering saves crawl budget:

- **Deduplicate** — same domain + similar path = keep one
- **Domain blocklist** — skip pinterest.com, quora.com, SEO farms, etc.
- **Source diversity** — spread across domains, don't send 5 URLs from the same site

Simple heuristic string matching, not AI. Keeps it fast.

### OpenClaw configuration

```json
{
  "mcpServers": {
    "cloud-flared": {
      "command": "node",
      "args": ["./mcp-server/index.js"],
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

Runs as a stdio MCP server — OpenClaw spawns it as a child process, communicates over stdin/stdout. No OpenClaw source modifications needed.

## Error Handling

Each layer degrades gracefully. The system returns the best result it can, never hangs.

### Fallback chain

```
Best case:  cache hit -> instant response
Good case:  crawl + AI extract + AI summarize -> full response
Okay case:  crawl + AI extract (AI summary fails) -> raw content
Worst case: crawl fails for all URLs -> clear error message
```

### Specific failure modes

| Failure | Handling |
|---|---|
| SearXNG returns no results | MCP server returns `{ error: "no_results" }`. OpenClaw's LLM can rephrase. |
| A URL fails to crawl | Skip it, proceed with remaining URLs. Mark as `"status": "crawl_failed"` in response. |
| Workers AI rate limited (429) | Return raw extracted content without summary. Set `meta.ai_skipped: true`. OpenClaw's LLM does its own summarization. |
| D1 cache unreachable | Proceed without cache. Crawl everything fresh. Log the error. |

### Principle

Cache is an optimization, not a requirement. AI summarization is an enhancement, not a dependency. The system works at every degradation level.

## Testing Strategy

### 1. Worker tests (unit + integration)

- Validation: malformed body -> 400, missing urls -> 400, excess urls -> trimmed
- Cache: insert D1 row, call /search with that URL -> verify crawl skipped
- Crawl: mock Browser Rendering responses -> verify extraction pipeline
- Summarize: mock Workers AI response -> verify summary format
- End-to-end: real call with known stable URL (Wikipedia) -> verify full pipeline

Run with `wrangler dev` (local Worker with real Cloudflare service access).

### 2. MCP server tests (unit, Vitest)

- SearXNG parsing: mock JSON response -> verify URL extraction
- URL filtering: duplicate/junk URLs -> verify deduplication and blocklist
- Worker call: mock Worker response -> verify response format
- Error paths: SearXNG down -> clean error. Worker down -> clean error.

### 3. Manual end-to-end ("tweet test")

1. Start SearXNG on Pi
2. Start MCP server on Pi
3. Deploy Worker to Cloudflare
4. Open OpenClaw
5. Ask: "what are the best pizza places in NYC?"
6. Verify full pipeline: OpenClaw -> web_search -> SearXNG -> Worker -> response
7. Ask same question again -> verify faster response (cache hit)

## Cost Estimate

| Service | Free Tier | Expected Usage | Cost |
|---|---|---|---|
| Workers | 100k req/day | Light | $0 |
| Browser Rendering | 10 min/day (free), 10 hr/mo (paid) | 5-10 crawls/day | $0 |
| Workers AI | 10k neurons/day | Summarization | $0-0.50/day |
| D1 | 5M reads/day, 100k writes/day | Cache ops | $0 |
| SearXNG | Self-hosted on Pi | Unlimited | $0 |

**Estimated total: $0-5/month** on Workers Paid plan ($5/mo base). Free tier sufficient for personal/demo usage.
