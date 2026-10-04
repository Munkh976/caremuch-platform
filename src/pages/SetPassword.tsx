import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { passwordSchema } from "@/lib/validation";
import { roleHome } from "@/lib/roleHome";
import { arrivedViaPasswordLink } from "@/components/auth/AuthLinkRouter";
import { toast } from "sonner";

/**
 * Public landing page for one-time links (security plan §15): staff-generated invite / reset links
 * (Mode B) and Supabase recovery emails ("Forgot password?"). The link signs the person in with a
 * short-lived session; here they choose their own password (8–72 chars, validation.ts), then go to
 * their role's home. Without a session (expired / already-used link) it says so instead.
 */
export default function SetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "ok" | "nosession">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    // Owner point D: this page only works for a session that came from a one-time invite/recovery
    // link in this page load — an ordinary signed-in session can't use it to change the password.
    const settle = (ok: boolean) => { if (!done) { done = true; setReady(ok && arrivedViaPasswordLink() ? "ok" : "nosession"); } };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) settle(true);
    });
    // The link's tokens are processed asynchronously; give it a moment before deciding.
    const t = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      settle(!!session);
    }, 1500);
    return () => { clearTimeout(t); subscription.unsubscribe(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) { setError(parsed.error.errors[0].message); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setError(null);
    setSaving(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw upErr;
      toast.success("Your password is set");
      const { data: { user } } = await supabase.auth.getUser();
      const { data: role } = user ? await supabase.rpc("get_user_role", { _user_id: user.id }) : { data: null };
      navigate(roleHome(role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose your password</CardTitle>
          <CardDescription>Set the password you'll use to sign in to CareMuch.</CardDescription>
        </CardHeader>
        {ready === "checking" && <CardContent><p className="text-sm text-muted-foreground">Checking your link...</p></CardContent>}
        {ready === "nosession" && (
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This link is invalid, has already been used, or has expired. Ask your office for a new link,
              or use "Forgot password?" on the sign-in page.
            </p>
            <Link to="/auth/forgot" className="text-sm hover:underline">Forgot password?</Link>
          </CardContent>
        )}
        {ready === "ok" && (
          <form onSubmit={submit}>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <p className="text-xs text-muted-foreground">At least 8 characters.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? "Saving..." : "Set password"}</Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
