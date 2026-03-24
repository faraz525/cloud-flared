// mcp-server/tests/worker-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callWorker } from "../src/worker-client"

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch)
  mockFetch.mockReset()
})

describe("callWorker", () => {
  const config = {
    workerUrl: "https://cloud-flared.example.workers.dev",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  }

  it("sends correct headers and body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        query: "test",
        summary: "result",
        sources: [],
        meta: {},
      }))
    )

    await callWorker(config, ["https://a.com"], "test query", 5)

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe("https://cloud-flared.example.workers.dev/search")
    expect(options.headers["CF-Access-Client-Id"]).toBe("test-client-id")
    expect(options.headers["CF-Access-Client-Secret"]).toBe("test-client-secret")

    const body = JSON.parse(options.body)
    expect(body.urls).toEqual(["https://a.com"])
    expect(body.query).toBe("test query")
  })

  it("throws on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 })
    )

    await expect(
      callWorker(config, ["https://a.com"], "test", 5)
    ).rejects.toThrow()
  })

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))

    await expect(
      callWorker(config, ["https://a.com"], "test", 5)
    ).rejects.toThrow("ECONNREFUSED")
  })
})
