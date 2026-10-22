import { MapPin } from "lucide-react";
import { useOfficePlaces } from "@/hooks/useOfficePlaces";
import { cn } from "@/lib/utils";
import { placeShort, visitPlace, type PlaceClient } from "@/lib/visitPlace";

/**
 * Where a visit takes place (owner, Oct 22, A): the client's address, or the office when the office's visits take place
 * there (virtual_office.visit_location = 'office'). `full` shows the street address, `short` "City, ST". Renders nothing
 * when there is nothing to show (as the rows did before).
 */
export function VisitPlaceLine({ officeId, client, variant = "short", className, iconClassName = "h-3 w-3" }: {
  officeId: string | null | undefined; client: PlaceClient | null | undefined; variant?: "short" | "full"; className?: string; iconClassName?: string;
}) {
  const offices = useOfficePlaces();
  const p = visitPlace(client, officeId ? offices.get(officeId) : null);
  const text = variant === "full" ? (p.atOffice ? [p.label, p.full].filter(Boolean).join(", ") : p.full) : placeShort(p);
  if (!text) return null;
  return (
    <span className={cn("flex items-center gap-1", className)} data-testid="visit-place" data-at-office={p.atOffice}>
      <MapPin className={iconClassName} />{text}
    </span>
  );
}
