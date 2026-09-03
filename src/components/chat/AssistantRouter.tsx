import { HeartHandshake, UserRoundPlus, MessageCircleQuestion } from "lucide-react";

export type AssistantTarget = "care" | "apply" | "knowledge";

export interface AssistantRouterProps {
  onSelect: (target: AssistantTarget) => void;
}

/**
 * The assistant's front door: "How can I help you today?" plus three routing
 * buttons. A plain component, no database backing -- a future orchestrator would
 * replace this component's decision logic (or call it as one of its own tools),
 * not touch conversation_flows rows to do the same job.
 */
export function AssistantRouter({ onSelect }: AssistantRouterProps) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-6 py-10 text-center">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold text-foreground">How can I help you today?</h1>
        <p className="text-sm text-muted-foreground">Just tap the option that fits best.</p>
      </div>

      <div className="grid gap-3 text-left">
        <button
          type="button"
          onClick={() => onSelect("care")}
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary hover:bg-accent"
        >
          <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-semibold text-foreground">
              I need care for a loved one
            </span>
            <span className="block text-sm text-muted-foreground">
              Tell us about your needs and we'll match the right caregiver.
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelect("apply")}
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary hover:bg-accent"
        >
          <UserRoundPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-semibold text-foreground">
              I want to work as a caregiver
            </span>
            <span className="block text-sm text-muted-foreground">
              Answer a short screening, then finish your application.
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelect("knowledge")}
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary hover:bg-accent"
        >
          <MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-semibold text-foreground">I have a question</span>
            <span className="block text-sm text-muted-foreground">
              Type your own question, get an instant answer.
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
