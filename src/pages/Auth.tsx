import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Activity, Sparkles, ArrowLeft, MessageCircle } from "lucide-react";
import { signInSchema, signUpSchema, firstError } from "@/lib/validation";
import { roleHome, safeNextPath } from "@/lib/roleHome";

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawNext = searchParams.get("next");
  // safeNextPath also rejects a backslash form like "/\example.com" (browsers treat it as
  // "//example.com") — that was an open redirect.
  const nextPath = safeNextPath(rawNext);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [agencyName, setAgencyName] = useState("");

  const routeByRole = async (userId: string) => {
    if (nextPath) {
      window.location.href = nextPath;
      return;
    }
    const { data } = await supabase.rpc('get_user_role', { _user_id: userId });
    // One role -> home mapping, shared with RequireRole (src/lib/roleHome.ts).
    if (data) {
      navigate(roleHome(data));
    } else {
      toast.info('Your account is pending approval. Please wait for a manager to approve your registration.');
      navigate('/auth');
    }
  };

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        routeByRole(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        routeByRole(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = signUpSchema.safeParse({ email, password, fullName, agencyName });
    if (!parsed.success) {
      toast.error(firstError(parsed));
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          data: {
            full_name: parsed.data.fullName,
            agency_name: parsed.data.agencyName ?? "",
          },
          emailRedirectTo: `${window.location.origin}${nextPath ?? "/dashboard"}`,
        },
      });

      if (error) throw error;

      toast.success("Account created successfully! Please check your email.");
    } catch (error: any) {
      toast.error(error.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(firstError(parsed));
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error) throw error;

      toast.success("Welcome back!");
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await routeByRole(session.user.id);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/5 p-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/assistant")}>
            <MessageCircle className="h-4 w-4" />
            Talk to our assistant
          </Button>
        </div>
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-accent">
              <Activity className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-2">
            CareMuch
          </h1>
          <p className="text-muted-foreground">Intelligent Healthcare Workforce Scheduling</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-1 mb-4">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="you@agency.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                  <div className="text-center">
                    <Link to="/auth/forgot" className="text-sm text-muted-foreground hover:underline">Forgot password?</Link>
                  </div>
                </form>
              </TabsContent>

            </Tabs>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 text-center text-sm text-muted-foreground">
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <span>Powered by AI-driven scheduling optimization</span>
            </div>
            <div className="pt-2 border-t space-y-2">
              <p className="mb-2 text-muted-foreground">New to CareMuch?</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate("/caregiver-registration")}
              >
                Register as Caregiver
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default Auth;