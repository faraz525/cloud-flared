import { describe, it, expect, vi } from "vitest"

describe("Worker handler", () => {
  it("returns 405 for non-POST requests", async () => {
    const { default: worker } = await import("../src/index")
    const request = new Request("https://worker.dev/search", { method: "GET" })
    const response = await worker.fetch(request, mockEnv())
    expect(response.status).toBe(405)
  })

  it("returns 404 for unknown routes", async () => {
    const { default: worker } = await import("../src/index")
    const request = new Request("https://worker.dev/unknown", { method: "POST" })
    const response = await worker.fetch(request, mockEnv())
    expect(response.status).toBe(404)
  })

  it("returns 400 for invalid request body", async () => {
    const { default: worker } = await import("../src/index")
    const request = new Request("https://worker.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bad: "data" }),
    })
    const response = await worker.fetch(request, mockEnv())
    expect(response.status).toBe(400)
  })
})

function mockEnv() {
  return {
    AI: { run: vi.fn().mockResolvedValue({ response: "{}" }) },
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
    },
    CF_ACCOUNT_ID: "test-account",
    CF_API_TOKEN: "test-token",
  }
}
