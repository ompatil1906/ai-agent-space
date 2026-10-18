"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

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
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-[400px]">
        <CardHeader>
          <CardTitle>Login to AI Agent Space</CardTitle>
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
              Login
            </Button>
          </form>
          {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
          <p className="mt-4 text-sm">
            No account? <a href="/register" className="underline">Register</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
