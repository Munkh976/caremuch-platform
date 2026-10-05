import * as React from "react";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

// Filter chip for the Ripple screens. The shared toggle shows its "on" state in the accent (teal);
// these chips use the app's primary navy like the rest of the UI. ui/toggle.tsx stays unchanged.
export const FilterChip = React.forwardRef<
  React.ElementRef<typeof ToggleGroupItem>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupItem>
>(({ className, ...props }, ref) => (
  <ToggleGroupItem
    ref={ref}
    className={cn("data-[state=on]:bg-primary data-[state=on]:text-primary-foreground", className)}
    {...props}
  />
));
FilterChip.displayName = "FilterChip";
