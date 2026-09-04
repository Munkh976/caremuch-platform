import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface KnowledgeQaSurfaceProps {
  agencyName: string;
  /** Passed explicitly into search_agency_knowledge -- this surface is reached by
   * anonymous public visitors with no auth.uid(), so it can never rely on
   * my_agency_id() to resolve the right agency (see 20260903140000). */
  agencyId: string;
  embedded?: boolean;
}

type Language = "en" | "es";

type TurnResult =
  | { kind: "answer"; content: string; documentTitle: string }
  | { kind: "refuse" };

interface Turn {
  question: string;
  result: TurnResult;
}

const REFUSAL_TEXT = (agencyName: string) =>
  `I don't have information on that in ${agencyName}'s knowledge base — you can ask something else, or contact us.`;

export function KnowledgeQaSurface({ agencyName, agencyId, embedded = false }: KnowledgeQaSurfaceProps) {
  const shell = embedded ? "h-full min-h-[540px]" : "min-h-screen";
  const [language, setLanguage] = useState<Language | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);

  const ask = async () => {
    const question = draft.trim();
    if (!question || !language || asking) return;
    setAsking(true);
    setDraft("");

    const { data, error } = await supabase.functions.invoke("search-knowledge", {
      body: { query: question, language, agency_id: agencyId },
    });

    setAsking(false);

    if (error || !data || (data as { error?: string }).error) {
      console.error("Knowledge search failed", error || (data as { error?: string })?.error);
      setTurns((prev) => [...prev, { question, result: { kind: "refuse" } }]);
      return;
    }

    // Refusal is gated on grounded/content only -- document_title is a display label,
    // not a confidence signal, so a chunk with an empty-string title (schema allows
    // NOT NULL '' even though every seeded title is non-empty) must not cause a false
    // refusal. Falls back to a generic label at render time instead.
    const result = data as { grounded: boolean; content: string | null; document_title: string | null };
    if (!result.grounded || !result.content) {
      setTurns((prev) => [...prev, { question, result: { kind: "refuse" } }]);
      return;
    }

    setTurns((prev) => [
      ...prev,
      {
        question,
        result: {
          kind: "answer",
          content: result.content,
          documentTitle: result.document_title || "the knowledge base",
        },
      },
    ]);
  };

  if (!language) {
    return (
      <div className={`flex ${shell} flex-col items-center justify-center gap-4 bg-convo-surface px-6 py-10 text-center`}>
        <p className="text-sm text-convo-muted">Choose a language to continue.</p>
        <div className="grid w-full max-w-sm gap-3">
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3.5 text-sm font-bold text-convo-ink transition-colors hover:border-convo-accent"
          >
            Continue in English
          </button>
          <button
            type="button"
            onClick={() => setLanguage("es")}
            className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3.5 text-sm font-bold text-convo-ink transition-colors hover:border-convo-accent"
          >
            Continuar en Español
          </button>
        </div>
      </div>
    );
  }

  const introText =
    language === "es"
      ? `Pregúntame lo que quieras sobre ${agencyName} — escribe tu pregunta abajo.`
      : `Ask me anything about ${agencyName} — type your question below.`;
  const placeholder = language === "es" ? "Escribe tu pregunta..." : "Type your question...";

  return (
    <div className={`flex ${shell} flex-col bg-convo-surface`}>
      <main className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-6 pb-4 pt-6">
        {turns.length === 0 && <p className="text-sm text-convo-muted">{introText}</p>}

        <div className="space-y-5">
          {turns.map((turn, i) => (
            <div key={i} className="space-y-2">
              <p className="text-[15px] font-semibold text-convo-ink">{turn.question}</p>
              {turn.result.kind === "answer" ? (
                <div className="rounded-2xl border border-convo-line bg-convo-surface p-4">
                  <p className="text-sm text-convo-ink">{turn.result.content}</p>
                  <p className="mt-2 text-xs text-convo-muted">From: {turn.result.documentTitle}</p>
                </div>
              ) : (
                <p className="text-sm text-convo-muted">{REFUSAL_TEXT(agencyName)}</p>
              )}
            </div>
          ))}
        </div>
      </main>

      <form
        className="mx-auto flex w-full max-w-lg items-center gap-2 border-t border-convo-line px-6 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={asking}
          className="flex-1 rounded-2xl border border-convo-line bg-convo-surface px-4 py-3 text-sm text-convo-ink outline-none focus:border-convo-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={asking || !draft.trim()}
          aria-label={language === "es" ? "Enviar" : "Ask"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-convo-accent text-convo-accent-foreground disabled:opacity-50"
        >
          {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
