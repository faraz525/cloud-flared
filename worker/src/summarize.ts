interface SourceInput {
  url: string
  title: string
  content: string
}

export interface SummarizeResult {
  summary: string | null
  ai_skipped: boolean
}

export async function summarizeSources(
  ai: Ai,
  query: string,
  sources: SourceInput[]
): Promise<SummarizeResult> {
  if (sources.length === 0) {
    return { summary: null, ai_skipped: false }
  }

  try {
    const sourceText = sources
      .map(
        (s, i) =>
          `[Source ${i + 1}: ${s.title}](${s.url})\n${s.content}`
      )
      .join("\n\n---\n\n")

    const prompt = `You are a research assistant. The user searched for: "${query}"

Below are excerpts from ${sources.length} web sources. Synthesize a clear, concise answer to the user's query. Cite sources using [Source N] notation. Focus on directly answering the query. If sources disagree, note the disagreement.

${sourceText}

Provide your synthesis (2-4 paragraphs max):`

    const response = (await ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as BaseAiTextGenerationModels,
      { prompt }
    )) as { response?: string }

    const summary = response.response?.trim() ?? null

    return { summary, ai_skipped: false }
  } catch {
    return { summary: null, ai_skipped: true }
  }
}
