import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { useTrainingContext } from "@/components/compliance/training/useTrainingData";
import { Button } from "@/components/ui/button";
import { parseDateOnly } from "@/lib/dateOnly";
import { fieldDisplay } from "@/lib/carePlan";
import { METHOD_LABEL, PLAN_DOC_TYPES, type InserviceForm, type TrainingContext, type TrainingForm } from "@/lib/training";
import type { TemplateField } from "@/lib/formTemplates";

const fmt = (s: string | null | undefined) => (s ? format(parseDateOnly(s.slice(0, 10)), "MM/dd/yyyy") : "");
/** A blank line to write on (wet signature, case number, handwritten dates). */
const Line = ({ w = "w-full", label }: { w?: string; label?: string }) => (
  <span className={`inline-flex flex-col ${w}`}><span className="block h-6 border-b border-black" />{label && <span className="text-[10px] uppercase tracking-wide">{label}</span>}</span>
);
const Box = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
  <span className="mr-4 inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-flex h-3.5 w-3.5 items-center justify-center border border-black text-[10px] leading-none">{on ? "X" : ""}</span>{children}</span>
);
const Cell = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="border border-black p-1.5"><div className="text-[10px] font-semibold uppercase tracking-wide">{label}</div><div className="min-h-[1.25rem]">{children}</div></div>
);
function ShellValues({ fields, values }: { fields: TemplateField[] | null; values: Record<string, unknown> }) {
  const own = (fields ?? []).filter((f) => f.storage === "field_value");
  if (!own.length) return null;
  return <div className="grid grid-cols-2">{own.map((f) => <Cell key={f.field_key} label={f.label}>{fieldDisplay(f, values?.[f.field_key])}</Cell>)}</div>;
}

/** ISK IPOS Training Form 33.01_01F (arch §1.3): header, per-staff rows, training information block. */
function TrainingSheet({ ctx, form }: { ctx: TrainingContext; form: TrainingForm }) {
  const byDate = new Map<string, typeof form.records>();
  for (const r of form.records) { const k = `${r.training_date ?? ""}|${r.trainer_name ?? ""}`; byDate.set(k, [...(byDate.get(k) ?? []), r]); }
  return (
    <article className="space-y-4" data-print="training">
      <header className="text-center">
        <h1 className="text-lg font-bold uppercase">Individual Plan of Service (IPOS) Training Form</h1>
        <p className="text-xs">ISK 33.01_01F · effective 11/14/2023</p>
      </header>
      <section className="grid grid-cols-2 sm:grid-cols-3" data-section="header">
        <Cell label="Individual served">{ctx.client_name}</Cell>
        <Cell label="Case number">{ctx.case_number ?? <Line />}</Cell>
        <Cell label="Effective date of plan">{fmt(form.plan_effective_date)}</Cell>
        <div className="col-span-2 border border-black p-1.5 sm:col-span-3"><div className="text-[10px] font-semibold uppercase tracking-wide">Type of plan</div>
          <div className="flex flex-wrap pt-1 text-sm">{PLAN_DOC_TYPES.map(([v, l]) => <Box key={v} on={form.plan_document_type === v}>{l}</Box>)}</div></div>
        <Cell label="Provider agency">{ctx.agency_name}</Cell>
        <Cell label="Location">{form.location ?? ""}</Cell>
        <Cell label="IPOS training version">v{form.training_version}</Cell>
      </section>
      <p className="text-xs">The staff listed below received training on this individual's IPOS from the case manager, the primary clinician or other qualified staff.</p>
      <section data-section="staff">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-[10px] uppercase">{["Training / PCP meeting date", "Staff name (print)", "Staff signature", "Primary clinician", "IPOS training method"].map((h) => <th key={h} className="border border-black p-1">{h}</th>)}</tr></thead>
          <tbody>{form.records.map((r) => (
            <tr key={r.caregiver_id}>
              <td className="border border-black p-1">{fmt(r.training_date)}</td>
              <td className="border border-black p-1">{r.caregiver_name}</td>
              <td className="border border-black p-1 align-bottom"><Line /></td>
              <td className="border border-black p-1">{r.primary_clinician_name ?? ""}</td>
              <td className="border border-black p-1 text-xs"><Box on={r.training_method === "pcp_meeting"}>{METHOD_LABEL.pcp_meeting}</Box><br /><Box on={r.training_method === "outside_pcp"}>{METHOD_LABEL.outside_pcp}</Box></td>
            </tr>))}</tbody>
        </table>
      </section>
      <section className="space-y-3" data-section="training-information">
        <h2 className="text-sm font-bold uppercase">Training information (each training date completed separately)</h2>
        {[...byDate.entries()].map(([k, rs]) => (
          <div key={k} className="space-y-2 border border-black p-2 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><span className="text-[10px] uppercase">Date of training</span><div>{fmt(rs[0].training_date)}</div></div>
              <div><span className="text-[10px] uppercase">Trainer (print)</span><div>{rs[0].trainer_name ?? ""}</div></div>
              <div><Line label="Trainer signature" /></div>
            </div>
            {rs.map((r) => (
              <div key={r.caregiver_id} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div><span className="text-[10px] uppercase">Staff name</span><div>{r.caregiver_name}</div></div>
                <div><Line label="Staff signature" /></div>
                <div><Line label="Signature date" /></div>
              </div>))}
          </div>))}
      </section>
      <ShellValues fields={form.field_snapshot} values={form.field_values} />
    </article>
  );
}

/** IPOS In-service form: the case manager trains the agency's program lead, who signs (arch §9.2 rule 5). */
function InserviceSheet({ ctx, form }: { ctx: TrainingContext; form: InserviceForm }) {
  const current = ctx.plan?.training_version === form.training_version;
  return (
    <article className="space-y-4" data-print="inservice">
      <header className="text-center"><h1 className="text-lg font-bold uppercase">IPOS In-service</h1><p className="text-xs">Case manager → program lead · plan training version {form.training_version}</p></header>
      <section className="grid grid-cols-2 sm:grid-cols-3" data-section="header">
        <Cell label="Individual served">{ctx.client_name}</Cell>
        <Cell label="Case number">{ctx.case_number ?? <Line />}</Cell>
        <Cell label="Provider agency">{ctx.agency_name}</Cell>
        {/* plan details are known only for the current version; an older form gets a line to fill in */}
        <Cell label="IPOS training version">v{form.training_version}</Cell>
        <Cell label="Plan effective date">{current ? fmt(ctx.plan?.effective_date) : <Line />}</Cell>
        <Cell label="Date of in-service">{fmt(form.trained_on)}</Cell>
      </section>
      <p className="text-xs">The case manager reviewed this individual's IPOS (goals, objectives and instructions for staff) with the program lead, who will train the direct-care staff before they work with the individual.</p>
      <section className="space-y-4 border border-black p-3 text-sm" data-section="signatures">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><span className="text-[10px] uppercase">Case manager / trainer (print)</span><div>{form.case_manager_name}</div></div>
          <div><Line label="Case manager signature" /></div>
          <div><Line label="Date" /></div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><span className="text-[10px] uppercase">Program lead (print)</span><div>{form.program_lead_name ?? ""}</div></div>
          <div><Line label="Program lead signature" /></div>
          <div><span className="text-[10px] uppercase">Signed in CareMuch</span><div>{fmt(form.signed_at)}</div></div>
        </div>
      </section>
      <ShellValues fields={form.field_snapshot} values={form.field_values} />
    </article>
  );
}

/** /training/:clientId/print/:kind/:formId — printable copy, no app chrome; ids only in the URL. */
export default function TrainingPrint() {
  const { clientId = "", kind, formId } = useParams();
  const ctx = useTrainingContext(clientId);
  useEffect(() => { document.title = kind === "inservice" ? "In-service form" : "Training form"; }, [kind]);
  const inservice = kind === "inservice" ? ctx.data?.inservice_forms.find((f) => f.id === formId) : undefined;
  const training = kind === "training" ? ctx.data?.training_forms.find((f) => f.id === formId) : undefined;
  return (
    <div className="min-h-screen bg-white text-black print:min-h-0">
      <style>{"@page { size: letter; margin: 0.5in; } @media print { body { background: white; } }"}</style>
      <div className="mx-auto max-w-[8in] p-4 print:p-0 sm:p-8">
        <div className="mb-4 flex items-center justify-between gap-2 print:hidden" data-testid="print-toolbar">
          <Link to={`/training/${clientId}`} className="text-sm underline">Back</Link>
          <Button onClick={() => window.print()} disabled={!inservice && !training}>Print</Button>
        </div>
        {ctx.isLoading ? <p>Loading…</p> : ctx.data && inservice ? <InserviceSheet ctx={ctx.data} form={inservice} />
          : ctx.data && training ? <TrainingSheet ctx={ctx.data} form={training} />
          : <p data-testid="print-missing">This form can't be shown here, or it wasn't found.</p>}
        <footer className="mt-6 text-[10px] text-gray-600">Printed from CareMuch. Signatures on this page are wet signatures; the record in CareMuch shows who entered it.</footer>
      </div>
    </div>
  );
}
