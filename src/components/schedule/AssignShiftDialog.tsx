import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchCaregiverPerformance, shortRatingLabel } from "@/lib/caregiverPerformance";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Ban, CalendarDays, Clock, Loader2, MapPin, User } from "lucide-react";
import {
  assignShift,
  OverrideRequiredError,
  checkAssignmentConflicts,
  durationHours,
} from "@/lib/shiftAssignment";
import { evaluateEligibilityBulk, type EligibilityResult } from "@/lib/shiftEligibility";
import { ComplianceLines, EligibilityReport } from "@/components/schedule/EligibilityReport";
import { complianceLines } from "@/lib/eligibilityCompliance";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";

interface AssignShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: any | null;
  /** Preselected caregiver id (e.g. from an AI match). */
  defaultCaregiverId?: string | null;
  /** Optional decision context from AI matching. */
  matchContext?: { score?: number; factors?: string[]; warnings?: string[] } | null;
  onAssigned?: () => void;
}

const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "");

export const AssignShiftDialog = ({
  open,
  onOpenChange,
  shift,
  defaultCaregiverId,
  matchContext,
  onAssigned,
}: AssignShiftDialogProps) => {
  const [caregivers, setCaregivers] = useState<any[]>([]);
  const [eligibility, setEligibility] = useState<Map<string, EligibilityResult>>(new Map());
  const [careTypes, setCareTypes] = useState<any[]>([]);
  const [caregiverId, setCaregiverId] = useState<string>("");
  const [careTypeCode, setCareTypeCode] = useState<string>("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [overridePrompt, setOverridePrompt] = useState<string | null>(null);

  const client = shift?.clients || shift?.client;

  useEffect(() => {
    if (!open || !shift) return;
    setCaregiverId(
      defaultCaregiverId ||
        (shift.shift_assignments || []).find((a: any) => a?.status !== "cancelled")?.caregiver_id ||
        ""
    );

    setCareTypeCode(shift.care_type_code || "");
    setStartTime(hhmm(shift.start_time));
    setEndTime(hhmm(shift.end_time));
    setNotes("");
    setConflicts([]);
    setSearch("");

    const load = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", user.id)
        .maybeSingle();

      const [{ data: cgs }, { data: cts }] = await Promise.all([
        supabase
          .from("caregivers")
          .select("id, first_name, last_name, city, state, hourly_rate")
          .eq("agency_id", profile?.agency_id ?? "")
          .eq("is_active", true)
          .order("first_name"),
        supabase
          .from("care_types")
          .select("code, name")
          .eq("is_active", true)
          .order("name"),
      ]);
      const perf = await fetchCaregiverPerformance((cgs || []).map((c: any) => c.id));
      setCaregivers(
        (cgs || []).map((c: any) => ({ ...c, performance: perf.get(c.id) ?? null }))
      );
      setCareTypes(cts || []);
      setLoading(false);

      // Bulk eligibility for the whole roster -- partitions the picker below into
      // default-eligible vs. search-only-findable-but-disabled. An empty map (RPC
      // unreachable) means "unknown, don't filter" -- the roster shows unfiltered,
      // same as before this change; the server-side RPC still enforces at submit time.
      const eligMap = await evaluateEligibilityBulk(shift.id, (cgs || []).map((c: any) => c.id));
      setEligibility(eligMap);
    };
    load();
  }, [open, shift, defaultCaregiverId]);

  const hours = useMemo(
    () => (startTime && endTime ? durationHours(startTime, endTime) : 0),
    [startTime, endTime]
  );

  // Re-check conflicts whenever the proposal changes.
  useEffect(() => {
    if (!open || !shift || !caregiverId || hours <= 0) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    checkAssignmentConflicts({
      caregiverId,
      shiftId: shift.id,
      shiftDate: shift.shift_date,
      startTime,
      endTime,
    })
      .then((w) => !cancelled && setConflicts(w))
      .catch(() => !cancelled && setConflicts([]));
    return () => {
      cancelled = true;
    };
  }, [open, shift, caregiverId, startTime, endTime, hours]);

  const isEligible = (c: any) => eligibility.get(c.id)?.eligible !== false;

  /**
   * Default (no search text): only hard-eligible caregivers -- matches
   * check_assignment_eligibility's own `hard.length === 0` definition of eligible,
   * regardless of soft flags (a hard-clean, soft-flagged pick still goes through
   * the existing override flow below). Search: the full RLS-visible roster,
   * including hard-blocked candidates, so a manager can find and see WHY someone
   * is blocked -- selecting one disables Assign (see selectedResult below).
   */
  const filteredCaregivers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? caregivers.filter((c) => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q))
      : caregivers.filter(isEligible);
    // Always keep the currently-selected caregiver visible even if it would
    // otherwise be filtered out (e.g. a pre-filled AI suggestion or a blocked
    // pick found via search, then the search box is cleared).
    if (caregiverId && !base.some((c) => c.id === caregiverId)) {
      const selected = caregivers.find((c) => c.id === caregiverId);
      if (selected) return [selected, ...base];
    }
    return base;
  }, [caregivers, search, eligibility, caregiverId]);

  const selectedResult = caregiverId ? eligibility.get(caregiverId) ?? null : null;
  const hardBlocked = !!selectedResult && !selectedResult.eligible;
  // S10: an office using the care-plan module shows its care-plan checks with Fix links
  // (advisory while enforcement is off). Display only; check_assignment_eligibility decides.
  const { offices: complianceOffices } = useComplianceOffices();
  const rippleOffice = complianceOffices.find((o) => o.id === shift?.virtual_office_id);
  const eligContext = {
    ripple: !!rippleOffice && (rippleOffice.moduleEnabled || rippleOffice.enforcementEnabled),
    caregiverId,
    clientId: shift?.client_id ?? null,
  };
  const advisoryLines = eligContext.ripple && selectedResult && selectedResult.eligible
    ? complianceLines(selectedResult, eligContext).filter((l) => !l.blocked)
    : [];

  // Proactively surface the override note for a hard-clean, soft-flagged pick,
  // instead of waiting for the server to reject the first submit attempt. Hard
  // blocks never get an override prompt (none is possible) -- the dedicated
  // "cannot be assigned" panel above covers that case instead.
  useEffect(() => {
    if (selectedResult && selectedResult.eligible && selectedResult.blockers.length > 0) {
      setOverridePrompt(selectedResult.blockers.map((b) => b.detail).join(" "));
    } else {
      setOverridePrompt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caregiverId, selectedResult]);

  const handleConfirm = async () => {
    if (!shift) return;
    if (!caregiverId) {
      toast.error("Select a caregiver");
      return;
    }
    if (hours <= 0) {
      toast.error("End time must be after start time");
      return;
    }
    setSaving(true);
    try {
      await assignShift({
        shiftId: shift.id,
        caregiverId,
        careTypeCode: careTypeCode || null,
        startTime,
        endTime,
        notes,
        overrideReason: overridePrompt ? overrideReason : null,
        method: defaultCaregiverId === caregiverId && matchContext ? "ai_suggested" : "manual",
      });
      toast.success("Shift assigned");
      onOpenChange(false);
      onAssigned?.();
    } catch (e: any) {
      if (e instanceof OverrideRequiredError) {
        setOverridePrompt(e.message);
        toast.warning("This assignment needs a manager override reason");
      } else {
        toast.error(e.message || "Failed to assign shift");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!shift) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Shift</DialogTitle>
          <DialogDescription>
            Confirm the caregiver, care service and times before saving this assignment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Read-only context */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <User className="h-4 w-4 text-muted-foreground" />
              {client?.first_name} {client?.last_name}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              {shift.shift_date
                ? format(parseISO(shift.shift_date), "EEEE, MMMM d, yyyy")
                : "—"}
            </div>
            {client?.city && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {client.city}
                {client.state ? `, ${client.state}` : ""}
              </div>
            )}
          </div>

          {matchContext && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-1">
              {typeof matchContext.score === "number" && (
                <Badge className="mb-1">{matchContext.score}% AI match</Badge>
              )}
              {matchContext.factors?.length ? (
                <ul className="list-disc list-inside text-muted-foreground">
                  {matchContext.factors.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <Label>Caregiver *</Label>
            <Input
              placeholder="Search caregivers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={caregiverId} onValueChange={setCaregiverId}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Loading..." : "Select a caregiver"} />
              </SelectTrigger>
              <SelectContent>
                {filteredCaregivers.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No caregivers found
                  </SelectItem>
                ) : (
                  filteredCaregivers.map((c) => {
                    const blocked = !isEligible(c);
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {c.first_name} {c.last_name}
                        {blocked ? " • Not eligible" : ` • ${shortRatingLabel(c.performance)}`}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
            {!search.trim() && (
              <p className="text-xs text-muted-foreground">
                Showing only caregivers eligible for this shift. Search to find anyone else.
              </p>
            )}
          </div>

          {hardBlocked && selectedResult && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-2">
                <Ban className="h-4 w-4" />
                This caregiver cannot be assigned
              </div>
              <EligibilityReport result={selectedResult} context={eligContext} />
            </div>
          )}

          {advisoryLines.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
              <ComplianceLines lines={advisoryLines} />
            </div>
          )}

          <div className="space-y-2">
            <Label>Care service</Label>
            <Select value={careTypeCode} onValueChange={setCareTypeCode}>
              <SelectTrigger>
                <SelectValue placeholder="Select care service" />
              </SelectTrigger>
              <SelectContent>
                {careTypes.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Start time *</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>End time *</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {hours > 0 ? (
              <span>Duration: {hours} hour{hours === 1 ? "" : "s"}</span>
            ) : (
              <span className="text-destructive">End time must be after start time</span>
            )}
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-warning mb-1">
                <AlertTriangle className="h-4 w-4" />
                Scheduling warnings
              </div>
              <ul className="list-disc list-inside text-muted-foreground">
                {conflicts.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the caregiver should know..."
              rows={2}
            />
          </div>

          {overridePrompt && (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                Manager override required
              </div>
              <p className="text-sm text-muted-foreground">{overridePrompt}</p>
              <Label>Override reason</Label>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why this assignment should proceed..."
                rows={2}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={saving || !caregiverId || hours <= 0 || hardBlocked || (!!overridePrompt && !overrideReason.trim())}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
