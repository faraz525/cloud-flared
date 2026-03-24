# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

CloudFlared Search — a self-hosted AI-powered web search API on Cloudflare Workers. It gives an OpenClaw personal AI assistant (running on a Raspberry Pi) web search capabilities via MCP.

## Monorepo Structure

Two independent TypeScript packages with no shared code:

- **`worker/`** — Cloudflare Worker deployed to CF's edge. Receives URLs, crawls them via Browser Rendering `/markdown` API, extracts structured content via Workers AI (Llama 3.3 70B), caches in D1, returns AI-summarized results.
- **`mcp-server/`** — MCP stdio server that runs on the Pi. Bridges OpenClaw to the Worker: queries SearXNG locally for URLs, filters/deduplicates them, sends to the Worker.

## Commands

### Worker (`cd worker`)
```
npm test              # run all tests (vitest)
npm run test:watch    # watch mode
npx vitest run tests/cache.test.ts   # single test file
npx wrangler dev      # local dev server (hits real CF services, costs neurons)
npx wrangler deploy   # deploy to Cloudflare
```

### MCP Server (`cd mcp-server`)
```
npm test              # run all tests (vitest)
npm run build         # compile to dist/ via tsc
npm start             # run the stdio MCP server (needs env vars)
npx vitest run tests/filter.test.ts  # single test file
```

## Architecture: The Pipeline

```
OpenClaw (Pi) calls web_search tool
    |
MCP Server: SearXNG (localhost) -> filter URLs -> POST to Worker
    |
Worker pipeline: validate -> cache lookup -> crawl -> extract -> cache store -> summarize -> respond
```

**Worker pipeline** (`worker/src/index.ts`): Each step is a separate module. Uncached URLs are crawled in parallel (`Promise.all`). Every layer degrades gracefully — cache miss proceeds without cache, AI failure returns raw content, crawl failure skips that URL.

**MCP Server** (`mcp-server/src/index.ts`): Registers a single `web_search` tool. Never use `console.log` — it corrupts the stdio JSON-RPC stream. Use `console.error` only.

## Key Technical Details

- **Worker bindings** (in `wrangler.toml`): `env.AI` (Workers AI), `env.DB` (D1 SQLite), `env.CF_ACCOUNT_ID` and `env.CF_API_TOKEN` (secrets for Browser Rendering REST API).
- **Worker uses the Browser Rendering REST API** (`/markdown` endpoint), not the Puppeteer binding. This is a deliberate deviation from the spec — `/markdown` is synchronous and cheaper; `/crawl` is async with job polling.
- **MCP server uses `NodeNext` module resolution** — all relative imports require `.js` extensions (e.g., `import { foo } from "./bar.js"`). The Worker uses `bundler` resolution (no extensions needed) because Wrangler handles bundling.
- **Cloudflare types** (`Ai`, `D1Database`, `BaseAiTextGenerationModels`) are ambient globals from `@cloudflare/workers-types`. The Worker tsconfig includes `tests/**/*.ts` so these types are available in test files.
- **Auth**: Worker is protected by Cloudflare Access Service Token. MCP server sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on every request.
- **D1 cache key**: URLs are SHA-256 hashed to 64-char hex strings. TTL-based expiry (24h default), no active eviction.

## Environment Variables (MCP Server)

```
SEARXNG_URL=http://localhost:8080
WORKER_URL=https://cloud-flared.<subdomain>.workers.dev
CF_ACCESS_CLIENT_ID=<from Zero Trust dashboard>
CF_ACCESS_CLIENT_SECRET=<from Zero Trust dashboard>
```

## Specs and Plans

- Design spec: `docs/superpowers/specs/2026-03-23-cloudflared-search-design.md`
- Implementation plan: `docs/superpowers/plans/2026-03-23-cloudflared-search-plan.md`
