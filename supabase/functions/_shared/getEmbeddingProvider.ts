// Provider selection by config (EMBEDDING_PROVIDER). Adding Azure later is "new class +
// a case here" -- nothing else in this file or its callers changes.
import { EmbeddingProvider } from "./embeddingProvider.ts";
import { OpenAIEmbeddingProvider } from "./openaiEmbeddingProvider.ts";

export function getEmbeddingProvider(): EmbeddingProvider {
  const providerName = Deno.env.get("EMBEDDING_PROVIDER");
  switch (providerName) {
    case "openai":
      return new OpenAIEmbeddingProvider();
    default:
      throw new Error(
        `Unknown or unset EMBEDDING_PROVIDER: "${providerName}". Supported: "openai".`
      );
  }
}
