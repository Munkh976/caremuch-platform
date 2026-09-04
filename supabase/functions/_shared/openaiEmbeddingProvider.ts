// OpenAI-direct implementation of EmbeddingProvider. Reads OPENAI_API_KEY and
// EMBEDDING_MODEL from env -- neither the model string nor the dimension is hardcoded
// anywhere in this file; both come from config/response, matching the smoke test's
// "the endpoint tells us the number, we don't assert it" rule.
import { EmbeddingProvider, EmbedResult, EmbeddingProviderError } from "./embeddingProvider.ts";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly phiAllowed: boolean;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("EMBEDDING_MODEL");
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    if (!model) throw new Error("EMBEDDING_MODEL not set");
    this.apiKey = apiKey;
    this.model = model;
    // Defaults to false unless the env var is the literal string "true" -- absent,
    // empty, "false", or a typo all resolve to false, never true-by-omission.
    this.phiAllowed = Deno.env.get("EMBEDDING_PHI_ALLOWED") === "true";
  }

  async embed(input: string | string[]): Promise<EmbedResult> {
    const texts = Array.isArray(input) ? input : [input];

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      throw new EmbeddingProviderError(response.status, await response.text());
    }

    const result = await response.json();
    const embeddings: number[][] = (result.data ?? []).map((d: { embedding: number[] }) => d.embedding);

    // Sanity only -- dimension > 0, never a hardcoded expected value.
    if (embeddings.length === 0 || embeddings.some((e) => e.length === 0)) {
      throw new Error("OpenAI embeddings response contained no vectors or a zero-length embedding");
    }

    return {
      embeddings,
      model: result.model,
      dimension: embeddings[0].length,
    };
  }
}
