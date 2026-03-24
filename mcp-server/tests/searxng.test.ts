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
