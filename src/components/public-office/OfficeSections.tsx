import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, MapPin, Mail, Phone, Quote, Sparkles } from "lucide-react";
import { PublicOffice } from "./types";

interface SectionProps {
  office: PublicOffice;
  onRequestCare: () => void;
  onApply: () => void;
}

const displayName = (office: PublicOffice) =>
  office.branding?.display_name || office.name || office.agency_name;

export function OfficeHeader({ office, onRequestCare, onApply }: SectionProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          {office.branding?.logo_url ? (
            <img
              src={office.branding.logo_url}
              alt={`${displayName(office)} logo`}
              className="h-9 w-auto max-w-[180px] object-contain"
              loading="lazy"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[--office-primary] text-white">
              <Heart className="h-4 w-4" />
            </span>
          )}
          <span className="text-base font-semibold text-foreground">{displayName(office)}</span>
        </div>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#services" className="hover:text-foreground">Services</a>
          <a href="#area" className="hover:text-foreground">Service area</a>
          <a href="#story" className="hover:text-foreground">About</a>
          <a href="#careers" className="hover:text-foreground">Careers</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onApply} className="hidden sm:inline-flex">
            Careers
          </Button>
          <Button
            size="sm"
            onClick={onRequestCare}
            style={{ backgroundColor: "var(--office-primary)" }}
            className="text-white hover:opacity-90"
          >
            Request care
          </Button>
        </div>
      </div>
    </header>
  );
}

export function HeroSection({ office, onRequestCare, onApply }: SectionProps) {
  const c = office.public_content ?? {};
  return (
    <section className="border-b border-border/60 bg-gradient-to-b from-[--office-primary-soft] to-background">
      <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="max-w-3xl">
          {office.branding?.tagline && (
            <Badge variant="secondary" className="mb-4">{office.branding.tagline}</Badge>
          )}
          <h1 className="text-4xl font-bold leading-tight text-foreground md:text-5xl">
            {c.hero_headline || `In-home care from ${displayName(office)}`}
          </h1>
          {c.hero_subhead && (
            <p className="mt-5 text-lg text-muted-foreground">{c.hero_subhead}</p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              onClick={onRequestCare}
              style={{ backgroundColor: "var(--office-primary)" }}
              className="text-white hover:opacity-90"
            >
              {c.cta_care_label || "Request care"}
            </Button>
            <Button size="lg" variant="outline" onClick={onApply}>
              {c.cta_careers_label || "Apply as a caregiver"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ServicesSection({ office }: { office: PublicOffice }) {
  if (!office.services.length) return null;
  const intro = office.public_content?.services_intro;
  return (
    <section id="services" className="mx-auto max-w-6xl px-5 py-16">
      <h2 className="text-2xl font-bold text-foreground md:text-3xl">Our care services</h2>
      {intro && <p className="mt-3 max-w-2xl text-muted-foreground">{intro}</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {office.services.map((service) => (
          <Card key={service.code} className="border-border/70">
            <CardContent className="p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[--office-primary-soft] text-[--office-primary]">
                <Sparkles className="h-4 w-4" />
              </span>
              <h3 className="mt-4 font-semibold text-foreground">{service.name}</h3>
              {service.category && (
                <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {service.category}
                </p>
              )}
              {service.description && (
                <p className="mt-2 text-sm text-muted-foreground">{service.description}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function ServiceAreaSection({ office }: { office: PublicOffice }) {
  const zips = office.service_zipcodes ?? [];
  const states = office.service_states ?? [];
  const note = office.public_content?.service_area_note || office.service_area?.notes;
  if (!zips.length && !states.length && !note) return null;
  return (
    <section id="area" className="border-y border-border/60 bg-muted/40">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground md:text-3xl">
          <MapPin className="h-6 w-6 text-[--office-primary]" /> Where we serve
        </h2>
        {note && <p className="mt-3 max-w-2xl text-muted-foreground">{note}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {states.map((s) => (
            <Badge key={s} variant="secondary">{s}</Badge>
          ))}
          {zips.map((z) => (
            <Badge key={z} variant="outline">{z}</Badge>
          ))}
        </div>
        {office.service_area?.radius_miles ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Within about {office.service_area.radius_miles} miles
            {office.service_area.center_zip ? ` of ${office.service_area.center_zip}` : ""}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function StorySection({ office }: { office: PublicOffice }) {
  const story = office.public_content?.story;
  if (!story?.body) return null;
  return (
    <section id="story" className="mx-auto max-w-3xl px-5 py-16">
      <h2 className="text-2xl font-bold text-foreground md:text-3xl">{story.title || "Our story"}</h2>
      <p className="mt-4 whitespace-pre-line text-muted-foreground">{story.body}</p>
    </section>
  );
}

export function HowItWorksSection({ office }: { office: PublicOffice }) {
  const steps = office.public_content?.steps ?? [];
  if (!steps.length) return null;
  return (
    <section className="border-y border-border/60 bg-muted/40">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold text-foreground md:text-3xl">Getting started</h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={`${step.title}-${i}`} className="rounded-xl border border-border/70 bg-background p-5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: "var(--office-primary)" }}
              >
                {i + 1}
              </span>
              <h3 className="mt-4 font-semibold text-foreground">{step.title}</h3>
              {step.body && <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function TestimonialsSection({ office }: { office: PublicOffice }) {
  const items = office.public_content?.testimonials ?? [];
  if (!items.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <h2 className="text-2xl font-bold text-foreground md:text-3xl">Families we support</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {items.map((t, i) => (
          <Card key={i} className="border-border/70">
            <CardContent className="p-6">
              <Quote className="h-5 w-5 text-[--office-primary]" />
              <p className="mt-3 text-sm text-foreground">{t.quote}</p>
              <p className="mt-4 text-sm font-medium text-muted-foreground">
                {t.author}
                {t.location ? ` · ${t.location}` : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function CareersSection({ office, onApply }: { office: PublicOffice; onApply: () => void }) {
  const blurb = office.public_content?.careers_blurb;
  return (
    <section id="careers" className="border-y border-border/60 bg-[--office-primary-soft]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-16 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-foreground md:text-3xl">Work with us</h2>
          <p className="mt-3 text-muted-foreground">
            {blurb || `${displayName(office)} is always looking for caring, reliable caregivers.`}
          </p>
        </div>
        <Button
          size="lg"
          onClick={onApply}
          style={{ backgroundColor: "var(--office-primary)" }}
          className="text-white hover:opacity-90"
        >
          {office.public_content?.cta_careers_label || "Apply as a caregiver"}
        </Button>
      </div>
    </section>
  );
}

export function OfficeFooter({ office, onRequestCare }: { office: PublicOffice; onRequestCare: () => void }) {
  const address = [office.address, office.city, office.state, office.zip_code]
    .filter(Boolean)
    .join(", ");
  return (
    <footer className="mx-auto max-w-6xl px-5 py-14">
      <div className="rounded-2xl border border-border/70 bg-muted/30 p-8">
        <h2 className="text-xl font-bold text-foreground">Talk with {displayName(office)}</h2>
        <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          {office.contact_phone && (
            <span className="flex items-center gap-2"><Phone className="h-4 w-4" />{office.contact_phone}</span>
          )}
          {office.contact_email && (
            <span className="flex items-center gap-2"><Mail className="h-4 w-4" />{office.contact_email}</span>
          )}
          {address && (
            <span className="flex items-center gap-2"><MapPin className="h-4 w-4" />{address}</span>
          )}
        </div>
        <Button
          className="mt-6 text-white hover:opacity-90"
          style={{ backgroundColor: "var(--office-primary)" }}
          onClick={onRequestCare}
        >
          {office.public_content?.cta_care_label || "Request care"}
        </Button>
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {displayName(office)}. Powered by CareMuch.
      </p>
    </footer>
  );
}
