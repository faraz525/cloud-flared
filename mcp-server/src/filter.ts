import type { SearxngResult } from "./searxng.js"

const BLOCKED_DOMAINS = new Set([
  "pinterest.com",
  "quora.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linkedin.com",
  "youtube.com",
])

const MAX_PER_DOMAIN = 2

function getDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function getPathKey(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname + parsed.pathname.replace(/\/$/, "")
  } catch {
    return url
  }
}

function isBlocklisted(domain: string): boolean {
  return (
    BLOCKED_DOMAINS.has(domain) ||
    [...BLOCKED_DOMAINS].some((blocked) => domain.endsWith(`.${blocked}`))
  )
}

export function filterUrls(
  results: SearxngResult[],
  maxUrls: number
): SearxngResult[] {
  const seen = new Set<string>()
  const domainCount = new Map<string, number>()
  const filtered: SearxngResult[] = []

  for (const result of results) {
    if (filtered.length >= maxUrls) break

    const domain = getDomain(result.url)
    if (!domain || isBlocklisted(domain)) continue

    const pathKey = getPathKey(result.url)
    if (seen.has(pathKey)) continue
    seen.add(pathKey)

    const count = domainCount.get(domain) ?? 0
    if (count >= MAX_PER_DOMAIN) continue
    domainCount.set(domain, count + 1)

    filtered.push(result)
  }

  return filtered
}
