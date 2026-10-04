import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/**
 * Issue 2 Mode B (security plan §15): shows a one-time set-password / reset link ONCE to the staff
 * member who generated it. The link lives only in the caller's React state (passed in as a prop),
 * which every caller sets back to null in onClose; it is never put in the URL, localStorage,
 * sessionStorage, pending_notifications, or the console. Supabase links are single-use and expire
 * (the project's email-link expiry, Supabase default 1 hour).
 */
export function OneTimeLinkDialog({
  open, onClose, title, email, link, existingAccount = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  email: string | null;
  link: string | null;
  existingAccount?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); toast.success("Link copied"); }
    catch { toast.error("Copy failed. Select the link and copy it manually."); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {link
              ? "Send this to the person; it works once. It expires in 1 hour. It lets them choose their own password. It is shown only now and is not stored anywhere — closing this window discards it."
              : existingAccount
                ? "This email already has a CareMuch login, so it was connected as-is. They sign in with their current password, or use \"Forgot password?\"."
                : "Done."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {email && (
            <div>
              <span className="font-medium">Email: </span>
              <span className="text-muted-foreground">{email}</span>
            </div>
          )}
          {link && <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="One-time link" />}
        </div>
        <DialogFooter>
          {link && <Button variant="outline" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>}
          <Button onClick={() => { setCopied(false); onClose(); }}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
