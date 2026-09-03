import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { useConversationFlow } from "@/hooks/useConversationFlow";
import { FlowNode } from "@/lib/flowEngine";

export interface FamilyIntakeSurfaceProps {
  /** Returns the visitor to the welcome screen (used by Back on step 1). */
  onExit?: () => void;
  /** Render inside a page section (card) instead of taking the full viewport. */
  embedded?: boolean;
  /** Scopes the resulting care request to an agency office. */
  agencyId?: string | null;
  virtualOfficeId?: string | null;
}

const CONTACT_PREFERENCES = [
  { value: "phone", label: "Phone call", verb: "call" },
  { value: "text", label: "Text message", verb: "text" },
  { value: "email", label: "Email", verb: "email" },
];

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Please enter your full name" })
    .max(100, { message: "Name must be less than 100 characters" }),
  phone: z
    .string()
    .trim()
    .min(10, { message: "Please enter a valid phone number" })
    .max(30, { message: "Phone must be less than 30 characters" })
    .regex(/^[0-9+()\-.\s]*$/, { message: "Phone contains invalid characters" }),
  email: z
    .string()
    .trim()
    .max(255, { message: "Email must be less than 255 characters" })
    .email({ message: "Enter a valid email address" })
    .optional()
    .or(z.literal("")),
  preference: z.string().min(1, { message: "Choose how we should reach you" }),
});

export function FamilyIntakeSurface({
  onExit,
  embedded = false,
  agencyId = null,
  virtualOfficeId = null,
}: FamilyIntakeSurfaceProps) {
  const shell = embedded ? "h-full min-h-[540px]" : "min-h-screen";
  const flowState = useConversationFlow("family_intake", {
    deferSession: true,
    scope: { agencyId, virtualOfficeId },
  });
  const { flow, state, currentNode, loading, error, saving } = flowState;

  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [submitted, setSubmitted] = useState<{ name: string; preference: string } | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [preference, setPreference] = useState("phone");
  const [submitting, setSubmitting] = useState(false);

  const total = Math.max(flow?.nodes.length ?? 8, 1);
  const step = Math.min((state?.answers.length ?? 0) + 1, total);
  const percent = Math.round((step / total) * 100);

  // Restore the previous answer when the visitor steps back.
  const answered = state?.answers.find((a) => a.nodeId === currentNode?.id);
  useEffect(() => {
    setSelected(answered?.optionIds ?? []);
    setFreeText(answered?.freeText ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode?.id]);

  const isContactStep = currentNode?.node_type === "contact_capture";
  const multi = currentNode?.node_type === "multi_select";
  const needsText = Boolean(currentNode?.allow_free_text && currentNode.options.length === 0);
  const canContinue = needsText ? freeText.trim().length > 0 : selected.length > 0;
  const helperRepeatsMultiHint =
    multi && /select all that apply/i.test(currentNode?.helper_text ?? "");

  const goBack = () => {
    if ((state?.answers.length ?? 0) > 0) {
      void flowState.back();
      return;
    }
    onExit?.();
  };

  const handleSubmitContact = async () => {
    const parsed = contactSchema.safeParse({ name, phone, email, preference });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Please check your details");
      return;
    }
    setSubmitting(true);
    const result = await flowState.submitIntake({
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      preference: parsed.data.preference,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error || "We could not send your request. Please try again.");
      return;
    }
    setSubmitted({ name: parsed.data.name, preference: parsed.data.preference });
  };

  if (submitted) {
    return <IntakeComplete name={submitted.name} preference={submitted.preference} onExit={onExit} shell={shell} />;
  }

  return (
    <div className={`flex ${shell} flex-col bg-convo-surface`}>
      <header className="border-b border-convo-line px-4 pb-3 pt-4">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-convo-muted transition-colors hover:text-convo-ink"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-convo-ink">About 8 quick questions</p>
            <p className="text-xs text-convo-muted">
              Step {step} of {total}
            </p>
          </div>
        </div>
        <div className="mx-auto mt-3 h-1 w-full max-w-lg overflow-hidden rounded-full bg-convo-line">
          <div
            className="h-full rounded-full bg-convo-accent transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-6 pb-16">
        {loading && (
          <div className="flex items-center justify-center py-16 text-convo-muted">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading...
          </div>
        )}

        {!loading && error && (
          <p className="py-12 text-center text-sm text-convo-muted">{error}</p>
        )}

        {!loading && !error && currentNode && (
          <div className="animate-fade-in">
            <p className="pt-8 text-[19px] font-bold leading-snug text-convo-ink">
              {currentNode.prompt}
            </p>
            {currentNode.helper_text && !helperRepeatsMultiHint && (
              <p className="pt-2 text-sm text-convo-muted">{currentNode.helper_text}</p>
            )}
            {multi && <p className="pt-2 text-sm text-convo-muted">Select all that apply.</p>}

            {isContactStep ? (
              <ContactForm
                name={name}
                phone={phone}
                email={email}
                preference={preference}
                busy={submitting}
                onName={setName}
                onPhone={setPhone}
                onEmail={setEmail}
                onPreference={setPreference}
                onSubmit={handleSubmitContact}
              />
            ) : (
              <QuestionStep
                node={currentNode}
                selected={selected}
                freeText={freeText}
                multi={multi}
                needsText={needsText}
                saving={saving}
                canContinue={canContinue}
                onFreeText={setFreeText}
                onToggle={(id) =>
                  setSelected((current) =>
                    current.includes(id) ? current.filter((v) => v !== id) : [...current, id]
                  )
                }
                onPick={(id) => flowState.answer({ optionIds: [id] })}
                onContinue={() =>
                  flowState.answer({
                    optionIds: selected,
                    freeText: freeText.trim() ? freeText.trim() : null,
                  })
                }
                onSkip={() => flowState.answer({ skipped: true })}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

interface QuestionStepProps {
  node: FlowNode;
  selected: string[];
  freeText: string;
  multi: boolean;
  needsText: boolean;
  saving: boolean;
  canContinue: boolean;
  onFreeText: (value: string) => void;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}

function QuestionStep({
  node,
  selected,
  freeText,
  multi,
  needsText,
  saving,
  canContinue,
  onFreeText,
  onToggle,
  onPick,
  onContinue,
  onSkip,
}: QuestionStepProps) {
  return (
    <div className="space-y-2.5 pt-5">
      {needsText ? (
        <textarea
          value={freeText}
          onChange={(e) => onFreeText(e.target.value)}
          rows={4}
          placeholder={node.free_text_label || "Type your answer"}
          aria-label="Your answer"
          className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3 text-sm text-convo-ink outline-none focus:border-convo-accent"
        />
      ) : (
        node.options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={saving}
              onClick={() => (multi ? onToggle(option.id) : onPick(option.id))}
              className={`w-full rounded-2xl border px-4 py-3.5 text-center text-sm font-bold transition-colors disabled:opacity-50 ${
                active
                  ? "border-convo-accent bg-convo-accent/10 text-convo-ink"
                  : "border-convo-line bg-convo-surface text-convo-ink hover:border-convo-accent"
              }`}
            >
              {option.label}
            </button>
          );
        })
      )}

      {node.allow_free_text && node.options.length > 0 && (
        <textarea
          value={freeText}
          onChange={(e) => onFreeText(e.target.value)}
          rows={3}
          placeholder={node.free_text_label || "Anything else to add? (optional)"}
          aria-label="Additional details"
          className="w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3 text-sm text-convo-ink outline-none focus:border-convo-accent"
        />
      )}

      {(multi || needsText) && (
        <button
          type="button"
          disabled={saving || !canContinue}
          onClick={onContinue}
          className="w-full rounded-2xl bg-convo-accent px-4 py-3.5 text-sm font-bold text-convo-accent-foreground disabled:opacity-50"
        >
          Continue
        </button>
      )}

      {node.allow_skip && (
        <button
          type="button"
          disabled={saving}
          onClick={onSkip}
          className="block w-full pt-2 text-center text-sm text-convo-muted underline-offset-4 hover:underline"
        >
          Skip this question →
        </button>
      )}
    </div>
  );
}

interface ContactFormProps {
  name: string;
  phone: string;
  email: string;
  preference: string;
  busy: boolean;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onEmail: (v: string) => void;
  onPreference: (v: string) => void;
  onSubmit: () => void;
}

function ContactForm({
  name,
  phone,
  email,
  preference,
  busy,
  onName,
  onPhone,
  onEmail,
  onPreference,
  onSubmit,
}: ContactFormProps) {
  const field =
    "w-full rounded-2xl border border-convo-line bg-convo-surface px-4 py-3.5 text-sm text-convo-ink outline-none focus:border-convo-accent";
  return (
    <form
      className="space-y-3 pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        value={name}
        onChange={(e) => onName(e.target.value)}
        placeholder="Full name"
        aria-label="Full name"
        maxLength={100}
        className={field}
      />
      <input
        value={phone}
        onChange={(e) => onPhone(e.target.value)}
        placeholder="(555) 000-0000"
        aria-label="Phone number"
        inputMode="tel"
        maxLength={30}
        className={field}
      />
      <input
        value={email}
        onChange={(e) => onEmail(e.target.value)}
        placeholder="Email address (optional)"
        aria-label="Email address"
        inputMode="email"
        maxLength={255}
        className={field}
      />

      <p className="pt-2 text-sm text-convo-muted">How would you prefer to be contacted?</p>
      <div className="grid grid-cols-3 gap-2">
        {CONTACT_PREFERENCES.map((option) => {
          const active = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onPreference(option.value)}
              aria-pressed={active}
              className={`rounded-2xl border px-2 py-3 text-xs font-bold transition-colors ${
                active
                  ? "border-convo-accent bg-convo-accent/10 text-convo-ink"
                  : "border-convo-line bg-convo-surface text-convo-ink hover:border-convo-accent"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-2 w-full rounded-2xl bg-convo-accent px-4 py-3.5 text-sm font-bold text-convo-accent-foreground disabled:opacity-50"
      >
        {busy ? "Sending..." : "Get my free consultation →"}
      </button>
      <Link
        to="/auth"
        className="block pt-1 text-center text-xs text-convo-muted underline-offset-4 hover:underline"
      >
        Already have an account? Sign in →
      </Link>
    </form>
  );
}

function IntakeComplete({
  name,
  preference,
  onExit,
  shell = "min-h-screen",
}: {
  name: string;
  preference: string;
  onExit?: () => void;
  shell?: string;
}) {
  const firstName = name.trim().split(/\s+/)[0] || "Thank you";
  const verb =
    CONTACT_PREFERENCES.find((p) => p.value === preference)?.verb ?? "contact";
  return (
    <div className={`flex ${shell} flex-col items-center justify-center bg-convo-surface px-6 py-12`}>
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-convo-accent">
          <Check className="h-10 w-10 text-convo-accent-foreground" strokeWidth={3} />
        </div>
        <h1 className="pt-6 text-2xl font-bold leading-snug text-convo-ink">
          {firstName}, we have your request!
        </h1>
        <p className="pt-3 text-sm text-convo-muted">
          A Kind Care coordinator will {verb} you within 1 business day to arrange your free
          consultation.
        </p>

        <ul className="mx-auto mt-6 space-y-2.5 text-left">
          {[
            "We review your care needs",
            "We match you with available caregivers",
            "You meet your caregiver before committing",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-convo-ink">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-convo-accent" />
              {item}
            </li>
          ))}
        </ul>

        <Link
          to="/auth"
          className="mt-8 block w-full rounded-2xl border border-convo-accent px-4 py-3.5 text-sm font-bold text-convo-accent"
        >
          Create an account to track your request →
        </Link>
        <button
          type="button"
          onClick={() => (onExit ? onExit() : (window.location.href = "/"))}
          className="mt-4 text-sm text-convo-muted underline-offset-4 hover:underline"
        >
          Return to home
        </button>
      </div>
    </div>
  );
}
