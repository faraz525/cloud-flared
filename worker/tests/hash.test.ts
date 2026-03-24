import { describe, it, expect } from "vitest"
import { hashUrl } from "../src/hash"

describe("hashUrl", () => {
  it("returns a 64-char hex string for a URL", async () => {
    const result = await hashUrl("https://example.com")
    expect(result).toMatch(/^[a-f0-9]{64}$/)
  })

  it("returns the same hash for the same URL", async () => {
    const a = await hashUrl("https://example.com/page")
    const b = await hashUrl("https://example.com/page")
    expect(a).toBe(b)
  })

  it("returns different hashes for different URLs", async () => {
    const a = await hashUrl("https://example.com/a")
    const b = await hashUrl("https://example.com/b")
    expect(a).not.toBe(b)
  })
})
