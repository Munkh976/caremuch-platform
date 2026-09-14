import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchCareServiceCodes } from "@/lib/dynamicCatalog";
import { ScoreResult } from "@/lib/flowEngine";

interface ResultRegistrationProps {
  firstName: string;
  agencyName: string;
  score: ScoreResult | null;
  /** Catalog ids the visitor picked during the conversation. */
  careServiceItemIds?: string[];
  /** Scopes the application to a specific agency (public office pages). */
  agencyId?: string | null;
  /** Scopes the application to a specific virtual office (public office pages). */
  virtualOfficeId?: string | null;
  onExit?: () => void;
  onRegistered: (registrationId: string) => Promise<void> | void;
}

/** Result card plus a low-friction, skippable application form. */
export function ResultRegistration({
  firstName,
  agencyName,
  score,
  careServiceItemIds = [],
  agencyId = null,
  virtualOfficeId = null,
  onExit,
  onRegistered,
}: ResultRegistrationProps) {
  const strong = score ? score.band === "strong_fit" : true;
  const name = firstName || "there";

  const [stage, setStage] = useState<"form" | "done" | "skipped">("form");
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({ firstName, phone: "", email: "", hourlyRate: "" });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.firstName.trim()) return toast.error("Please add your first name.");
    if (!values.phone.trim()) return toast.error("Please add a phone number.");
    if (!values.email.trim()) return toast.error("Please add an email address.");
    const rate = Number(values.hourlyRate);
    if (!values.hourlyRate.trim() || Number.isNaN(rate) || rate <= 0)
      return toast.error("Please add your expected hourly rate.");
    if (rate > 500) return toast.error("Please enter a realistic hourly rate.");

    setSaving(true);
    try {
      const careTypeCodes = await fetchCareServiceCodes(careServiceItemIds);
      // Goes through submit_caregiver_registration (not a direct insert) so the
      // agency/office fallback chain (M-Office plan §3d/§5) applies uniformly --
      // this surface already passes agencyId/virtualOfficeId correctly when reached
      // via /a/:slug, so the fallback is a no-op here; it only matters for the
      // legacy /assistant path, which renders this same component with both null.
      const { data: registrationId, error } = await supabase.rpc("submit_caregiver_registration", {
        p_first_name: values.firstName.trim(),
        p_last_name: "",
        p_phone: values.phone.trim(),
        p_email: values.email.trim().toLowerCase(),
        p_care_type_codes: careTypeCodes,
        p_hourly_rate: rate,
        p_agency_id: agencyId,
        p_virtual_office_id: virtualOfficeId,
      });
      if (error) throw error;
      await onRegistered(registrationId as string);
      setStage("done");
    } catch (error: any) {
      toast.error(error.message ?? "Could not submit your application.");
    } finally {
      setSaving(false);
    }
  };

  if (stage !== "form") {
    return (
      <div className="space-y-4 pb-12 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-convo-accent" />
        <h2 className="text-xl font-bold text-convo-ink">
          {stage === "done" ? `You're all set, ${name}!` : "No problem."}
        </h2>
        <p className="text-sm text-convo-muted">
          {stage === "done"
            ? `${agencyName} has your application and will let you know as soon as a manager reviews it.`
            : `${agencyName} has your answers and will reach out directly.`}
        </p>
        <div className="space-y-2 pt-2">
          <Link
            to="/"
            className="block w-full rounded-2xl bg-convo-accent px-4 py-3.5 text-sm font-bold text-convo-accent-foreground"
          >
            Back to home
          </Link>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="block w-full text-center text-sm text-convo-muted underline-offset-4 hover:underline"
            >
              Start over
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-3 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-convo-accent" />
        <h2 className="text-xl font-bold leading-snug text-convo-ink">
          {strong
            ? `Great news ${name}! You look like a strong fit for a caregiver role at ${agencyName}.`
            : `Thank you ${name}. ${agencyName} will review your profile and be in touch.`}
        </h2>
        <p className="text-sm text-convo-muted">
          Complete your application in one step — a manager creates your login once you're approved.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          value={values.firstName}
          onChange={(e) => setValues({ ...values, firstName: e.target.value })}
          placeholder="First name"
          aria-label="First name"
          className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3.5 text-sm text-convo-ink outline-none focus:border-convo-accent"
        />
        <input
          value={values.phone}
          onChange={(e) => setValues({ ...values, phone: e.target.value })}
          type="tel"
          placeholder="Phone number"
          aria-label="Phone number"
          className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3.5 text-sm text-convo-ink outline-none focus:border-convo-accent"
        />
        <input
          value={values.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
          type="email"
          placeholder="Email address"
          aria-label="Email address"
          className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3.5 text-sm text-convo-ink outline-none focus:border-convo-accent"
        />
        <input
          value={values.hourlyRate}
          onChange={(e) =>
            setValues({ ...values, hourlyRate: e.target.value.replace(/[^0-9.]/g, "") })
          }
          type="text"
          inputMode="decimal"
          placeholder="Expected hourly rate (USD)"
          aria-label="Expected hourly rate in US dollars"
          className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3.5 text-sm text-convo-ink outline-none focus:border-convo-accent"
        />
        <button
          type="submit"
          disabled={saving}
          className="flex w-full items-center justify-center rounded-2xl bg-convo-accent px-4 py-3.5 text-sm font-bold text-convo-accent-foreground disabled:opacity-50"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Complete my application
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-convo-muted">
        <span className="h-px flex-1 bg-convo-line" />
        or
        <span className="h-px flex-1 bg-convo-line" />
      </div>

      <button
        type="button"
        onClick={() => setStage("skipped")}
        className="block w-full text-center text-sm text-convo-muted underline-offset-4 hover:underline"
      >
        Skip for now →
      </button>
    </div>
  );
}
