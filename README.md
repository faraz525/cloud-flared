# CloudFlared Search

A self-hosted AI-powered web search API built on Cloudflare Workers. Gives your [OpenClaw](https://github.com/openclaw/openclaw) personal AI assistant web search capabilities — no API keys, no third-party services, runs on the edge.

## How It Works

```
You ask OpenClaw a question
    |
    v
MCP Server (your Pi)
    |-- Queries SearXNG locally for URLs
    |-- Filters/deduplicates results
    |-- Sends URLs to Cloudflare Worker
    v
Cloudflare Worker (edge)
    |-- Crawls pages via Browser Rendering (headless Chrome)
    |-- Extracts content via Workers AI (Llama 3.3 70B)
    |-- Caches results in D1
    |-- Summarizes across all sources
    v
OpenClaw gets a synthesized answer with citations
```

## Stack

| Component | Technology | Where |
|---|---|---|
| Search index | [SearXNG](https://github.com/searxng/searxng) (Docker) | Raspberry Pi |
| MCP Server | TypeScript, @modelcontextprotocol/sdk | Raspberry Pi |
| Search API | Cloudflare Worker | Cloudflare Edge |
| Page rendering | Cloudflare Browser Rendering | Cloudflare Edge |
| AI extraction + summarization | Workers AI (Llama 3.3 70B) | Cloudflare Edge |
| Cache | Cloudflare D1 (SQLite) | Cloudflare Edge |
| Auth | Cloudflare Access (Service Token) | Cloudflare Edge |

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account
- A Raspberry Pi (or any machine) running [SearXNG](https://github.com/searxng/searxng) and [OpenClaw](https://github.com/openclaw/openclaw)

### 1. Deploy the Worker

```bash
cd worker
npm install

# Create the D1 database
npx wrangler d1 create cloud-flared-cache
# Update wrangler.toml with the database_id from output

# Apply the schema
npx wrangler d1 execute cloud-flared-cache --remote --file=schema.sql

# Set secrets
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN

# Deploy
npx wrangler deploy
```

### 2. Set up Cloudflare Access (optional but recommended)

1. Go to Cloudflare Zero Trust dashboard
2. Create a Service Token (`Access > Service Auth > Service Tokens`)
3. Create an Access Application for your Worker URL
4. Save the `CF-Access-Client-Id` and `CF-Access-Client-Secret`

### 3. Start SearXNG

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng
```

### 4. Configure OpenClaw

Add to your OpenClaw MCP config:

```json
{
  "mcpServers": {
    "cloud-flared": {
      "command": "node",
      "args": ["/path/to/cloud-flared/mcp-server/dist/index.js"],
      "env": {
        "SEARXNG_URL": "http://localhost:8080",
        "WORKER_URL": "https://cloud-flared.<your-subdomain>.workers.dev",
        "CF_ACCESS_CLIENT_ID": "<your-client-id>",
        "CF_ACCESS_CLIENT_SECRET": "<your-client-secret>"
      }
    }
  }
}
```

Build the MCP server first:

```bash
cd mcp-server
npm install
npm run build
```

## Development

```bash
# Worker tests
cd worker && npm test

# MCP server tests
cd mcp-server && npm test

# Local Worker dev server
cd worker && npx wrangler dev
```

## Cost

Essentially free for personal use. The Cloudflare Workers free tier covers 100k requests/day, 10 minutes/day of Browser Rendering, 10k AI neurons/day, and 5GB of D1 storage. The $5/month Workers Paid plan gives you significantly more headroom.

## License

MIT
