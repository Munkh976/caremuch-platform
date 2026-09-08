// OpenAI-direct implementation of LLMProvider. Model comes from env (LLM_MODEL), never
// hardcoded in this file -- same "config tells us, we don't assert it" discipline as
// openaiEmbeddingProvider.ts, though unlike embeddings the model string for chat isn't
// echoed back by the API in a way that could differ, so this reports the requested
// model (OpenAI's chat completions response does include the actual served model in
// `result.model`, which we use -- same provenance-from-reality rule).
import { LLMProvider, LlmCompleteInput, LlmCompleteResult, LlmProviderError } from "./llmProvider.ts";

export class OpenAILlmProvider implements LLMProvider {
  readonly name = "openai";
  readonly phiAllowed: boolean;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("LLM_MODEL");
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    if (!model) throw new Error("LLM_MODEL not set");
    this.apiKey = apiKey;
    this.model = model;
    // Defaults to false unless the env var is the literal string "true" -- same
    // discipline as EMBEDDING_PHI_ALLOWED.
    this.phiAllowed = Deno.env.get("LLM_PHI_ALLOWED") === "true";
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: input.system }, ...input.messages],
        temperature: 0,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      throw new LlmProviderError(response.status, await response.text());
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenAI chat completion response contained no message content");
    }

    return { content, model: result.model ?? this.model };
  }
}
