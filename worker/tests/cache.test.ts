import { describe, it, expect, vi } from "vitest"
import { lookupCachedPages, storeCachedPage, logSearch } from "../src/cache"

function mockD1() {
  const rows: Record<string, unknown>[] = []
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({ success: true }),
  }
  const db = {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn().mockResolvedValue([]),
  }
  return { db: db as unknown as D1Database, stmt, rows }
}

describe("lookupCachedPages", () => {
  it("returns empty map when no pages are cached", async () => {
    const { db } = mockD1()
    const result = await lookupCachedPages(db, ["hash1", "hash2"])
    expect(result.size).toBe(0)
  })

  it("calls prepare with correct SQL for batch lookup", async () => {
    const { db } = mockD1()
    await lookupCachedPages(db, ["hash1"])
    expect(db.prepare).toHaveBeenCalled()
  })
})

describe("storeCachedPage", () => {
  it("calls prepare with INSERT OR REPLACE", async () => {
    const { db } = mockD1()
    await storeCachedPage(db, {
      url_hash: "abc123",
      url: "https://example.com",
      title: "Test",
      content: "extracted content",
      raw_markdown: "# Test",
      crawled_at: Date.now(),
      ttl_hours: 24,
    })
    const sql = db.prepare.mock.calls[0][0] as string
    expect(sql).toContain("INSERT OR REPLACE")
  })
})

describe("logSearch", () => {
  it("inserts a search log entry", async () => {
    const { db } = mockD1()
    await logSearch(db, {
      query: "test query",
      urls: ["https://example.com"],
      summary: "test summary",
      neurons_used: 100,
      latency_ms: 500,
    })
    const sql = db.prepare.mock.calls[0][0] as string
    expect(sql).toContain("INSERT INTO search_log")
  })
})
