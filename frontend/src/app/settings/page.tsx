"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleAlertIcon,
  CopyIcon,
  InfoIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, StatBlock } from "@/components/ui-page";
import { api, getToken, messageFromError } from "@/lib/api";

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

function providerMeta(provider: string) {
  return (
    PROVIDERS.find((p) => p.value === provider) ?? {
      value: provider,
      label: provider,
      color: "#6366f1",
      hint: "",
    }
  );
}

export default function SettingsPage() {
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");

  const [provider, setProvider] = useState("gemini");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const loadKeys = useCallback(async () => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      setKeys(await api<ProviderKey[]>("/provider-keys/"));
    } catch (e) {
      setLoadError(messageFromError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const saveKey = async () => {
    setSaving(true);
    setFormError("");
    const activeMeta = providerMeta(provider);
    try {
      await api("/provider-keys/", {
        method: "POST",
        body: {
          provider,
          label: label.trim() || undefined,
          api_key: apiKey.trim(),
          base_url: provider === "custom" ? baseUrl.trim() : undefined,
        },
      });
      setLabel("");
      setApiKey("");
      setBaseUrl("");
      toast.success(`Saved — your ${activeMeta.label} key now runs your agents.`);
      await loadKeys();
    } catch (e) {
      const msg = messageFromError(e);
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async (key: ProviderKey) => {
    setDeletingId(key.id);
    try {
      await api(`/provider-keys/${key.id}`, { method: "DELETE" });
      setKeys((ks) => ks.filter((k) => k.id !== key.id));
      toast.success("Key removed — agents fall back to the platform default.");
    } catch (e) {
      toast.error(messageFromError(e));
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const copyMaskedKey = async (key: ProviderKey) => {
    try {
      await navigator.clipboard.writeText(key.api_key_masked);
      toast.success("Masked key copied — the full key is never shown here.");
    } catch {
      toast.error("Couldn't reach the clipboard — copy the string manually.");
    }
  };

  const activeMeta = providerMeta(provider);
  const distinctProviders = new Set(keys.map((k) => k.provider)).size;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="account"
        title="Settings"
        description="Your API keys for your agents. Everything already runs on the platform's Gemini key — add your own OpenAI, Anthropic, or local keys here and yours take priority."
      />

      {/* ------------------------------------------------------- info banner */}
      <Alert className="border-info/30 bg-info/10 [&>svg]:text-info">
        <InfoIcon />
        <AlertTitle>Platform default active — Google Gemini</AlertTitle>
        <AlertDescription>
          Every model family (GPT, Claude, Gemini) runs through the included
          platform key automatically. Add your own keys below to override per
          provider.
        </AlertDescription>
      </Alert>

      {/* --------------------------------------------------------- stat row */}
      <div className="my-6 grid gap-3 sm:grid-cols-4">
        <StatBlock label="Saved keys" value={keys.length} />
        <StatBlock label="Installed providers" value={distinctProviders} />
        <StatBlock label="Default model" value="gemini-2.5-flash" />
        <StatBlock label="Embeddings" value="gemini" />
      </div>

      {loadError && (
        <Alert variant="destructive" className="mb-6">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t load your provider keys</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{loadError}</span>
            <Button variant="outline" size="xs" onClick={() => void loadKeys()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ---------------------------------------------------- add-key form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Add an API key</CardTitle>
          <CardDescription>
            Stored for your account only — your agents pull it at run time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveKey();
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="provider-select">Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => setProvider(v ?? "gemini")}
                >
                  <SelectTrigger id="provider-select" className="w-full">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{activeMeta.hint}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key-label">
                  Label{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="key-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`e.g. Work ${activeMeta.label} key`}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="api-key">API key</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your key — stored for your account only"
                  autoComplete="off"
                  disabled={saving}
                  required
                />
                {formError && (
                  <p role="alert" className="text-xs text-destructive">
                    {formError}
                  </p>
                )}
              </div>
              {provider === "custom" && (
                <div className="space-y-1.5">
                  <Label htmlFor="base-url">Base URL</Label>
                  <Input
                    id="base-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                    disabled={saving}
                  />
                </div>
              )}
            </div>
            <Button type="submit" disabled={saving || apiKey.trim().length < 8}>
              {saving ? (
                <>
                  <Loader2Icon className="animate-spin" /> Saving…
                </>
              ) : (
                "Save key"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- keys list */}
      <Card>
        <CardHeader>
          <CardTitle>Your provider keys</CardTitle>
          <CardDescription>
            {keys.length > 0
              ? "Your keys override the platform default per provider."
              : "Agents run the moment a key is saved here."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-5 py-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-7 w-16" />
                </div>
              ))}
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              icon="✦"
              title="No personal keys yet"
              hint="All your agents currently run on the platform Gemini default. Save a key above to override a provider."
              actionLabel="Build an agent"
              actionHref="/agents"
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {keys.map((k) => {
                const meta = providerMeta(k.provider);
                const name = k.label || meta.label || k.provider;
                return (
                  <li key={k.id} className="flex items-center gap-3 py-3">
                    <Avatar>
                      <AvatarFallback
                        className="text-xs font-semibold text-white"
                        style={{ background: meta.color }}
                      >
                        {(name.trim()[0] || "•").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-medium">{name}</span>
                        <Badge
                          variant="secondary"
                          className="rounded-full font-mono text-[10px] uppercase"
                        >
                          {k.provider}
                        </Badge>
                        {k.base_url && (
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {k.base_url}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
                        <span className="truncate">{k.api_key_masked}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Copy masked ${name} key`}
                          onClick={() => void copyMaskedKey(k)}
                        >
                          <CopyIcon />
                        </Button>
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={deletingId === k.id}
                      onClick={() => setConfirmId(k.id)}
                    >
                      {deletingId === k.id ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <Trash2Icon />
                      )}
                      Delete
                    </Button>
                    <AlertDialog
                      open={confirmId === k.id}
                      onOpenChange={(o) => {
                        if (!o) setConfirmId(null);
                      }}
                    >
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete this {meta.label} key?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Agents running with it will immediately fall back to
                            the platform Gemini default. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deletingId === k.id}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            disabled={deletingId === k.id}
                            onClick={() => {
                              void removeKey(k);
                            }}
                          >
                            {deletingId === k.id ? "Deleting…" : "Delete key"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
