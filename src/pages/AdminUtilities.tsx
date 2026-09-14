import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Download, Upload, Trash2, AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
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
import { Input } from "@/components/ui/input";

const AdminUtilities = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const guard = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      const { data: roleData } = await supabase.rpc("get_user_role", { _user_id: session.user.id });
      if (roleData !== "system_admin") {
        toast.error("Access denied. System admin role required.");
        navigate("/dashboard");
      }
    };
    guard();
  }, [navigate]);
  const [linking, setLinking] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBulkDeleteData = async () => {
    setLoading(true);
    setDeleteDialogOpen(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("Not authenticated");
      }

      // Delete data from all major tables in reverse dependency order
      const tables: string[] = [
        'shift_assignments',
        'shift_trades',
        'time_off_requests',
        'shifts',
        'client_orders',
        'caregiver_skills',
        'caregiver_availability',
        'caregiver_certifications',
        'client_care_needs',
      ];

      for (const table of tables) {
        const { error } = await supabase
          .from(table as any)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (error) {
          toast.error(`Error deleting from ${table}: ${error.message}`);
        }
      }

      toast.success("Test data deleted from all tables");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete data");
    } finally {
      setLoading(false);
    }
  };

  const handleResetDatabase = async () => {
    setLoading(true);
    setResetDialogOpen(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-database`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reset database");
      }

      const result = await response.json();
      
      toast.success(result.message);
    } catch (error: any) {
      toast.error(error.message || "Failed to reset database");
    } finally {
      setLoading(false);
    }
  };

  const handleExportData = async () => {
    setExportLoading(true);
    try {
      // Fetch data from all tables
      const tables: string[] = [
        'care_types',
        'care_needs',
        'caregivers',
        'caregiver_skills',
        'caregiver_availability',
        'caregiver_certifications',
        'clients',
        'client_care_needs',
        'client_orders',
        'shifts',
        'shift_assignments',
        'time_off_requests',
        'shift_trades',
      ];

      const exportData: any = {};

      for (const table of tables) {
        const { data, error } = await supabase
          .from(table as any)
          .select('*');

        if (error) {
          toast.error(`Error fetching ${table}: ${error.message}`);
          continue;
        }

        exportData[table] = data;
      }

      // Create and download JSON file
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `caremuch-data-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Data exported successfully");
    } catch (error: any) {
      toast.error(error.message || "Failed to export data");
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-data`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ data: importData }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import data");
      }

      const result = await response.json();
      
      toast.success(result.message);

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to import data");
    } finally {
      setImportLoading(false);
    }
  };

  const handleLinkExistingAccounts = async () => {
    setLinking(true);
    try {
      const { data, error } = await supabase.functions.invoke("link-existing-accounts", {});
      if (error) throw new Error((await (error as any)?.context?.text?.()) || error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(
        `Linked ${(data as any).caregiversLinked} caregiver(s) and ${(data as any).clientsLinked} client(s) to existing logins`
      );
    } catch (error: any) {
      toast.error(error.message || "Failed to link accounts");
    } finally {
      setLinking(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Admin Utilities</CardTitle>
            <CardDescription>
              Administrative tools for managing sample data and system operations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Link existing records to logins */}
            <div className="border-b pb-6">
              <h3 className="text-lg font-semibold mb-2">Link Records to Existing Logins</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Matches caregivers and clients that have no login yet to existing accounts with the
                same email address, and assigns the matching role. No new accounts are created and no
                emails are sent.
              </p>
              <div className="flex gap-2">
                <Button onClick={handleLinkExistingAccounts} disabled={linking}>
                  {linking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Link Existing Accounts
                </Button>
                <Button variant="outline" onClick={() => navigate("/notifications-outbox")}>
                  Open Notification Outbox
                </Button>
              </div>
            </div>

            {/* Data Export/Import */}
            <div className="border-b pb-6">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Download className="h-5 w-5" />
                Data Export & Import
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Export all data to a JSON file for backup, or import data from a previously exported file.
              </p>
              <div className="flex gap-4">
                <Button 
                  onClick={handleExportData} 
                  disabled={exportLoading}
                  variant="outline"
                >
                  {exportLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Download className="mr-2 h-4 w-4" />
                  Export Data
                </Button>
                <div>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportData}
                    className="hidden"
                    id="import-file"
                    disabled={importLoading}
                  />
                  <Button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importLoading}
                    variant="outline"
                  >
                    {importLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Upload className="mr-2 h-4 w-4" />
                    Import Data
                  </Button>
                </div>
              </div>
            </div>

            {/* Bulk Delete */}
            <div className="border-b pb-6">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-orange-600">
                <Trash2 className="h-5 w-5" />
                Bulk Delete Test Data
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Remove all test data from shifts, assignments, orders, and related tables. This will NOT delete 
                caregivers, clients, care types, or user accounts.
              </p>
              <Button 
                onClick={() => setDeleteDialogOpen(true)}
                disabled={loading}
                variant="destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Test Data
              </Button>
            </div>

            {/* Reset Database */}
            <div>
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Reset Database
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                <strong className="text-red-600">DANGER:</strong> This will completely wipe all data from all tables 
                including caregivers, clients, shifts, orders, and user accounts. This action cannot be undone.
              </p>
              <Button 
                onClick={() => setResetDialogOpen(true)}
                disabled={loading}
                variant="destructive"
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Reset Entire Database
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete all test data including shifts, assignments, orders, and related records.
                Caregivers, clients, care types, and user accounts will be preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleBulkDeleteData}>
                Delete Test Data
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset Confirmation Dialog */}
        <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-600">
                ⚠️ DANGER: Complete Database Reset
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete ALL data from the database including:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>All caregivers and their profiles</li>
                  <li>All clients and their information</li>
                  <li>All shifts and assignments</li>
                  <li>All orders and care records</li>
                  <li>All user accounts (except system admin)</li>
                </ul>
                <p className="mt-3 font-bold text-red-600">
                  This action CANNOT be undone!
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleResetDatabase}
                className="bg-red-600 hover:bg-red-700"
              >
                Yes, Reset Everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
};

export default AdminUtilities;
