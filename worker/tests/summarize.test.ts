import { describe, it, expect, vi } from "vitest"
import { summarizeSources, type SummarizeResult } from "../src/summarize"

function mockAi(response: string) {
  return {
    run: vi.fn().mockResolvedValue({ response }),
  } as unknown as Ai
}

describe("summarizeSources", () => {
  it("produces a summary from multiple sources", async () => {
    const ai = mockAi("Based on multiple sources, Joe's Pizza is the top pick.")

    const result = await summarizeSources(ai, "best pizza NYC", [
      { url: "https://a.com", title: "Pizza Guide", content: "Joe's is #1" },
      { url: "https://b.com", title: "NYC Eats", content: "Joe's and Di Fara" },
    ])

    expect(result.summary).toContain("Joe's Pizza")
    expect(result.ai_skipped).toBe(false)
  })

  it("returns null summary when AI fails", async () => {
    const ai = {
      run: vi.fn().mockRejectedValue(new Error("429 rate limited")),
    } as unknown as Ai

    const result = await summarizeSources(ai, "test", [
      { url: "https://a.com", title: "Test", content: "content" },
    ])

    expect(result.summary).toBeNull()
    expect(result.ai_skipped).toBe(true)
  })

  it("returns null summary for empty sources", async () => {
    const ai = mockAi("should not be called")

    const result = await summarizeSources(ai, "test", [])

    expect(result.summary).toBeNull()
    expect(ai.run).not.toHaveBeenCalled()
  })
})
