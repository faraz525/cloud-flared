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
