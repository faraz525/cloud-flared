export interface ExtractionResult {
  title: string
  main_content: string
  relevance: "high" | "medium" | "low"
  extraction_failed: boolean
}

interface AiExtraction {
  title: string
  main_content: string
  relevance: "high" | "medium" | "low"
}

function truncateMarkdown(markdown: string, maxChars: number): string {
  return markdown.length > maxChars
    ? markdown.slice(0, maxChars) + "\n\n[truncated]"
    : markdown
}

function fallbackExtraction(markdown: string): ExtractionResult {
  return {
    title: "",
    main_content: truncateMarkdown(markdown, 2000),
    relevance: "medium",
    extraction_failed: true,
  }
}

export async function extractContent(
  ai: Ai,
  markdown: string,
  url: string,
  query: string
): Promise<ExtractionResult> {
  try {
    const prompt = `You are a content extraction assistant. Given a webpage's markdown content, extract structured information.

The user's search query was: "${query}"
The page URL is: ${url}

Extract the following as JSON (no markdown, no code fences):
{
  "title": "the page title",
  "main_content": "the relevant content from the page, focused on what relates to the user's query. Max 1500 characters.",
  "relevance": "high" if directly answers the query, "medium" if somewhat related, "low" if barely related
}

Page content:
${truncateMarkdown(markdown, 4000)}`

    const response = (await ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as BaseAiTextGenerationModels,
      { prompt }
    )) as { response?: string }

    const text = response.response ?? ""
    const parsed = JSON.parse(text) as AiExtraction

    return {
      title: parsed.title ?? "",
      main_content: parsed.main_content ?? "",
      relevance: parsed.relevance ?? "medium",
      extraction_failed: false,
    }
  } catch {
    return fallbackExtraction(markdown)
  }
}
