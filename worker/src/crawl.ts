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
