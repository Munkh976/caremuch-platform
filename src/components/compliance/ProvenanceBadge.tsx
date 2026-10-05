import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Read-only "built from <shell> v<n>": which form-template version an instance was filled from
 * (arch §9.2.1). Deliberately not a link: the instance renders from its own snapshot, never from
 * the live shell.
 */
export function ProvenanceBadge({ shellName, version, className }: { shellName: string; version: number; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal text-muted-foreground", className)}>
      <FileText className="h-3 w-3" aria-hidden="true" />
      Built from {shellName} v{version}
    </Badge>
  );
}
