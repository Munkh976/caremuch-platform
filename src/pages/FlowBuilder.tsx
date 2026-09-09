import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ConversationFlow,
  FlowNode,
  TRAIT_KEYS,
  TRAIT_LABELS,
  optionPoints,
  validateFlow,
} from "@/lib/flowEngine";
import { AlertTriangle, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { DynamicNodeEditor } from "@/components/flow-builder/DynamicNodeEditor";
import { isDynamicSource } from "@/lib/dynamicCatalog";

const NODE_TYPES = [
  { value: "single_select", label: "Single choice" },
  { value: "multi_select", label: "Multiple choice" },
  { value: "info", label: "Information only" },
];

const AUTO_NEXT = "__auto";
const FIXED_ANSWERS = "__fixed";

type BuilderFlow = ConversationFlow & {
  status: string;
  published_at: string | null;
  draft_of: string | null;
  version: number;
};

export default function FlowBuilder() {
  const [flows, setFlows] = useState<BuilderFlow[]>([]);
  const [activeAudience, setActiveAudience] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [versioning, setVersioning] = useState(false);

  const loadFlows = useCallback(async () => {
    const { data, error } = await supabase
      .from("conversation_flows")
      .select(
        "id, audience, name, description, entry_node_id, strong_fit_threshold, review_threshold, status, published_at, draft_of, version"
      )
      .in("status", ["published", "draft"])
      .order("audience");
    if (error) {
      toast({ title: "Could not load conversations", description: error.message, variant: "destructive" });
      return;
    }
    const list = (data || []).map((f: any) => ({ ...f, nodes: [] })) as BuilderFlow[];
    setFlows(list);
    setActiveAudience((prev) => prev ?? list[0]?.audience ?? null);
    return list;
  }, []);

  const loadNodes = useCallback(async (flowId: string) => {
    const { data: nodeRows, error } = await supabase
      .from("flow_nodes")
      .select(
        "id, flow_id, node_key, prompt, helper_text, node_type, allow_skip, allow_free_text, free_text_label, sort_order, default_next_node_id, dynamic_source_table, default_weights, sub_question_template"
      )
      .eq("flow_id", flowId)
      .order("sort_order");
    if (error) {
      toast({ title: "Could not load questions", description: error.message, variant: "destructive" });
      return;
    }
    const ids = (nodeRows || []).map((n: any) => n.id);
    const { data: optionRows } = await supabase
      .from("flow_options")
      .select(
        "id, node_id, label, value, sort_order, score_weight, trait_tag, trait_weights, next_node_id"
      )
      .in("node_id", ids)
      .order("sort_order");

    const built = (nodeRows || []).map((n: any) => ({
      ...n,
      options: (optionRows || []).filter((o: any) => o.node_id === n.id),
    })) as FlowNode[];
    setNodes(built);
    setSelectedNodeId((prev) => (prev && built.some((n) => n.id === prev) ? prev : built[0]?.id ?? null));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadFlows();
      setLoading(false);
    })();
  }, [loadFlows]);

  const audiences = useMemo(() => {
    const seen: { audience: string; name: string }[] = [];
    for (const f of flows) {
      if (!seen.some((a) => a.audience === f.audience)) {
        seen.push({ audience: f.audience, name: f.name });
      }
    }
    return seen;
  }, [flows]);

  /** The published version currently served to visitors. */
  const publishedFlow = useMemo(
    () => flows.find((f) => f.audience === activeAudience && f.status === "published") ?? null,
    [flows, activeAudience]
  );
  /** The editable copy, if one has been started. */
  const draftFlow = useMemo(
    () => flows.find((f) => f.audience === activeAudience && f.status === "draft") ?? null,
    [flows, activeAudience]
  );
  /** Drafts are edited; the published version is shown read-only. */
  const activeFlow = draftFlow ?? publishedFlow;
  const activeFlowId = activeFlow?.id ?? null;
  const readOnly = !draftFlow;

  useEffect(() => {
    if (activeFlowId) void loadNodes(activeFlowId);
  }, [activeFlowId, loadNodes]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const validation = useMemo(
    () =>
      activeFlow
        ? validateFlow({ ...activeFlow, nodes })
        : { orphans: [], backwardBranches: [], multiParent: [] },
    [activeFlow, nodes]
  );

  /**
   * Branching is owned by the earlier question: a question can only be pointed
   * at by one parent, and only from a question that comes before it.
   */
  const availableTargets = useMemo(() => {
    if (!selectedNode) return [] as FlowNode[];
    const claimedByOthers = new Set<string>();
    for (const node of nodes) {
      if (node.id === selectedNode.id) continue;
      if (node.default_next_node_id) claimedByOthers.add(node.default_next_node_id);
      node.options.forEach((o) => o.next_node_id && claimedByOthers.add(o.next_node_id));
    }
    return nodes.filter(
      (n) => n.sort_order > selectedNode.sort_order && !claimedByOthers.has(n.id)
    );
  }, [nodes, selectedNode]);

  const patchNode = (nodeId: string, patch: Partial<FlowNode>) =>
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));

  const saveNode = async () => {
    if (!selectedNode) return;
    setSaving(true);
    const { options, ...row } = selectedNode;
    const { error } = await supabase
      .from("flow_nodes")
      .update({
        prompt: row.prompt,
        helper_text: row.helper_text,
        node_type: row.node_type as never,
        allow_skip: row.allow_skip,
        allow_free_text: row.allow_free_text,
        free_text_label: row.free_text_label,
        default_next_node_id: row.default_next_node_id,
                        dynamic_source_table: row.dynamic_source_table ?? null,
        default_weights: (row.default_weights ?? {}) as never,
        sub_question_template: row.sub_question_template ?? null,
      })
      .eq("id", row.id);

    let optionError: string | null = null;
    for (const option of isDynamicSource(row.dynamic_source_table) ? [] : options) {
      const { error: oErr } = await supabase
        .from("flow_options")
        .update({
          label: option.label,
          value: option.value,
          score_weight: optionPoints(option),
          trait_weights: (option.trait_weights ?? {}) as never,
          trait_tag: option.trait_tag,
          next_node_id: option.next_node_id,
          sort_order: option.sort_order,
        })
        .eq("id", option.id);
      if (oErr) optionError = oErr.message;
    }
    setSaving(false);

    if (error || optionError) {
      toast({
        title: "Could not save",
        description: error?.message || optionError || "",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Question saved" });
  };

  const addOption = async () => {
    if (!selectedNode) return;
    const { data, error } = await supabase
      .from("flow_options")
      .insert({
        node_id: selectedNode.id,
        label: "New answer",
        value: `option_${selectedNode.options.length + 1}`,
        sort_order: selectedNode.options.length + 1,
        score_weight: 0,
      })
      .select(
        "id, node_id, label, value, sort_order, score_weight, trait_tag, trait_weights, next_node_id"
      )
      .single();
    if (error) {
      toast({ title: "Could not add answer", description: error.message, variant: "destructive" });
      return;
    }
    // Merge only the new row so any unsaved edits on screen survive.
    patchNode(selectedNode.id, { options: [...selectedNode.options, data as never] });
  };

  const removeOption = async (optionId: string) => {
    if (!selectedNode) return;
    const { error } = await supabase.from("flow_options").delete().eq("id", optionId);
    if (error) {
      toast({ title: "Could not remove answer", description: error.message, variant: "destructive" });
      return;
    }
    patchNode(selectedNode.id, {
      options: selectedNode.options.filter((o) => o.id !== optionId),
    });
  };

  const addQuestion = async () => {
    if (!activeFlowId) return;
    const sort = (nodes[nodes.length - 1]?.sort_order ?? 0) + 10;
    const { data, error } = await supabase
      .from("flow_nodes")
      .insert({
        flow_id: activeFlowId,
        node_key: `question_${Date.now()}`,
        prompt: "New question",
        node_type: "single_select" as never,
        sort_order: sort,
      })
      .select(
        "id, flow_id, node_key, prompt, helper_text, node_type, allow_skip, allow_free_text, free_text_label, sort_order, default_next_node_id"
      )
      .single();
    if (error) {
      toast({ title: "Could not add question", description: error.message, variant: "destructive" });
      return;
    }
    const created = { ...(data as any), options: [] } as FlowNode;
    setNodes((prev) => [...prev, created]);
    setSelectedNodeId(created.id);
  };

  const deleteQuestion = async (nodeId: string) => {
    const { error } = await supabase.from("flow_nodes").delete().eq("id", nodeId);
    if (error) {
      toast({
        title: "Could not delete question",
        description: "This question is still referenced by another question or an answer.",
        variant: "destructive",
      });
      return;
    }
    setSelectedNodeId(null);
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
  };

  /** Start an editable copy of the published version. */
  const startDraft = async () => {
    if (!publishedFlow) return;
    setVersioning(true);
    const { error } = await supabase.rpc("create_flow_draft", { p_flow_id: publishedFlow.id });
    setVersioning(false);
    if (error) {
      toast({ title: "Could not start a draft", description: error.message, variant: "destructive" });
      return;
    }
    setSelectedNodeId(null);
    await loadFlows();
    toast({ title: "Draft created", description: "Visitors keep using the published version until you publish." });
  };

  const publishDraft = async () => {
    if (!draftFlow) return;
    setVersioning(true);
    const { error } = await supabase.rpc("publish_flow_draft", { p_draft_id: draftFlow.id });
    setVersioning(false);
    if (error) {
      toast({ title: "Could not publish", description: error.message, variant: "destructive" });
      return;
    }
    await loadFlows();
    toast({ title: "Draft published", description: "New screenings will now use this version." });
  };

  const discardDraft = async () => {
    if (!draftFlow) return;
    setVersioning(true);
    const { error } = await supabase.rpc("discard_flow_draft", { p_draft_id: draftFlow.id });
    setVersioning(false);
    if (error) {
      toast({ title: "Could not discard draft", description: error.message, variant: "destructive" });
      return;
    }
    setSelectedNodeId(null);
    await loadFlows();
    toast({ title: "Draft discarded" });
  };

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conversation Builder</h1>
            <p className="text-sm text-muted-foreground">
              Edit the guided questions, answers and scoring used by the public assistant.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/assistant" target="_blank">
              Preview assistant
              <ExternalLink className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
          </div>
        ) : flows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations configured yet.</p>
        ) : (
          <>
            <Tabs
              value={activeAudience ?? undefined}
              onValueChange={(v) => {
                setSelectedNodeId(null);
                setActiveAudience(v);
              }}
            >
              <TabsList>
                {audiences.map((a) => (
                  <TabsTrigger key={a.audience} value={a.audience}>
                    {a.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {draftFlow ? (
                  <>
                    <Badge>Draft v{draftFlow.version}</Badge>
                    <span className="text-muted-foreground">
                      You are editing a draft. Visitors keep using the published version
                      {publishedFlow ? ` (v${publishedFlow.version})` : ""} until you publish.
                    </span>
                  </>
                ) : (
                  <>
                    <Badge variant="secondary">Published v{publishedFlow?.version ?? 1}</Badge>
                    <span className="text-muted-foreground">
                      This is the live version and is read-only. Start a draft to make changes.
                    </span>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                {draftFlow ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={discardDraft} disabled={versioning}>
                      Discard draft
                    </Button>
                    <Button size="sm" onClick={publishDraft} disabled={versioning}>
                      {versioning ? "Working..." : "Publish draft"}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={startDraft} disabled={versioning || !publishedFlow}>
                    {versioning ? "Working..." : "Edit as draft"}
                  </Button>
                )}
              </div>
            </div>

            {(validation.orphans.length > 0 ||
              validation.backwardBranches.length > 0 ||
              validation.multiParent.length > 0) && (
              <div className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                {validation.orphans.length > 0 && (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>
                      {validation.orphans.length} question(s) cannot be reached from the start:{" "}
                      {validation.orphans.map((o) => o.node_key).join(", ")}
                    </span>
                  </div>
                )}
                {validation.multiParent.length > 0 && (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>
                      More than one question leads to:{" "}
                      {validation.multiParent.map((o) => o.node_key).join(", ")}
                    </span>
                  </div>
                )}
                {validation.backwardBranches.length > 0 && (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>
                      {validation.backwardBranches.length} answer(s) branch backwards, which can loop
                      the conversation.
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Questions</CardTitle>
                  <Button size="sm" variant="outline" onClick={addQuestion} disabled={readOnly}>
                    <Plus className="mr-1 h-4 w-4" /> Add
                  </Button>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {nodes.map((n, index) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setSelectedNodeId(n.id)}
                      className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        n.id === selectedNodeId
                          ? "border-primary bg-accent"
                          : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span className="mt-0.5 text-xs text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{n.prompt}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {n.options.length} answers
                        </span>
                      </span>
                      {activeFlow?.entry_node_id === n.id && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          Start
                        </Badge>
                      )}
                    </button>
                  ))}
                </CardContent>
              </Card>

              {selectedNode ? (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">Edit question</CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={readOnly}
                        onClick={() => deleteQuestion(selectedNode.id)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Delete
                      </Button>
                      <Button size="sm" onClick={saveNode} disabled={saving || readOnly}>
                        {saving ? "Saving..." : "Save changes"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <Label>Question</Label>
                      <Textarea
                        value={selectedNode.prompt}
                        rows={2}
                        onChange={(e) => patchNode(selectedNode.id, { prompt: e.target.value })}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Helper text</Label>
                        <Input
                          value={selectedNode.helper_text ?? ""}
                          onChange={(e) =>
                            patchNode(selectedNode.id, { helper_text: e.target.value || null })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Answer style</Label>
                        <Select
                          value={selectedNode.node_type}
                          onValueChange={(v) => patchNode(selectedNode.id, { node_type: v as never })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {NODE_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Where do the answers come from?</Label>
                      <Select
                        value={selectedNode.dynamic_source_table ?? FIXED_ANSWERS}
                        onValueChange={(v) =>
                          patchNode(selectedNode.id, {
                            dynamic_source_table: v === FIXED_ANSWERS ? null : v,
                          })
                        }
                      >
                        <SelectTrigger disabled={readOnly}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FIXED_ANSWERS}>
                            Fixed answers I write below
                          </SelectItem>
                          <SelectItem value="care_service_categories">
                            Care service categories (with per-category follow-ups)
                          </SelectItem>
                          <SelectItem value="care_types">Care services</SelectItem>
                          <SelectItem value="certifications">Certifications</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Catalog answers always show the live, active list — no need to retype them
                        here when the catalog changes.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-6">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={selectedNode.allow_skip}
                          onCheckedChange={(v) => patchNode(selectedNode.id, { allow_skip: v })}
                        />
                        Allow skip
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={selectedNode.allow_free_text}
                          onCheckedChange={(v) => patchNode(selectedNode.id, { allow_free_text: v })}
                        />
                        Allow a written note
                      </label>
                    </div>

                    <div className="space-y-2">
                      <Label>Next question by default</Label>
                      <p className="text-xs text-muted-foreground">
                        Used for Skip and for answers with no branch of their own. Only later
                        questions that no other question already leads to can be chosen.
                      </p>
                      <Select
                        value={selectedNode.default_next_node_id ?? AUTO_NEXT}
                        onValueChange={(v) =>
                          patchNode(selectedNode.id, {
                            default_next_node_id: v === AUTO_NEXT ? null : v,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUTO_NEXT}>
                            Continue in order (finish if this is the last question)
                          </SelectItem>
                          {availableTargets.map((n) => (
                            <SelectItem key={n.id} value={n.id}>
                              {n.prompt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {isDynamicSource(selectedNode.dynamic_source_table) ? (
                      <DynamicNodeEditor
                        node={selectedNode}
                        readOnly={readOnly}
                        onChange={(patch) => patchNode(selectedNode.id, patch)}
                      />
                    ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Answers</Label>
                        <Button size="sm" variant="outline" onClick={addOption} disabled={readOnly}>
                          <Plus className="mr-1 h-4 w-4" /> Add answer
                        </Button>
                      </div>

                      {selectedNode.options.map((option, index) => {
                        const patchOption = (patch: Record<string, unknown>) =>
                          patchNode(selectedNode.id, {
                            options: selectedNode.options.map((o, i) =>
                              i === index ? { ...o, ...patch } : o
                            ),
                          });
                        const weights = option.trait_weights ?? {};
                        return (
                          <div key={option.id} className="space-y-3 rounded-lg border border-border p-3">
                            <div className="flex gap-2">
                              <Input
                                value={option.label}
                                placeholder="Answer text"
                                readOnly={readOnly}
                                onChange={(e) => patchOption({ label: e.target.value })}
                              />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={readOnly}
                                    onClick={() => removeOption(option.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Remove option</TooltipContent>
                              </Tooltip>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-5">
                              {TRAIT_KEYS.map((trait) => (
                                <div key={trait} className="space-y-1">
                                  <Label className="text-[11px] text-muted-foreground">
                                    {TRAIT_LABELS[trait]}
                                  </Label>
                                  <Input
                                    type="number"
                                    className="h-8"
                                    value={Number(weights[trait] ?? 0)}
                                    onChange={(e) =>
                                      patchOption({
                                        trait_weights: {
                                          ...weights,
                                          [trait]: Number(e.target.value) || 0,
                                        },
                                      })
                                    }
                                  />
                                </div>
                              ))}
                            </div>

                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">
                                If chosen, go to
                              </Label>
                              <Select
                                value={option.next_node_id ?? AUTO_NEXT}
                                onValueChange={(v) =>
                                  patchOption({ next_node_id: v === AUTO_NEXT ? null : v })
                                }
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={AUTO_NEXT}>Follow the default</SelectItem>
                                  {availableTargets.map((n) => (
                                    <SelectItem key={n.id} value={n.id}>
                                      {n.prompt}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        );
                      })}
                      {selectedNode.options.length === 0 && (
                        <p className="text-sm text-muted-foreground">No answers yet.</p>
                      )}
                    </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-16 text-center text-sm text-muted-foreground">
                    Select a question to edit it.
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}