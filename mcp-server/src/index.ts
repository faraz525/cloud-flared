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
  "cloud_search",
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
