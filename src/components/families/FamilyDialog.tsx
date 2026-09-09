import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus, Users } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FlexibilityBadge } from "@/components/common/FlexibilityBadge";

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  is_primary: boolean;
  is_decision_maker: boolean;
}

interface Props {
  familyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

const emptyContact = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  relationship: "",
  is_primary: false,
  is_decision_maker: false,
};

export const FamilyDialog = ({ familyId, open, onOpenChange, onChanged }: Props) => {
  const [family, setFamily] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [flexibility, setFlexibility] = useState<string | null>(null);
  const [draft, setDraft] = useState({ family_name: "", notes: "" });
  const [newContact, setNewContact] = useState({ ...emptyContact });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!familyId) return;
    setLoading(true);
    const [{ data: fam }, { data: cls }, { data: cts }, { data: reqs }] = await Promise.all([
      supabase.from("families").select("*").eq("id", familyId).maybeSingle(),
      supabase.from("clients").select("id, first_name, last_name, city, is_active").eq("family_id", familyId),
      supabase.from("family_contacts").select("*").eq("family_id", familyId).order("is_primary", { ascending: false }),
      supabase
        .from("care_requests")
        .select("flexibility, created_at")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    setFamily(fam);
    setDraft({ family_name: (fam as any)?.family_name ?? "", notes: (fam as any)?.notes ?? "" });
    setMembers((cls as any[]) ?? []);
    setContacts((cts as any[]) ?? []);
    setFlexibility(((reqs as any[]) ?? [])[0]?.flexibility ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, familyId]);

  const saveFamily = async () => {
    if (!familyId) return;
    const { error } = await supabase
      .from("families")
      .update({ family_name: draft.family_name, notes: draft.notes })
      .eq("id", familyId);
    if (error) return toast.error(error.message);
    toast.success("Family saved");
    onChanged?.();
  };

  const addContact = async () => {
    if (!familyId) return;
    if (!newContact.first_name.trim()) return toast.error("Contact first name is required");
    const { error } = await supabase.from("family_contacts").insert({
      family_id: familyId,
      first_name: newContact.first_name,
      last_name: newContact.last_name,
      email: newContact.email || null,
      phone: newContact.phone || null,
      relationship: newContact.relationship || null,
      is_primary: newContact.is_primary,
      is_decision_maker: newContact.is_decision_maker,
    });
    if (error) return toast.error(error.message);
    setNewContact({ ...emptyContact });
    toast.success("Contact added");
    load();
  };

  const updateContact = async (id: string, patch: Partial<Contact>) => {
    const { error } = await supabase.from("family_contacts").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeContact = async (id: string) => {
    const { error } = await supabase.from("family_contacts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setContacts((cs) => cs.filter((c) => c.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Family
          </DialogTitle>
          <DialogDescription>
            A family groups one or more clients and their contacts. Client details stay on the client record.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

        {family && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Family name</Label>
                <Input
                  value={draft.family_name}
                  onChange={(e) => setDraft({ ...draft, family_name: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <FlexibilityBadge value={flexibility} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
            </div>
            <Button size="sm" onClick={saveFamily}>
              Save family
            </Button>

            <div>
              <p className="mb-2 text-sm font-medium">Clients in this family ({members.length})</p>
              <div className="flex flex-wrap gap-2">
                {members.length === 0 && (
                  <span className="text-sm text-muted-foreground">No clients linked yet.</span>
                )}
                {members.map((m) => (
                  <Badge key={m.id} variant={m.is_active ? "default" : "secondary"}>
                    {m.first_name} {m.last_name}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Family contacts</p>
              {contacts.map((c) => (
                <div key={c.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {c.first_name} {c.last_name}
                        {c.relationship ? ` · ${c.relationship}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}
                      </p>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => removeContact(c.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove contact</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="mt-2 flex gap-4">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={c.is_primary}
                        onCheckedChange={(v) => updateContact(c.id, { is_primary: Boolean(v) })}
                      />
                      Primary
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={c.is_decision_maker}
                        onCheckedChange={(v) => updateContact(c.id, { is_decision_maker: Boolean(v) })}
                      />
                      Decision maker
                    </label>
                  </div>
                </div>
              ))}

              <div className="rounded-lg border border-dashed p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="First name"
                    value={newContact.first_name}
                    onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })}
                  />
                  <Input
                    placeholder="Last name"
                    value={newContact.last_name}
                    onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })}
                  />
                  <Input
                    placeholder="Phone"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  />
                  <Input
                    placeholder="Email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  />
                  <Input
                    placeholder="Relationship (e.g. Daughter)"
                    value={newContact.relationship}
                    onChange={(e) => setNewContact({ ...newContact, relationship: e.target.value })}
                  />
                  <Button className="gap-2" onClick={addContact}>
                    <Plus className="h-4 w-4" /> Add contact
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
