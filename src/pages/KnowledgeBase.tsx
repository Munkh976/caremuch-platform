import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, CloudUpload, CloudOff, Trash2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface KnowledgeDocument {
  id: string;
  title: string;
  surface: string;
  language: string;
  is_active: boolean;
  ingestion_status: string;
  ingestion_error: string | null;
  is_demo: boolean;
  created_at: string;
}

type SurfaceFilter = "all" | "public" | "caregiver";
type LanguageFilter = "all" | "en" | "es";
type StatusFilter = "all" | "published" | "staged";

const INGESTION_STATUS_LABELS: Record<string, string> = {
  ready: "Ready",
  failed: "Failed",
  pending: "Pending",
  extracting: "Extracting",
  chunking: "Chunking",
  embedding: "Embedding",
};

const KnowledgeBase = () => {
  const navigate = useNavigate();
  const { userRole, hasPermission } = usePermissions();
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [chunkCounts, setChunkCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("all");
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [publishTarget, setPublishTarget] = useState<KnowledgeDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocument | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Same role-allowlist + role_permissions-check pattern as CaregiverApprovals.tsx's
  // canApprove -- matches ingest-knowledge-document's own ALLOWED_ROLES, since the
  // person who can upload should be the person who can publish/unpublish/delete it.
  const canManage =
    !!userRole &&
    ["system_admin", "agency_admin", "manager"].includes(userRole) &&
    hasPermission("knowledge_base", "update");

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileData?.agency_id) {
        setAgencyId(profileData.agency_id);
        fetchDocuments(profileData.agency_id);
      } else {
        setLoading(false);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate("/auth");
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const fetchDocuments = async (agency: string) => {
    setLoading(true);
    try {
      // RLS already scopes this to the caller's own agency (is_agency_staff() AND
      // agency_id = current_agency_id()) -- the explicit .eq() here is
      // defense-in-depth, not the only barrier, matching the project's existing
      // style elsewhere (e.g. order_services/shift_assignments layer both too).
      const { data: docs, error: docsError } = await supabase
        .from("knowledge_documents")
        .select("id, title, surface, language, is_active, ingestion_status, ingestion_error, is_demo, created_at")
        .eq("agency_id", agency)
        .order("created_at", { ascending: false });

      if (docsError) throw docsError;
      setDocuments((docs ?? []) as KnowledgeDocument[]);

      const docIds = (docs ?? []).map((d) => d.id);
      if (docIds.length > 0) {
        const { data: chunks, error: chunksError } = await supabase
          .from("knowledge_chunks")
          .select("document_id")
          .in("document_id", docIds);
        if (chunksError) throw chunksError;
        const counts: Record<string, number> = {};
        for (const c of chunks ?? []) {
          counts[c.document_id] = (counts[c.document_id] ?? 0) + 1;
        }
        setChunkCounts(counts);
      } else {
        setChunkCounts({});
      }
    } catch (error: any) {
      console.error("Error fetching knowledge documents:", error);
      toast.error(error.message || "Failed to load knowledge documents");
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    if (agencyId) fetchDocuments(agencyId);
  };

  const handlePublishClick = (doc: KnowledgeDocument) => {
    if (doc.surface === "public") {
      setPublishTarget(doc);
    } else {
      void doPublish(doc);
    }
  };

  const doPublish = async (doc: KnowledgeDocument) => {
    setActioningId(doc.id);
    try {
      const { error } = await supabase
        .from("knowledge_documents")
        .update({ is_active: true })
        .eq("id", doc.id);
      if (error) throw error;
      toast.success(`Published "${doc.title}"`);
      refresh();
    } catch (error: any) {
      toast.error(error.message || "Failed to publish document");
    } finally {
      setActioningId(null);
      setPublishTarget(null);
    }
  };

  const handleUnpublish = async (doc: KnowledgeDocument) => {
    setActioningId(doc.id);
    try {
      const { error } = await supabase
        .from("knowledge_documents")
        .update({ is_active: false })
        .eq("id", doc.id);
      if (error) throw error;
      toast.success(`Unpublished "${doc.title}"`);
      refresh();
    } catch (error: any) {
      toast.error(error.message || "Failed to unpublish document");
    } finally {
      setActioningId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActioningId(deleteTarget.id);
    try {
      // Single statement -- knowledge_chunks has ON DELETE CASCADE on its composite
      // FK to knowledge_documents (document_id, language), confirmed in the
      // 20260902120000 migration. No separate chunk-delete step needed.
      const { error } = await supabase
        .from("knowledge_documents")
        .delete()
        .eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success(`Deleted "${deleteTarget.title}"`);
      refresh();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete document");
    } finally {
      setActioningId(null);
      setDeleteTarget(null);
    }
  };

  const filtered = documents.filter((doc) => {
    if (surfaceFilter !== "all" && doc.surface !== surfaceFilter) return false;
    if (languageFilter !== "all" && doc.language !== languageFilter) return false;
    if (statusFilter === "published" && !doc.is_active) return false;
    if (statusFilter === "staged" && doc.is_active) return false;
    return true;
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">
            Manage your agency's knowledge documents -- publish staged documents, unpublish live ones, or delete
            documents you no longer need. To add or change content, use the document ingestion tool in Agency
            Settings -- editing here is not available; re-upload to change title, surface, or content.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Narrow the list by surface, language, or publish status.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Surface</label>
              <Select value={surfaceFilter} onValueChange={(v) => setSurfaceFilter(v as SurfaceFilter)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All surfaces</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="caregiver">Caregiver</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Language</label>
              <Select value={languageFilter} onValueChange={(v) => setLanguageFilter(v as LanguageFilter)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All languages</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="staged">Staged</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No knowledge documents match these filters.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Surface</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ingestion</TableHead>
                    <TableHead>Chunks</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((doc) => {
                    const isFailed = doc.ingestion_status === "failed";
                    return (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {doc.title}
                            {doc.is_demo && <Badge variant="outline">Demo</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={doc.surface === "public" ? "default" : "secondary"}>
                            {doc.surface === "public" ? "Public" : "Caregiver"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{doc.language.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={doc.is_active ? "default" : "secondary"}>
                            {doc.is_active ? "Published" : "Staged"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant={isFailed ? "destructive" : doc.ingestion_status === "ready" ? "outline" : "secondary"}>
                                {INGESTION_STATUS_LABELS[doc.ingestion_status] ?? doc.ingestion_status}
                              </Badge>
                            </TooltipTrigger>
                            {isFailed && doc.ingestion_error && (
                              <TooltipContent>{doc.ingestion_error}</TooltipContent>
                            )}
                          </Tooltip>
                        </TableCell>
                        <TableCell>{chunkCounts[doc.id] ?? 0}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage ? (
                            <div className="flex justify-end gap-2">
                              {doc.is_active ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={actioningId === doc.id}
                                      onClick={() => handleUnpublish(doc)}
                                    >
                                      <CloudOff className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Unpublish</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={actioningId === doc.id || doc.ingestion_status !== "ready"}
                                      onClick={() => handlePublishClick(doc)}
                                    >
                                      <CloudUpload className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {doc.ingestion_status !== "ready" ? "Only ready documents can be published" : "Publish"}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={actioningId === doc.id}
                                    onClick={() => setDeleteTarget(doc)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
                              </Tooltip>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">View only</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Publish confirmation -- only shown for public-surface documents, since
          publishing one makes it immediately visible to anonymous visitors. */}
      <AlertDialog open={!!publishTarget} onOpenChange={(open) => !open && setPublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish to your public page?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make "{publishTarget?.title}" visible to anonymous visitors on your public page
              immediately. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => publishTarget && doPublish(publishTarget)}>
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteTarget?.title}" and its {deleteTarget ? chunkCounts[deleteTarget.id] ?? 0 : 0} chunks?
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default KnowledgeBase;
