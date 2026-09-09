import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Search, Eye, Trash2, Pencil, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { AppLayout } from "@/components/AppLayout";
import { careTypeFormSchema } from "@/lib/validation";
import { ManageCategoriesDialog } from "@/components/care-types/ManageCategoriesDialog";

interface CareTypesProps {
  openCategoriesOnLoad?: boolean;
}

const CareTypes = ({ openCategoriesOnLoad = false }: CareTypesProps) => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedCareType, setSelectedCareType] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewCareType, setViewCareType] = useState<any>(null);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [formData, setFormData] = useState({
    code: "",
    category: "",
    name: "",
    description: "",
    keywords: "",
    price: "",
    duration: "4",
  });

  useEffect(() => {
    if (openCategoriesOnLoad) {
      setIsCategoriesOpen(true);
    }
  }, [openCategoriesOnLoad]);

  const { data: careTypes, isLoading } = useQuery({
    queryKey: ["care-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("care_types")
        .select("*")
        .order("code");
      
      if (error) throw error;
      return data;
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["care-service-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("care_service_categories" as never)
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const handleEdit = (careType: any) => {
    setSelectedCareType(careType);
    setFormData({
      code: careType.code,
      category: careType.category_id || careType.category,
      name: careType.name,
      description: careType.description || "",
      keywords: careType.keywords || "",
      price: careType.price?.toString() || "35.00",
      duration: careType.duration_hours?.toString() || "4",
    });
    setIsDialogOpen(true);
  };

  const handleView = (careType: any) => {
    setViewCareType(careType);
  };

  const handleDelete = async (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;

    try {
      const { error } = await supabase
        .from("care_types")
        .delete()
        .eq("id", deleteId);

      if (error) {
        if (error.code === "23503" || /foreign key/i.test(error.message)) {
          toast.error(
            "This care service is already used by shifts, caregiver skills or client care needs, so it can't be deleted. Edit it instead, or mark it inactive to hide it from new bookings."
          );
        } else {
          toast.error("Could not delete this care service. Please try again.");
        }
        return;
      }

      toast.success("Care type deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["care-types"] });
    } catch {
      toast.error("Could not delete this care service. Please try again.");
    } finally {
      setDeleteId(null);
    }
  };

  const handleSave = async () => {
    try {
      // Validate form data
      const validation = careTypeFormSchema.safeParse(formData);
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        return;
      }

      const priceValue = parseFloat(formData.price);
      const durationValue = parseFloat(formData.duration);

      if (selectedCareType) {
        const selectedCategory = (categories || []).find((cat: any) => cat.id === formData.category);
        const { error } = await supabase
          .from("care_types")
          .update({
            category_id: selectedCategory?.id || null,
            category: selectedCategory?.name || formData.category,
            name: formData.name,
            description: formData.description,
            keywords: formData.keywords,
            price: priceValue,
            duration_hours: durationValue,
          })
          .eq("id", selectedCareType.id);

        if (error) throw error;
        toast.success("Care service updated successfully");
      } else {
        const selectedCategory = (categories || []).find((cat: any) => cat.id === formData.category);
        const { error } = await supabase
          .from("care_types")
          .insert({
            code: formData.code,
            category_id: selectedCategory?.id || null,
            category: selectedCategory?.name || formData.category,
            name: formData.name,
            description: formData.description,
            keywords: formData.keywords,
            price: priceValue,
            duration_hours: durationValue,
          });

        if (error) throw error;
        toast.success("Care service created successfully");
      }
      
      queryClient.invalidateQueries({ queryKey: ["care-types"] });
      setIsDialogOpen(false);
      setSelectedCareType(null);
      setFormData({ code: "", category: "", name: "", description: "", keywords: "", price: "", duration: "4" });
    } catch (error: any) {
      toast.error(error.message || "Failed to save care service");
    }
  };

  const filteredCareTypes = careTypes?.filter(careType => {
    const matchesSearch = searchQuery === "" ||
      careType.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      careType.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      careType.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      careType.keywords?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = filterStatus === "all" || 
      (filterStatus === "active" && careType.is_active) ||
      (filterStatus === "inactive" && !careType.is_active);

    return matchesSearch && matchesStatus;
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">Loading care services...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-bold mb-2">Care Services</h2>
          <p className="text-muted-foreground">Manage standardized care service catalog</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setIsCategoriesOpen(true)}>
            <Tags className="h-4 w-4" />
            Manage Categories
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              setSelectedCareType(null);
              setFormData({ code: "", category: "", name: "", description: "", keywords: "", price: "35.00", duration: "4" });
              setIsDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Care Service
          </Button>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, code, description or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Includes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCareTypes?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No care services found
                  </TableCell>
                </TableRow>
              ) : (
                filteredCareTypes?.map((careType) => (
                  <TableRow key={careType.id}>
                    <TableCell className="font-medium">{careType.code}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{careType.category}</Badge>
                    </TableCell>
                    <TableCell>{careType.name}</TableCell>
                    <TableCell>
                      <span className="font-semibold text-primary">${careType.price?.toFixed(2) || '35.00'}</span>
                      <span className="text-xs text-muted-foreground">/hr</span>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{careType.description || "-"}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground text-sm">{careType.keywords || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={careType.is_active ? "default" : "secondary"}>
                        {careType.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleView(careType)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(careType)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(careType.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{selectedCareType ? "Edit Care Service" : "Add New Care Service"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g., CS001"
                  disabled={!!selectedCareType}
                />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories || []).map((cat: any) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="name">Service Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter service name"
                />
              </div>
              <div>
                <Label htmlFor="price">Hourly Rate ($)</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  placeholder="35.00"
                />
              </div>
              <div>
                <Label htmlFor="duration">Duration (hours)</Label>
                <Input
                  id="duration"
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={formData.duration}
                  onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                  placeholder="4"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Enter description"
                />
              </div>
              <div>
                <Label htmlFor="keywords">Includes (what's covered)</Label>
                <Textarea
                  id="keywords"
                  value={formData.keywords}
                  onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                  placeholder="e.g., Showering, hair care, shaving, choosing clothes, getting dressed"
                  rows={3}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {selectedCareType ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewCareType} onOpenChange={() => setViewCareType(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Care Service Details</DialogTitle>
          </DialogHeader>
          {viewCareType && (
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Code</Label>
                <p className="text-lg font-medium">{viewCareType.code}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Category</Label>
                <div className="mt-1">
                  <Badge variant="outline">{viewCareType.category}</Badge>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Service Name</Label>
                <p className="text-lg font-medium">{viewCareType.name}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Hourly Rate</Label>
                <p className="text-lg font-semibold text-primary">
                  ${viewCareType.price?.toFixed(2) || '35.00'}/hr
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p>{viewCareType.description || "-"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Includes</Label>
                <p className="text-sm">{viewCareType.keywords || "-"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <div className="mt-1">
                  <Badge variant={viewCareType.is_active ? "default" : "secondary"}>
                    {viewCareType.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Care Service</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this care service? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ManageCategoriesDialog open={isCategoriesOpen} onOpenChange={setIsCategoriesOpen} />
      </div>
    </AppLayout>
  );
};

export default CareTypes;