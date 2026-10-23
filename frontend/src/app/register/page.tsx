"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { API_BASE } from "@/lib/api";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, full_name: fullName }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Registered! Signing you in...");
        // auto-login so the user lands in their workspace immediately
        const loginForm = new FormData();
        loginForm.append("username", email.trim());
        loginForm.append("password", password);
        const login = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          body: loginForm,
        });
        if (login.ok) {
          localStorage.setItem("token", (await login.json()).access_token);
          window.location.href = "/agents";
          return;
        }
        setMessage("Registered successfully! Please login.");
        setTimeout(() => (window.location.href = "/login"), 1500);
      } else {
        setMessage(data.detail || "Registration failed");
      }
    } catch (err) {
      setMessage("Network error — is the backend running?");
    }
  };

  return (
    <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(50%_100%_at_50%_0%,rgb(255_255_255/6%),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Link
            href="/"
            className="flex size-12 items-center justify-center rounded-2xl border border-border/80 bg-zinc-950 p-2 shadow-md transition-all hover:border-foreground/30 hover:scale-105"
          >
            <Image
              src="/logos/icon.svg"
              alt="AI Agent Space"
              width={32}
              height={32}
              className="size-8 rounded-sm object-contain"
              priority
            />
          </Link>
          <div>
            <h1 className="text-xl font-medium tracking-tight">
              Create your workspace
            </h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              start building agents in minutes
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">
              Create Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <Input
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="Password (min 8 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <Button type="submit" className="w-full">
                Register
              </Button>
            </form>
            {message && (
              <p className="mt-4 font-mono text-xs text-muted-foreground">
                {message}
              </p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              Already have an account?{" "}
              <a href="/login" className="text-foreground underline underline-offset-4">
                Login
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
