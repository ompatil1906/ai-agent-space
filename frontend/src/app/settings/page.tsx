"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { McpLogo } from "@/components/McpLogo";
import { API_BASE } from "@/lib/api";

interface ProviderKey {
  id: number;
  provider: string;
  label: string | null;
  base_url: string | null;
  api_key_masked: string;
  created_at: string;
}

const PROVIDERS: { value: string; label: string; color: string; hint: string }[] = [
  { value: "gemini", label: "Google Gemini", color: "#4285F4", hint: "Powers every agent by default via the platform key" },
  { value: "openai", label: "OpenAI", color: "#10a37f", hint: "Use GPT-4o / GPT-4o mini models with your key" },
  { value: "anthropic", label: "Anthropic", color: "#cc785c", hint: "Use Claude models with your key" },
  { value: "custom", label: "Custom / OpenAI-compatible", color: "#6366f1", hint: "Ollama, LM Studio, vLLM, or any OpenAI-compatible endpoint" },
];

export default function SettingsPage() {
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const [provider, setProvider] = useState("gemini");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    void loadKeys();
  }, []);

  const loadKeys = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/provider-keys/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKeys(await res.json());
    } catch (e) {
      setError(`Could not load provider keys (${e})`);
    } finally {
      setLoading(false);
    }
  };

  const saveKey = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE}/provider-keys/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          provider,
          label: label.trim() || undefined,
          api_key: apiKey.trim(),
          base_url: provider === "custom" ? baseUrl.trim() : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      setNotice(`Saved — your ${PROVIDERS.find((p) => p.value === provider)?.label} key now runs your agents.`);
      setLabel("");
      setApiKey("");
      setBaseUrl("");
      await loadKeys();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const deleteKey = async (id: number) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE}/provider-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      setNotice("Key removed — agents fall back to the platform default.");
      setKeys((ks) => ks.filter((k) => k.id !== id));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const activeProvider = PROVIDERS.find((p) => p.value === provider)!;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-2 text-muted-foreground">
            Your API keys and LLM providers. Every agent runs on the platform&apos;s default Gemini
            key out of the box — your own keys always take priority.
          </p>
        </div>

        <div className="mb-8 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <span className="mt-0.5 size-2 shrink-0 rounded-full bg-emerald-400" />
          <p>
            <span className="font-medium">Platform default active:</span> Google Gemini with the
            included platform key — every model family (GPT, Claude, Gemini) runs through it
            automatically. Add your own keys below to override per provider.
          </p>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-4">
          {[
            { label: "Saved keys", value: keys.length },
            { label: "Providers", value: new Set(keys.map((k) => k.provider)).size },
            { label: "Default model", value: "gemini-2.5-flash" },
            { label: "Embeddings", value: "gemini" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border/60 bg-card p-4">
              <div className="font-mono text-xs uppercase text-muted-foreground">{s.label}</div>
              <div className="mt-1 truncate text-lg font-semibold">{s.value}</div>
            </div>
          ))}
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg">Add an API key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="font-mono text-xs uppercase text-muted-foreground">Provider</label>
                <Select value={provider} onValueChange={(v) => { if (v) setProvider(v); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{activeProvider.hint}</p>
              </div>
              <div>
                <label className="font-mono text-xs uppercase text-muted-foreground">Label (optional)</label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`e.g. Work ${activeProvider.label} key`}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="font-mono text-xs uppercase text-muted-foreground">API key</label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your key — stored for your account only"
                  autoComplete="off"
                />
              </div>
              {provider === "custom" && (
                <div>
                  <label className="font-mono text-xs uppercase text-muted-foreground">Base URL</label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                  />
                </div>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
            <Button onClick={saveKey} disabled={saving || apiKey.trim().length < 8}>
              {saving ? "Saving…" : "Save key"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your provider keys</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : keys.length === 0 ? (
              <div className="py-10 text-center">
                <p className="font-medium">No personal keys yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  All your agents currently run on the platform Gemini default.{" "}
                  <Link href="/agents" className="underline hover:text-foreground">Build an agent →</Link>
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {keys.map((k) => {
                  const meta = PROVIDERS.find((p) => p.value === k.provider);
                  return (
                    <li key={k.id} className="flex items-center gap-4 py-3">
                      <McpLogo name={meta?.label || k.provider} color={meta?.color} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{k.label || meta?.label || k.provider}</span>
                          <Badge variant="secondary" className="rounded-full font-mono text-[10px] uppercase">
                            {k.provider}
                          </Badge>
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {k.api_key_masked}
                          {k.base_url ? ` · ${k.base_url}` : ""}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteKey(k.id)}>
                        Delete
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
      </Card>
    </div>
  );
}
