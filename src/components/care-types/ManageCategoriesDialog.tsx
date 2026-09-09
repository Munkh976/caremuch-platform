import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ManageCategoriesDialog = ({ open, onOpenChange }: Props) => {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrefix, setEditPrefix] = useState("");

  const { data: categories, isLoading } = useQuery({
    queryKey: ["care-service-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("care_service_categories" as never)
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["care-service-categories"] });
    queryClient.invalidateQueries({ queryKey: ["care-types"] });
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (name.length < 2) {
      toast.error("Category name must be at least 2 characters");
      return;
    }
    const { error } = await supabase
      .from("care_service_categories" as never)
      .insert({ name, code_prefix: newPrefix.trim().toUpperCase() || null } as never);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "That category already exists."
          : "Could not add the category. You may not have permission."
      );
      return;
    }
    setNewName("");
    setNewPrefix("");
    toast.success("Category added");
    refresh();
  };

  const startEdit = (cat: any) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditPrefix(cat.code_prefix || "");
  };

  const handleSaveEdit = async (cat: any) => {
    const name = editName.trim();
    if (name.length < 2) {
      toast.error("Category name must be at least 2 characters");
      return;
    }
    const { error } = await supabase
      .from("care_service_categories" as never)
      .update({ name, code_prefix: editPrefix.trim().toUpperCase() || null } as never)
      .eq("id", cat.id);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Another category already uses that name."
          : "Could not update the category. You may not have permission."
      );
      return;
    }
    // Keep services in sync with the renamed category
    if (name !== cat.name) {
      await supabase.from("care_types").update({ category: name }).eq("category", cat.name);
    }
    setEditingId(null);
    toast.success("Category updated");
    refresh();
  };

  const handleDelete = async (cat: any) => {
    const { count } = await supabase
      .from("care_types")
      .select("id", { count: "exact", head: true })
      .eq("category", cat.name);
    if (count && count > 0) {
      toast.error(
        `"${cat.name}" is used by ${count} care service${count === 1 ? "" : "s"}. Move those services to another category first.`
      );
      return;
    }
    const { error } = await supabase
      .from("care_service_categories" as never)
      .delete()
      .eq("id", cat.id);
    if (error) {
      toast.error("Could not delete the category. You may not have permission.");
      return;
    }
    toast.success("Category deleted");
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
          <DialogDescription>
            Categories group your care services. Renaming one updates every service that uses it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr,120px,auto] items-end">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">New category</Label>
            <Input
              id="cat-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., Respite Care"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-prefix">Code prefix</Label>
            <Input
              id="cat-prefix"
              value={newPrefix}
              onChange={(e) => setNewPrefix(e.target.value)}
              placeholder="RSP"
            />
          </div>
          <Button onClick={handleAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="max-h-[320px] overflow-y-auto rounded-md border divide-y">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading categories...</p>
          ) : categories?.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No categories yet.</p>
          ) : (
            categories?.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 p-3">
                {editingId === cat.id ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      value={editPrefix}
                      onChange={(e) => setEditPrefix(e.target.value)}
                      className="w-24"
                      placeholder="Prefix"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" onClick={() => handleSaveEdit(cat)}>
                          <Check className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Save</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Cancel</TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{cat.name}</span>
                    {cat.code_prefix && <Badge variant="outline">{cat.code_prefix}</Badge>}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(cat)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(cat)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};