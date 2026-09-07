import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ConversationSurface } from "@/components/chat/ConversationSurface";
import { FamilyIntakeSurface } from "@/components/chat/FamilyIntakeSurface";
import { KnowledgeQaSurface } from "@/components/chat/KnowledgeQaSurface";
import { AssistantRouter } from "@/components/chat/AssistantRouter";
import { AssistantShell } from "@/components/chat/AssistantShell";
import { PublicOffice as PublicOfficeData } from "@/components/public-office/types";
import {
  CareersSection,
  HeroSection,
  HowItWorksSection,
  OfficeFooter,
  OfficeHeader,
  ServiceAreaSection,
  ServicesSection,
  StorySection,
  TestimonialsSection,
} from "@/components/public-office/OfficeSections";

type Mode = "router" | "apply" | "care" | "knowledge";

/** Fades a hex colour into a soft tint used for section backgrounds. */
function softTint(hex: string) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "hsl(var(--muted))";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0.08)`;
}

export default function PublicOffice({ initialMode }: { initialMode?: Mode }) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [office, setOffice] = useState<PublicOfficeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode | null>(initialMode ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_public_office", { p_slug: slug ?? "" });
      if (cancelled) return;
      if (error) console.error("Could not load office", error);
      setOffice((data as unknown as PublicOfficeData) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const name = office?.branding?.display_name || office?.name || "";

  useEffect(() => {
    if (!office) return;
    const previous = document.title;
    document.title = name;
    const meta = document.querySelector('meta[name="description"]');
    const previousDesc = meta?.getAttribute("content") ?? "";
    meta?.setAttribute(
      "content",
      office.public_content?.hero_subhead?.slice(0, 155) ||
        `${name} provides compassionate in-home care services.`
    );
    return () => {
      document.title = previous;
      meta?.setAttribute("content", previousDesc);
    };
  }, [office, name]);

  const style = useMemo(() => {
    const primary = office?.branding?.primary_color || "#0D9488";
    return {
      ["--office-primary" as string]: primary,
      ["--office-primary-soft" as string]: softTint(primary),
    } as React.CSSProperties;
  }, [office]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
      </main>
    );
  }

  if (!office) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold text-foreground">We couldn't find that agency page</h1>
        <p className="max-w-md text-muted-foreground">
          The link may be out of date, or the agency page is no longer published.
        </p>
        <Button asChild>
          <Link to="/">Back to CareMuch</Link>
        </Button>
      </main>
    );
  }

  const closeDialog = () => {
    setMode(null);
    if (initialMode) navigate(`/a/${office.slug}`, { replace: true });
  };
  const startOver = () => setMode("router");

  const dialogTitle =
    mode === "apply"
      ? "Caregiver application"
      : mode === "care"
        ? "Request care"
        : mode === "knowledge"
          ? "Ask a question"
          : "How can I help you today?";

  return (
    <div style={style} className="min-h-screen bg-background">
      <OfficeHeader office={office} onRequestCare={() => setMode("care")} onApply={() => setMode("apply")} />
      <main>
        <HeroSection office={office} onRequestCare={() => setMode("care")} onApply={() => setMode("apply")} />
        <ServicesSection office={office} />
        <ServiceAreaSection office={office} />
        <StorySection office={office} />
        <HowItWorksSection office={office} />
        <TestimonialsSection office={office} />
        <CareersSection office={office} onApply={() => setMode("apply")} />
        <OfficeFooter office={office} onRequestCare={() => setMode("care")} />
      </main>

      {mode === null && (
        <button
          type="button"
          onClick={() => setMode("router")}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105"
          style={{ backgroundColor: "var(--office-primary)" }}
        >
          <MessageCircle className="h-4 w-4" />
          Chat with us
        </button>
      )}

      <Dialog open={mode !== null} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent className="max-w-2xl overflow-hidden p-0">
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          <div className="max-h-[80vh] overflow-y-auto">
            <AssistantShell agencyName={name} showStartOver={mode !== "router"} onStartOver={startOver}>
              {mode === "router" && (
                <AssistantRouter onSelect={(target) => setMode(target)} />
              )}
              {mode === "apply" && (
                <ConversationSurface
                  audience="caregiver_screening"
                  agencyName={name}
                  embedded
                  agencyId={office.agency_id}
                  virtualOfficeId={office.virtual_office_id}
                  onExit={closeDialog}
                />
              )}
              {mode === "care" && (
                <FamilyIntakeSurface
                  embedded
                  agencyId={office.agency_id}
                  virtualOfficeId={office.virtual_office_id}
                  onExit={closeDialog}
                />
              )}
              {mode === "knowledge" && (
                <KnowledgeQaSurface agencyName={name} agencyId={office.agency_id} embedded />
              )}
            </AssistantShell>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
