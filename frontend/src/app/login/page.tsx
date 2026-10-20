"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { API_BASE } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("username", email);
    formData.append("password", password);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("token", data.access_token);
        setMessage("Logged in! Redirecting...");
        window.location.href = "/agents";
      } else {
        setMessage(data.detail || "Login failed");
      }
    } catch (err) {
      setMessage("Network error");
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
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-base leading-none font-medium">
            /
          </span>
          <div>
            <h1 className="text-xl font-medium tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              sign in to your agent workspace
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">
              Log in to AI Agent Space
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button type="submit" className="w-full">
                Log in
              </Button>
            </form>
            {message && (
              <p className="mt-4 font-mono text-xs text-muted-foreground">
                {message}
              </p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              No account?{" "}
              <a href="/register" className="text-foreground underline underline-offset-4">
                Register
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
