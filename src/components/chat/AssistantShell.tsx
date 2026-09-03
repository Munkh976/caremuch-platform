import type { ReactNode } from "react";

export interface AssistantShellProps {
  agencyName: string;
  showStartOver: boolean;
  onStartOver: () => void;
  children: ReactNode;
}

/**
 * Thin outer chrome shared by all four assistant states (router, caregiver
 * screening, family intake, knowledge Q&A). Deliberately minimal -- it only owns
 * the agency label and the persistent "Start over" escape hatch back to the
 * router. Each surface keeps its own internal header/back-navigation unchanged;
 * this sits above it, not instead of it, since "go back one question" and
 * "abandon this path entirely" are different actions.
 */
export function AssistantShell({ agencyName, showStartOver, onStartOver, children }: AssistantShellProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-xs">
        <span className="truncate font-medium text-muted-foreground">{agencyName}</span>
        {showStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="shrink-0 font-semibold text-primary underline-offset-2 hover:underline"
          >
            Start over
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
