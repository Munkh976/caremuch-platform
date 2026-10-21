import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/** The "Open ›" button at the end of a clickable list row (the row opens the same page); other labels reuse its style. */
export function OpenButton({ to, label = "Open", testId = "row-open" }: { to: string; label?: string; testId?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="min-h-9 hover:bg-muted hover:text-foreground">
      <Link to={to} data-testid={testId}>{label} ›</Link>
    </Button>
  );
}
