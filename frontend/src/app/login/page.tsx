"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { CircleAlertIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Reveal } from "@/components/reveal";
import { api, messageFromError, setToken } from "@/lib/api";

interface LoginResponse {
  access_token: string;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError("");

    // OAuth2 password flow — multipart form, `username` carries the email.
    const formData = new FormData();
    formData.append("username", email.trim());
    formData.append("password", password);

    try {
      const data = await api<LoginResponse>("/auth/login", {
        method: "POST",
        form: formData,
      });
      setToken(data.access_token);
      window.location.href = "/agents";
    } catch (err) {
      setError(messageFromError(err));
      setPending(false);
    }
  };

  return (
    <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(50%_100%_at_50%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm">
        <Reveal>
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Link
              href="/"
              aria-label="AI Agent Space home"
              className="flex size-12 items-center justify-center rounded-2xl bg-card p-2 shadow-md ring-1 ring-foreground/10 transition-all hover:scale-105 hover:ring-foreground/25"
            >
              <Image
                src="/logos/icon.svg"
                alt="AI Agent Space"
                width={32}
                height={32}
                className="size-8 rounded-sm object-contain"
                preload
              />
            </Link>
            <div>
              <h1 className="text-xl font-medium tracking-tight">Welcome back</h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                sign in to your agent workspace
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle>Log in to AI Agent Space</CardTitle>
              <CardDescription>
                Same email and password you registered with.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Your password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={pending}
                      required
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {showPassword ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? (
                    <>
                      <Loader2Icon className="animate-spin" /> Signing in…
                    </>
                  ) : (
                    "Log in"
                  )}
                </Button>
              </form>
              {error && (
                <Alert variant="destructive" className="mt-4">
                  <CircleAlertIcon />
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <p className="text-sm text-muted-foreground">No account yet?</p>
              <Button
                variant="outline"
                size="sm"
                render={<Link href="/register" />}
              >
                Create an account
              </Button>
            </CardFooter>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
