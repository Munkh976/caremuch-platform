// Shared helper for calling the Lovable AI Gateway with forced tool-calling.
// Centralizes the model/endpoint/auth so Edge Functions don't hardcode them.

export class LLMGatewayError extends Error {
  constructor(public status: number, public body: string) {
    super(`AI Gateway error: ${status}`);
  }
}

export interface CallLLMOptions {
  systemPrompt: string;
  userPrompt: string;
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the tool's `parameters`. */
  schema: Record<string, unknown>;
  model?: string;
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";

export async function callLLM<T = unknown>(opts: CallLLMOptions): Promise<T> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: opts.toolName,
          description: opts.toolDescription,
          parameters: opts.schema,
        },
      }],
      tool_choice: { type: "function", function: { name: opts.toolName } },
    }),
  });

  if (!response.ok) {
    throw new LLMGatewayError(response.status, await response.text());
  }

  const result = await response.json();
  const toolCall = result.choices[0].message.tool_calls[0];
  return JSON.parse(toolCall.function.arguments) as T;
}
