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
