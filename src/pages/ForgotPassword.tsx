import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { emailSchema } from "@/lib/validation";

/**
 * Public "Forgot password?" screen (security plan §15). Supabase Auth sends its own recovery
 * email; the link lands on /auth/set-password. The same confirmation is shown whether or not the
 * address has an account, so the page can't be used to discover who is registered.
 * Note: on the project's built-in mailer, emails are only delivered to the Supabase project's
 * team addresses and are heavily rate-limited — real delivery needs custom SMTP (Mode A).
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) { setError(parsed.error.errors[0].message); return; }
    setError(null);
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${window.location.origin}/auth/set-password` });
    } catch {
      /* same response either way */
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Forgot your password?</CardTitle>
          <CardDescription>Enter your email and we'll send you a link to choose a new password.</CardDescription>
        </CardHeader>
        {sent ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              If an account exists for that email, a reset link is on its way. It works once and expires.
              If nothing arrives, contact your office.
            </p>
          </CardContent>
        ) : (
          <form onSubmit={submit}>
            <CardContent className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Sending..." : "Send reset link"}</Button>
            </CardFooter>
          </form>
        )}
        <CardFooter className="justify-center">
          <Link to="/auth" className="text-sm text-muted-foreground hover:underline">Back to sign in</Link>
        </CardFooter>
      </Card>
    </div>
  );
}
