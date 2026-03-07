"use client";

import { FormEvent, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase/client";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Use email/password or Google to authenticate with Supabase.");
  const configReady = hasSupabaseConfig();

  const onSignIn = async (event: FormEvent) => {
    event.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable auth.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error ? error.message : "Signed in successfully.");
  };

  const onSignUp = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable auth.");
      return;
    }
    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(error ? error.message : "Sign-up complete. Check your inbox for verification.");
  };

  const onGoogle = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable auth.");
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
      },
    });
    setMessage(error ? error.message : "Redirecting to Google...");
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">RipSense Authentication</CardTitle>
          <CardDescription>Secure access for private pack logs and analytics.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[--accent-blue]" />
              {configReady ? "Supabase config detected." : "Supabase environment variables not set yet."}
            </p>
          </div>

          <form onSubmit={onSignIn} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="collector@ripsense.app"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full">
              <Mail className="mr-2 h-4 w-4" />
              Sign in
            </Button>
          </form>

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onSignUp}>
              Create account
            </Button>
            <Button variant="gold" className="flex-1" onClick={onGoogle}>
              Continue with Google
            </Button>
          </div>

          <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
