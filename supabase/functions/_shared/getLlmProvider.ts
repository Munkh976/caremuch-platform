// Provider selection by config (LLM_PROVIDER), mirroring getEmbeddingProvider.ts
// exactly. Adding a second provider later is "new class + a case here."
import { LLMProvider } from "./llmProvider.ts";
import { OpenAILlmProvider } from "./openaiLlmProvider.ts";

export function getLlmProvider(): LLMProvider {
  const providerName = Deno.env.get("LLM_PROVIDER");
  switch (providerName) {
    case "openai":
      return new OpenAILlmProvider();
    default:
      throw new Error(
        `Unknown or unset LLM_PROVIDER: "${providerName}". Supported: "openai".`
      );
  }
}
