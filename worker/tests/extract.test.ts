import { describe, it, expect, vi } from "vitest"
import { extractContent, type ExtractionResult } from "../src/extract"

function mockAi(response: unknown) {
  return {
    run: vi.fn().mockResolvedValue(response),
  } as unknown as Ai
}

describe("extractContent", () => {
  it("extracts title and content from markdown", async () => {
    const ai = mockAi({
      response: JSON.stringify({
        title: "Best Pizza NYC",
        main_content: "Joe's Pizza is the best...",
        relevance: "high",
      }),
    })

    const result = await extractContent(
      ai,
      "# Best Pizza NYC\n\nJoe's Pizza is the best...",
      "https://example.com/pizza",
      "best pizza in NYC"
    )

    expect(result.title).toBe("Best Pizza NYC")
    expect(result.main_content).toContain("Joe's Pizza")
    expect(result.relevance).toBe("high")
  })

  it("returns fallback on malformed AI response", async () => {
    const ai = mockAi({ response: "not valid json" })

    const result = await extractContent(
      ai,
      "# Some Page\n\nContent here",
      "https://example.com",
      "test query"
    )

    expect(result.title).toBe("")
    expect(result.main_content).toContain("Some Page")
    expect(result.relevance).toBe("medium")
  })

  it("returns fallback when AI throws", async () => {
    const ai = {
      run: vi.fn().mockRejectedValue(new Error("rate limited")),
    } as unknown as Ai

    const result = await extractContent(
      ai,
      "# Fallback\n\nRaw content",
      "https://example.com",
      "test"
    )

    expect(result.main_content).toContain("Fallback")
    expect(result.extraction_failed).toBe(true)
  })
})
