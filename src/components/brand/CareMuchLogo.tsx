import { cn } from "@/lib/utils";
import { CareMuchMark } from "./CareMuchMark";

/**
 * The CareMuch logo: the mark + the wordmark "CareMuch" (Schibsted Grotesk 800, gradient #0A7889 → #1D6FB8 75% → #3A9FE6).
 * `onDark` draws the wordmark in white (the gradient doesn't read on navy). The wordmark text is the accessible name, so
 * the mark is decorative here.
 */
export function CareMuchLogo({ size = 36, textClassName, className, onDark = false }: {
  size?: number; textClassName?: string; className?: string; onDark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CareMuchMark size={size} />
      <span
        className={cn("font-display font-extrabold leading-none tracking-[-0.03em]", onDark ? "text-white" : "bg-clip-text text-transparent", textClassName)}
        style={onDark ? undefined : { backgroundImage: "linear-gradient(90deg, #0A7889, #1D6FB8 75%, #3A9FE6)" }}
      >
        CareMuch
      </span>
    </span>
  );
}
