import { describe, it, expect } from "vitest"
import { validateSearchRequest } from "../src/validate"

describe("validateSearchRequest", () => {
  it("accepts a valid request", () => {
    const result = validateSearchRequest({
      urls: ["https://example.com"],
      query: "test query",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_urls).toBe(5) // default
    }
  })

  it("rejects missing urls", () => {
    const result = validateSearchRequest({ query: "test" })
    expect(result.success).toBe(false)
  })

  it("rejects empty urls array", () => {
    const result = validateSearchRequest({ urls: [], query: "test" })
    expect(result.success).toBe(false)
  })

  it("rejects missing query", () => {
    const result = validateSearchRequest({ urls: ["https://example.com"] })
    expect(result.success).toBe(false)
  })

  it("rejects non-HTTP URLs", () => {
    const result = validateSearchRequest({
      urls: ["file:///etc/passwd"],
      query: "test",
    })
    expect(result.success).toBe(false)
  })

  it("rejects javascript: URLs", () => {
    const result = validateSearchRequest({
      urls: ["javascript:alert(1)"],
      query: "test",
    })
    expect(result.success).toBe(false)
  })

  it("rejects URLs longer than 2048 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(2040)
    const result = validateSearchRequest({
      urls: [longUrl],
      query: "test",
    })
    expect(result.success).toBe(false)
  })

  it("caps max_urls at 10", () => {
    const result = validateSearchRequest({
      urls: ["https://example.com"],
      query: "test",
      max_urls: 50,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.max_urls).toBe(10)
    }
  })

  it("filters out invalid URLs and keeps valid ones", () => {
    const result = validateSearchRequest({
      urls: ["https://good.com", "ftp://bad.com", "https://also-good.com"],
      query: "test",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.urls).toEqual(["https://good.com", "https://also-good.com"])
    }
  })
})
