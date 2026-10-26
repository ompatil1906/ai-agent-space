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
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Reveal } from "@/components/reveal";
import { api, messageFromError, setToken } from "@/lib/api";

interface LoginResponse {
  access_token: string;
}

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setError("");

    if (password.length < 8) {
      setPasswordError("Use at least 8 characters — a passphrase works best.");
      return;
    }

    setPending(true);

    try {
      await api("/auth/register", {
        method: "POST",
        body: { email: email.trim(), password, full_name: fullName },
      });

      // Auto-login so the user lands in their workspace immediately.
      const loginForm = new FormData();
      loginForm.append("username", email.trim());
      loginForm.append("password", password);
      try {
        const login = await api<LoginResponse>("/auth/login", {
          method: "POST",
          form: loginForm,
        });
        setToken(login.access_token);
        window.location.href = "/agents";
        return;
      } catch {
        setError("Account created — auto sign-in failed. Redirecting you to the login page…");
        setTimeout(() => (window.location.href = "/login"), 1500);
        return;
      }
    } catch (err) {
      setError(messageFromError(err));
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Reveal>
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Link
              href="/"
              aria-label="AI Agent Space home"
              className="flex size-12 items-center justify-center rounded-2xl bg-card p-2 shadow-sm ring-1 ring-foreground/10 transition-colors hover:ring-foreground/25"
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
              <h1 className="text-xl font-medium tracking-tight">
                Create your workspace
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Start building agents in minutes
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <Card>
            <CardContent>
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="register-name">Full name</Label>
                  <Input
                    id="register-name"
                    placeholder="e.g. Om Patil"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
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
                  <Label htmlFor="register-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="register-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Your password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={pending}
                      required
                      aria-invalid={Boolean(passwordError) || undefined}
                      aria-describedby={passwordError ? "register-password-error" : undefined}
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
                  {passwordError ? (
                    <p id="register-password-error" role="alert" className="text-xs text-destructive">
                      {passwordError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Minimum 8 characters — a passphrase works best.
                    </p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? (
                    <>
                      <Loader2Icon className="animate-spin" /> Creating account…
                    </>
                  ) : (
                    "Create account"
                  )}
                </Button>
              </form>
              {error && (
                <Alert variant="destructive" className="mt-4">
                  <CircleAlertIcon />
                  <AlertTitle>Registration failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="justify-between gap-2 border-t-0 bg-transparent">
              <p className="text-sm text-muted-foreground">Already registered?</p>
              <Button variant="outline" size="sm" render={<Link href="/login" />}>
                Log in
              </Button>
            </CardFooter>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
