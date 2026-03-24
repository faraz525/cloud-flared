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
