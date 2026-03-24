import type { SearchRequest } from "./types"

const MAX_URL_LENGTH = 2048
const MAX_URLS_CEILING = 10
const DEFAULT_MAX_URLS = 5

interface ValidationSuccess {
  success: true
  data: Required<SearchRequest>
}

interface ValidationFailure {
  success: false
  error: string
}

type ValidationResult = ValidationSuccess | ValidationFailure

function isValidUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

export function validateSearchRequest(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { success: false, error: "Request body must be a JSON object" }
  }

  const { urls, query, max_urls } = body as Record<string, unknown>

  if (!Array.isArray(urls) || urls.length === 0) {
    return { success: false, error: "urls must be a non-empty array" }
  }

  if (typeof query !== "string" || query.trim().length === 0) {
    return { success: false, error: "query must be a non-empty string" }
  }

  const validUrls = urls.filter(
    (u): u is string => typeof u === "string" && isValidUrl(u)
  )

  if (validUrls.length === 0) {
    return { success: false, error: "No valid HTTP/HTTPS URLs provided" }
  }

  const cappedMaxUrls = Math.min(
    typeof max_urls === "number" && max_urls > 0 ? max_urls : DEFAULT_MAX_URLS,
    MAX_URLS_CEILING
  )

  return {
    success: true,
    data: {
      urls: validUrls,
      query: query.trim(),
      max_urls: cappedMaxUrls,
    },
  }
}
