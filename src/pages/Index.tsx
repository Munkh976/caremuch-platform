import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CareMuchLogo } from "@/components/brand/CareMuchLogo";
import { cn } from "@/lib/utils";

/**
 * Public home page (site rebrand, docs/design/website/caremuch-home.dc.html). CareMuch is a platform, not an agency: the
 * family / caregiver chat lives at /assistant and on each agency's public office page (/a/:slug), not here.
 * Fonts (Schibsted Grotesk, IBM Plex) are used on the public pages only. No real agency or staff names on this page.
 */
const WALKTHROUGH = "mailto:info@wordsnumbers.ai?subject=CareMuch%20walkthrough";
const EMAIL = "mailto:info@wordsnumbers.ai";
const focus = "rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D6FB8]";
const eyebrow = "font-plexmono text-[13px] uppercase tracking-[0.08em] text-[#0B6E8C]";
const h2 = "m-0 font-display font-bold leading-[1.04] tracking-[-0.03em]";
const body = "m-0 leading-relaxed text-[#405569]";
const primaryBtn = cn("inline-flex min-h-[44px] items-center rounded-full bg-gradient-to-r from-[#0A7889] to-[#1D6FB8] font-semibold text-white no-underline hover:text-white", focus, "focus-visible:rounded-full");
const ghostBtn = cn("inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-[#9DB6CC] bg-white font-semibold text-[#0F2B4C] no-underline hover:text-[#0F2B4C]", focus, "focus-visible:rounded-full");

const Check = ({ className = "h-3.5 w-3.5", stroke = "#0B6E8C", width = 2.5 }: { className?: string; stroke?: string; width?: number }) => (
  <svg className={cn("flex-none", className)} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
);
const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#1A6FB0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Chip = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C9E2EE] bg-white px-2.5 py-[5px] text-[12.5px]"><Check />{children}</span>
);

const PROBLEMS = [
  ["01", "A plan changes", "Who still needs retraining before their next shift? Someone has to remember."],
  ["02", "A CPR card expires", "The schedule keeps assigning that caregiver until an auditor notices."],
  ["03", "Units run out", "The authorization cap is hit mid-month and the last visits are unbillable."],
  ["04", "Friday billing", "Hours of rounding visits into 15-minute units and matching them to authorizations."],
];
const PRODUCTS: { title: string; text: string; icon: ReactNode }[] = [
  { title: "Care plans with versions", text: "Build plans from your own templates and goal measures. Revise with a full history; a new version stays pending until staff are trained, while the old one keeps visits running.",
    icon: <><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4" /><path d="M10 12h6M10 16h6" /></> },
  { title: "Training-gated scheduling", text: "Only caregivers with current credentials and training on the client's current plan appear as eligible. Overrides need a reason and are logged.",
    icon: <><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></> },
  { title: "Auto-assign, continuity first", text: "Fill a week of open shifts in one pass, favoring the caregivers each client already knows. You preview every proposal and confirm — nothing is saved behind your back. Weights are set per office.",
    icon: <><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M15 15.5c2.8-.6 6 1.2 6 4.5" /></> },
  { title: "Authorizations that count down", text: "Units draw first-in, first-out across authorizations, with weekly and monthly caps. Units at risk show early; a shift past an authorization or plan end date is refused when it's created.",
    icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 13h3v4H8z" /></> },
  { title: "Visit notes on the phone", text: "Caregivers write against the plan's goals at the end of the visit. Reviewers approve or return with a comment, one deliberate step at a time, with undo.",
    icon: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M9.5 7h5M9.5 10.5h5M9.5 14h3" /></> },
  { title: "Billing in true 15-minute units", text: "Choose your office's unit rule — full blocks only, a grace period, or nearest. Weekly billing by authorization or by day, with the rule stored on every note and a clean CSV export.",
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5h4" /></> },
];
const EXPIRING: [string, string, string, string, string][] = [
  ["CPR / First aid", "Ben K.", "6", "#F8E1DA", "#8A2A12"],
  ["Authorization · CLS", "Lily P.", "19", "#FBEBD3", "#7A4405"],
  ["Plan of service", "Max T.", "24", "#FBEBD3", "#7A4405"],
  ["Recipient-rights training", "Mia S.", "52", "#DFF0F7", "#0B6E8C"],
];
const WEEK = [
  ["Mon", "Plan", "A revised plan arrives. Publish it as pending; the system lists who must be retrained."],
  ["Tue", "Train", "Record the in-service and attendees. The plan takes effect when everyone on the team is trained."],
  ["Wed", "Schedule", "Auto-assign next week. Unassign, cancel or mark no-shows with a reason that stays on record."],
  ["Daily", "Document", "Caregivers clock the visit and write the note on their phone. Reviewers clear the queue."],
  ["Fri", "Bill", "Approved notes become units against the right authorization. Export and submit."],
];
const AUDIT = [
  ["Was this caregiver trained on the plan in effect that day?", "Checked by hand, after the fact", "Checked before assignment"],
  ["Was the visit inside an active authorization and plan?", "Found at billing", "Refused when the shift is created"],
  ["How were the units calculated?", "Rounded in a spreadsheet", "Office rule stored on every note"],
  ["Who reviewed the note, and what changed?", "Initials on paper", "Reviewer, time and adjustment logged"],
  ["Why was a visit cancelled or missed?", "A text message", "Reason required, kept on record"],
];

export default function Index() {
  // in-page anchors scroll smoothly (unless the visitor prefers reduced motion); restored when leaving the page
  useEffect(() => {
    document.title = "CareMuch — The care operations platform for agencies";
    const html = document.documentElement, before = html.style.scrollBehavior;
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) html.style.scrollBehavior = "smooth";
    return () => { html.style.scrollBehavior = before; };
  }, []);
  const navLink = cn("inline-flex min-h-[44px] items-center text-[#0F2B4C] no-underline hover:text-[#0B6E8C]", focus);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#F6F9FC] font-plex text-[#0F2B4C]">
      {/* NAV */}
      <header className="border-b border-[#DCE6EE] bg-white">
        <nav aria-label="Main" className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-2 px-6 py-3">
          <a href="#top" className={cn("inline-flex min-h-[44px] items-center no-underline", focus)} aria-label="CareMuch home">
            <CareMuchLogo size={36} textClassName="text-[23px]" />
          </a>
          <div className="flex flex-auto flex-wrap gap-x-6 gap-y-0 text-[15px] font-medium">
            <a href="#product" className={navLink}>Product</a>
            <a href="#week" className={navLink}>How a week runs</a>
            <a href="#idd" className={navLink}>For I/DD &amp; HCBS providers</a>
            <a href="#office" className={navLink}>Virtual office</a>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/auth" className={cn(navLink, "px-2 text-[15px] font-medium")}>Sign in</Link>
            <a href={WALKTHROUGH} className={cn(primaryBtn, "px-5 text-[15px]")}>Book a walkthrough</a>
          </div>
        </nav>
      </header>

      <main>
        {/* HERO */}
        <section id="top" className="mx-auto flex max-w-[1240px] scroll-mt-4 flex-wrap items-center gap-14 px-6 pb-[88px] pt-[72px]">
          <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-7">
            <div className={eyebrow}>The care operations platform for agencies</div>
            <h1 className="m-0 font-display text-[clamp(40px,6vw,76px)] font-extrabold leading-[0.98] tracking-[-0.035em]">Every visit in the right hands, on the right plan, billed to the minute.</h1>
            <p className={cn(body, "max-w-[560px] text-[20px] leading-[1.55]")}>CareMuch schedules, trains, documents and bills around the rules in your clients' plans and authorizations. The checks run when the shift is created, not at audit time — so your coordinators stop policing spreadsheets and your caregivers spend their hours with clients.</p>
            <div className="flex flex-wrap gap-3">
              <a href={WALKTHROUGH} className={cn(primaryBtn, "px-[26px] py-4 text-[17px]")}>Book a 30-minute walkthrough</a>
              <a href="#product" className={cn(ghostBtn, "px-6 py-[15px] text-[17px]")}>See the product</a>
            </div>
            <div className="text-sm text-[#4B5D70]">For home care, I/DD and HCBS agencies. CareMuch is software — your agency delivers the care.</div>
          </div>
          <div className="min-w-0 flex-[1_1_520px]">
            <figure role="img" aria-label="CareMuch schedule: a shift for Ana with client Zoe passes plan, training and authorization checks; a shift for Max is blocked because the plan of service ends before the shift date."
              className="m-0 overflow-hidden rounded-[20px] border border-[#DCE6EE] bg-white shadow-[0_30px_60px_-30px_rgba(15,43,76,0.30)]">
              <div className="flex items-center justify-between border-b border-[#E7EEF4] px-5 py-4">
                <div className="font-display text-base font-bold">Week of Oct 26</div>
                <div className="font-plexmono text-xs text-[#4B5D70]">Auto-assign · preview</div>
              </div>
              <div className="flex flex-col gap-3.5 p-5">
                <div className="flex flex-col gap-2.5 rounded-[14px] border border-[#C9E2EE] bg-[#EFF8FC] p-4">
                  <div className="flex flex-wrap justify-between gap-1.5"><strong className="text-base">Tue 9:00–1:00 · Zoe N.</strong><span className="font-plexmono text-xs text-[#0B6E8C]">16 units</span></div>
                  <div className="text-sm text-[#405569]">Proposed: <strong className="text-[#0F2B4C]">Ana R.</strong> — worked with Zoe 11 of the last 12 weeks</div>
                  <div className="flex flex-wrap gap-2"><Chip>Trained on plan v3</Chip><Chip>Credentials current</Chip><Chip>142 units left this month</Chip></div>
                </div>
                <div className="flex flex-col gap-2.5 rounded-[14px] border border-[#EBD3B2] bg-[#FCF6EC] p-4">
                  <div className="flex flex-wrap justify-between gap-1.5"><strong className="text-base">Mon Nov 2 · Max T.</strong><span className="font-plexmono text-xs text-[#9A5606]">Blocked at creation</span></div>
                  <div className="text-sm text-[#405569]">Plan of service ends Oct 31. The new plan is pending — staff training is scheduled for Oct 29.</div>
                  <div className="flex flex-wrap gap-2"><span className="rounded-full border border-[#EBD3B2] bg-white px-2.5 py-[5px] text-[12.5px] text-[#7A4405]">Renew plan to schedule</span></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                  <span className="text-sm text-[#4B5D70]">12 proposals · continuity first · nothing saved yet</span>
                  <span className="rounded-full bg-[#0F2B4C] px-4 py-2.5 text-sm font-semibold text-white">Confirm 12 shifts</span>
                </div>
              </div>
            </figure>
          </div>
        </section>

        {/* PROBLEM */}
        <section aria-labelledby="problem-h" className="border-y border-[#DCE6EE] bg-[#EAF3FA]">
          <div className="mx-auto flex max-w-[1240px] flex-wrap gap-12 px-6 py-[88px]">
            <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
              <div className={eyebrow}>The problem</div>
              <h2 id="problem-h" className={cn(h2, "text-[clamp(32px,4vw,52px)]")}>Most agencies run the rules from memory and spreadsheets.</h2>
              <p className={cn(body, "text-lg")}>Scheduling sits in one tool, training forms in a binder, credentials in a spreadsheet, notes on paper and billing in an export. The program lead is the integration layer — and a missed retraining or an expired authorization surfaces months later as a payback.</p>
            </div>
            <div className="grid min-w-0 flex-[1_1_520px] grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
              {PROBLEMS.map(([n, t, d]) => (
                <div key={n} className="flex flex-col gap-2 rounded-2xl border border-[#D3E2ED] bg-white p-[22px]">
                  <div className="font-plexmono text-[13px] text-[#1A6FB0]">{n}</div>
                  <strong className="text-lg">{t}</strong>
                  <span className="text-[15px] leading-normal text-[#405569]">{d}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRODUCT */}
        <section id="product" aria-labelledby="product-h" className="mx-auto flex max-w-[1240px] scroll-mt-4 flex-col gap-14 px-6 pb-10 pt-[104px]">
          <div className="flex flex-wrap items-end gap-x-16 gap-y-6">
            <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-[18px]">
              <div className={eyebrow}>One rule-aware system</div>
              <h2 id="product-h" className={cn(h2, "text-[clamp(32px,4vw,54px)]")}>The plan of service drives everything downstream.</h2>
            </div>
            <p className={cn(body, "min-w-0 flex-[1_1_380px] text-lg")}>Plans, training, credentials, authorizations, shifts, notes and billing share one record. When one changes, the others know — and the schedule refuses what would fail an audit.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-5">
            {PRODUCTS.map((p) => (
              <article key={p.title} className="flex flex-col gap-3.5 rounded-[20px] border border-[#DCE6EE] bg-white p-[30px]">
                <Icon>{p.icon}</Icon>
                <h3 className="m-0 font-display text-[23px] font-bold tracking-[-0.015em]">{p.title}</h3>
                <p className={cn(body, "text-base")}>{p.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* COMPLIANCE BAND */}
        <section aria-labelledby="audit-h" className="mx-auto max-w-[1240px] px-6 pb-[104px] pt-10">
          <div className="flex flex-wrap items-center gap-10 rounded-[28px] bg-[#E8F2F9] p-[clamp(24px,5vw,56px)]">
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-4">
              <div className={eyebrow}>Audit-ready by default</div>
              <h2 id="audit-h" className={cn(h2, "text-[clamp(30px,3.4vw,44px)] leading-[1.06] tracking-[-0.025em]")}>See what will expire before it costs you.</h2>
              <p className={cn(body, "text-[17px]")}>A compliance dashboard colors every credential, training and authorization by days left. Training sessions, sign-in sheets and files live with the plan they belong to, in private storage, and every change carries who and when.</p>
            </div>
            <div className="min-w-0 flex-[1_1_440px] overflow-x-auto rounded-[18px] border border-[#D3E2ED] bg-white" role="img"
              aria-label="Example compliance list: items expiring in the next 60 days with days left — CPR for Ben K. in 6 days, a CLS authorization for Lily P. in 19, Max T.'s plan of service in 24, recipient-rights training for Mia S. in 52.">
              <table className="w-full min-w-[420px] border-collapse text-[14.5px]">
                <caption className="px-5 pb-1.5 pt-4 text-left font-display text-base font-bold">Expiring in the next 60 days</caption>
                <thead><tr className="text-left text-[12.5px] uppercase tracking-[0.05em] text-[#4B5D70]">
                  <th className="px-5 py-2.5 font-medium">Item</th><th className="px-3 py-2.5 font-medium">Who</th><th className="px-5 py-2.5 text-right font-medium">Days left</th></tr></thead>
                <tbody>
                  {EXPIRING.map(([item, who, days, bg, fg]) => (
                    <tr key={item} className="border-t border-[#E7EEF4]"><td className="px-5 py-3">{item}</td><td className="px-3 py-3">{who}</td>
                      <td className="px-5 py-3 text-right"><span className="rounded-full px-2.5 py-[3px] font-semibold" style={{ background: bg, color: fg }}>{days}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* HOW A WEEK RUNS */}
        <section id="week" aria-labelledby="week-h" className="scroll-mt-4 border-y border-[#DCE6EE] bg-white">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-12 px-6 py-24">
            <div className="flex max-w-[760px] flex-col gap-4">
              <div className={eyebrow}>How a week runs</div>
              <h2 id="week-h" className={cn(h2, "text-[clamp(32px,4vw,54px)]")}>From plan to paid, without re-keying.</h2>
            </div>
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(210px,1fr))] border-t-[3px] border-[#1D6FB8] p-0">
              {WEEK.map(([d, t, x], i) => (
                <li key={d} className={cn("flex flex-col gap-2.5 pt-[22px]", i < WEEK.length - 1 && "pr-5")}>
                  <span className="font-plexmono text-sm text-[#0B6E8C]">{d}</span>
                  <strong className="font-display text-[22px]">{t}</strong>
                  <span className="text-[15px] leading-[1.55] text-[#405569]">{x}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* COMPARISON */}
        <section id="idd" aria-labelledby="idd-h" className="mx-auto flex max-w-[1240px] scroll-mt-4 flex-col gap-10 px-6 py-[104px]">
          <div className="flex flex-wrap items-end gap-x-16 gap-y-6">
            <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-[18px]">
              <div className={eyebrow}>Built for I/DD, HCBS and home care</div>
              <h2 id="idd-h" className={cn(h2, "text-[clamp(32px,4vw,54px)]")}>Rules enforced, not just recorded.</h2>
            </div>
            <p className={cn(body, "min-w-0 flex-[1_1_380px] text-lg")}>Community living supports, respite and personal care each come with their own plans, training and unit rules. CareMuch is configured per office, never hard-coded.</p>
          </div>
          <div className="overflow-x-auto rounded-[20px] border border-[#DCE6EE] bg-white" tabIndex={0} aria-label="Comparison table (scrolls sideways on small screens)">
            <table className="w-full min-w-[720px] border-collapse text-base">
              <thead><tr className="bg-[#F6F9FC] text-left">
                <th scope="col" className="w-[46%] px-6 py-[18px] font-semibold">What your auditor asks</th>
                <th scope="col" className="px-4 py-[18px] font-semibold text-[#4B5D70]">Scheduler + spreadsheets</th>
                <th scope="col" className="px-6 py-[18px] font-bold">CareMuch</th></tr></thead>
              <tbody>
                {AUDIT.map(([q, old, cm]) => (
                  <tr key={q} className="border-t border-[#E7EEF4]">
                    <th scope="row" className="px-6 py-[18px] text-left font-medium">{q}</th>
                    <td className="px-4 py-[18px] text-[#4B5D70]">{old}</td>
                    <td className="px-6 py-[18px] font-semibold text-[#0B6E8C]">{cm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* VIRTUAL OFFICE + AI COORDINATOR */}
        <section id="office" aria-labelledby="office-h" className="scroll-mt-4 border-y border-[#DCE6EE] bg-[#EAF3FA]">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-14 px-6 py-[104px]">
            <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-[22px]">
              <div className={eyebrow}>Virtual office · AI coordinator</div>
              <h2 id="office-h" className={cn(h2, "text-[clamp(32px,4vw,54px)]")}>Open a new office without opening a new building.</h2>
              <p className={cn(body, "text-lg")}>Each agency office gets its own team, clients, rules and public page. A conversational coordinator answers that agency's families and caregiver applicants around the clock, gathers what the intake team needs, and hands the conversation to the agency's own staff.</p>
              <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base">
                {["Separate offices, roles and data — managers see only their office", "Inquiries land in your intake queue, under your agency's name", "Caregivers pick up and trade open shifts they are eligible for"].map((t) => (
                  <li key={t} className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5" width={2.4} />{t}</li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 flex-[1_1_440px]">
              <figure role="img" aria-label="Example of an agency's virtual office chat, powered by CareMuch: a parent asks about weekend respite; the coordinator collects details and hands off to the agency's intake team."
                className="m-0 flex flex-col gap-3 rounded-[22px] border border-[#D3E2ED] bg-white p-[22px] shadow-[0_30px_60px_-34px_rgba(15,43,76,0.28)]">
                <div className="flex flex-wrap items-center gap-2.5 border-b border-[#E7EEF4] pb-2.5">
                  <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-[#FCE9D6] text-sm font-bold text-[#7A4405]">B</div>
                  <strong className="text-[15px]">Brightside Home Care</strong>
                  <span className="ml-auto text-[12.5px] text-[#4B5D70]">Example agency · powered by CareMuch</span>
                </div>
                <div className="max-w-[82%] self-end rounded-[16px_16px_4px_16px] bg-[#0F2B4C] px-4 py-3 text-[15px] leading-normal text-white">My son has autism and we need respite on weekends. Do you have anyone?</div>
                <div className="max-w-[86%] self-start rounded-[16px_16px_16px_4px] border border-[#C9E2EE] bg-[#EFF8FC] px-4 py-3 text-[15px] leading-normal">We may. Which days and hours work best, and is respite part of his plan of service?</div>
                <div className="max-w-[82%] self-end rounded-[16px_16px_4px_16px] bg-[#0F2B4C] px-4 py-3 text-[15px] leading-normal text-white">Saturdays, 10 to 2. Yes, it's in his plan.</div>
                <div className="max-w-[86%] self-start rounded-[16px_16px_16px_4px] border border-[#C9E2EE] bg-[#EFF8FC] px-4 py-3 text-[15px] leading-normal">Thank you. I've passed this to Brightside's intake team — would a call tomorrow morning work?</div>
              </figure>
            </div>
          </div>
        </section>

        {/* PROOF (text only; the partner quote ships when the provider approves it) */}
        <section aria-labelledby="proof-h" className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-12 px-6 pb-14 pt-[104px]">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
            <div className={eyebrow}>Built with providers, not for a slide</div>
            <h2 id="proof-h" className={cn(h2, "text-[clamp(30px,3.4vw,44px)] leading-[1.06] tracking-[-0.025em]")}>Every rule in CareMuch came from a real program lead's week.</h2>
            <p className={cn(body, "text-[17px]")}>We designed the care-plan, training and billing modules side by side with a Michigan community-inclusion provider serving children and adults with intellectual and developmental disabilities, and a home care agency known for keeping its caregivers.</p>
          </div>
          {/* Partner quote slot: add a <blockquote> here once the provider has approved the wording and attribution. */}
        </section>

        {/* COMING NEXT */}
        <section aria-label="Coming next" className="mx-auto max-w-[1240px] px-6 pb-[104px]">
          <div className="flex flex-wrap items-baseline gap-x-12 gap-y-5 border-t border-[#DCE6EE] pt-8">
            <strong className="font-display text-xl">Coming next</strong>
            <span className="text-base text-[#405569]">Electronic signatures on plans and training forms</span>
            <span className="text-base text-[#405569]">Expiry and review notifications</span>
            <span className="text-base text-[#405569]">A family portal for visit updates</span>
          </div>
        </section>

        {/* CTA */}
        <section id="demo" aria-labelledby="demo-h" className="mx-auto max-w-[1240px] scroll-mt-4 px-6 pb-24">
          <div className="flex flex-wrap items-center justify-between gap-8 rounded-[32px] bg-[linear-gradient(110deg,#0A7889_0%,#1D6FB8_100%)] p-[clamp(28px,6vw,72px)] text-white">
            <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-3.5">
              <h2 id="demo-h" className="m-0 font-display text-[clamp(32px,4.4vw,58px)] font-extrabold leading-none tracking-[-0.035em]">Bring us your hardest week.</h2>
              <p className="m-0 max-w-[560px] text-lg leading-[1.55] text-white">In 30 minutes we'll walk through your plans, training and billing rules in a working demo office — and show you what CareMuch would have caught.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={WALKTHROUGH} className={cn("inline-flex min-h-[44px] items-center rounded-full bg-white px-[26px] py-4 text-[17px] font-bold text-[#0F2B4C] no-underline hover:text-[#0F2B4C]", focus, "focus-visible:rounded-full focus-visible:outline-white")}>Book a walkthrough</a>
              <a href={EMAIL} className={cn("inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-white px-6 py-[15px] text-[17px] font-semibold text-white no-underline hover:text-white", focus, "focus-visible:rounded-full focus-visible:outline-white")}>Email the team</a>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-[#DCE6EE] bg-white">
        <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-x-16 gap-y-8 px-6 py-12">
          <div className="flex flex-[1_1_280px] flex-col gap-3">
            <CareMuchLogo size={30} textClassName="text-xl" />
            <span className="max-w-[340px] text-sm leading-normal text-[#4B5D70]">The care operations platform for agencies that want their people to stay. CareMuch is software; care is provided by the agencies that use it.</span>
          </div>
          <div className="flex flex-wrap gap-x-14 gap-y-8 text-[15px]">
            <FooterCol title="Product"><a href="#product" className={footLink}>Features</a><a href="#idd" className={footLink}>I/DD &amp; HCBS</a><a href="#office" className={footLink}>Virtual office</a></FooterCol>
            {/* "Find an agency on CareMuch" returns with the agency directory */}
            <FooterCol title="Get started"><a href={WALKTHROUGH} className={footLink}>Book a walkthrough</a><Link to="/auth" className={footLink}>Sign in</Link></FooterCol>
            {/* Privacy / Terms links return when those pages exist */}
            <FooterCol title="Company"><a href="https://wordsnumbers.ai" target="_blank" rel="noopener" className={footLink}>Words &amp; Numbers</a></FooterCol>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-x-6 gap-y-2 border-t border-[#E7EEF4] px-6 pb-8 pt-5 text-[13px] text-[#4B5D70]">
          <span>© 2026 Words &amp; Numbers, LLC. All rights reserved.</span>
          <span>CareMuch is built by <a href="https://wordsnumbers.ai" target="_blank" rel="noopener" className={cn("text-[#0B6E8C] underline-offset-2 hover:text-[#0F2B4C] hover:underline", focus)}>Words &amp; Numbers</a></span>
        </div>
      </footer>
    </div>
  );
}

const footLink = cn("inline-flex min-h-[44px] items-center text-[#0F2B4C] no-underline hover:text-[#0B6E8C]", focus);
const FooterCol = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex flex-col"><strong className="pb-1 text-[13px] uppercase tracking-[0.06em] text-[#4B5D70]">{title}</strong>{children}</div>
);
