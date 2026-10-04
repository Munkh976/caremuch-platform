import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Inbox } from "lucide-react";

interface NotificationRow {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  kind: string;
  subject: string;
  body: string;
  sent_at: string | null;
  created_at: string;
}

const kindLabels: Record<string, string> = {
  caregiver_approved: "Caregiver approved",
  caregiver_rejected: "Caregiver rejected",
  client_login_created: "Client login created",
  caregiver_login_created: "Caregiver login created",
};

const NotificationsOutbox = () => {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = async () => {
    const { data, error } = await supabase
      .from("pending_notifications")
      .select("id, recipient_email, recipient_name, kind, subject, body, sent_at, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
    } else {
      setRows((data as NotificationRow[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const markSent = async (id: string) => {
    const { error } = await supabase
      .from("pending_notifications")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marked as delivered");
    fetchRows();
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Notification Outbox</h1>
          <p className="text-muted-foreground">
            Messages the system would email once a mail server is connected. Nothing is sent yet —
            deliver these details to the recipient directly.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending messages</CardTitle>
            <CardDescription>Approval notices and new login details</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-muted-foreground">
                <Inbox className="h-10 w-10 mb-3" />
                <p>No messages recorded yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(row.created_at), "MMM d, yyyy HH:mm")}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{row.recipient_name ?? "-"}</div>
                        <div className="text-xs text-muted-foreground">{row.recipient_email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{kindLabels[row.kind] ?? row.kind}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="text-sm font-medium">{row.subject}</div>
                        <div className="text-xs text-muted-foreground">{row.body}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.sent_at ? "default" : "secondary"}>
                          {row.sent_at ? "Delivered" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!row.sent_at && (
                          <Button variant="outline" size="sm" onClick={() => markSent(row.id)}>
                            Mark delivered
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default NotificationsOutbox;
