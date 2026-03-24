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
