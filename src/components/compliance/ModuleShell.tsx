import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";

/**
 * Page frame for the Ripple care-plan module screens: AppLayout, title, description, and (until the
 * slice that builds the screen lands) an empty state. Lists the offices with the module on that the
 * user can see; office names only.
 */
export function ModuleShell({ title, description, icon: Icon, slice, children }: {
  title: string;
  description: string;
  icon: LucideIcon;
  /** The build slice that fills this screen (shown in the empty state). */
  slice: string;
  children?: ReactNode;
}) {
  const { moduleOffices } = useComplianceOffices();
  return (
    <AppLayout>
      {/* minmax(0,1fr) keeps wide tables inside their own scroll areas: without it their min-content
          width would widen the layout's flex <main> and scroll the whole page sideways on phones */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {children ?? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">This screen is being built.</p>
              <p className="max-w-md text-sm text-muted-foreground">It arrives with slice {slice} of the care-plan module.</p>
              {moduleOffices.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  {moduleOffices.map((o) => (
                    <Badge key={o.id} variant="secondary">{o.name}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
