"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { McpLogo } from "@/components/McpLogo";
import { PageHeader } from "@/components/ui-page";
import { MCP_CATALOG, CATEGORIES, type MCPCatalogEntry } from "@/lib/mcp-catalog";
import { api, messageFromError, useApiQuery, getToken, AUTH_EVENT } from "@/lib/api";
import {
  ActivityIcon,
  CopyIcon,
  LayoutGridIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RadarIcon,
  RefreshCwIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";

interface MCPServer {
  id: number;
  name: string;
  description: string | null;
  config: any;
  logo_slug: string | null;
  category: string | null;
  is_public: boolean;
  last_status: string | null;
  last_checked_at: string | null;
  created_at: string;
}

interface EnvRow {
  key: string;
  value: string;
}

interface TestResult {
  healthy: boolean;
  tool_count: number;
  tools?: string[];
  error?: string;
}

interface DiscoverResult {
  tools?: any[];
  resources?: any[];
  prompts?: any[];
  error?: string;
}

type Transport = "stdio" | "streamable_http" | "sse";
type StatusFilter = "all" | "healthy" | "unreachable" | "untested";
type Tab = "catalog" | "servers";

export default function MCPServersPage() {
  const router = useRouter();

  /* ------------------------------------------------------------ auth */
  // Token comes from the shared client (never localStorage here); when it
  // appears/disappears the connections query below re-runs automatically.
  const [token, setTokenState] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setTokenState(getToken());
    sync();
    window.addEventListener(AUTH_EVENT, sync);
    return () => window.removeEventListener(AUTH_EVENT, sync);
  }, []);

  // Signed-out visitors are bounced to login (same behavior as before).
  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  /* ----------------------------------------------------------- data */
  const {
    data: servers,
    loading: serversLoading,
    error: serversError,
    reload,
  } = useApiQuery<MCPServer[]>("/mcp-servers/");
  const serversList = servers ?? [];
  const serverCount = serversList.length;

  // Which of this user's agents use which connections (for the stat chip)
  const [connectedAgents, setConnectedAgents] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!token) return;
    api<Array<{ tools_config?: Array<{ server_id?: number | string | null } | null> | null }>>("/agents/")
      .then((agents) => {
        const used = new Set<number>();
        (agents || []).forEach((a) =>
          (a.tools_config || []).forEach((t) => t?.server_id && used.add(Number(t.server_id)))
        );
        setConnectedAgents(used);
      })
      .catch(() => {});
  }, [token, serverCount]);

  /* -------------------------------------------------- list controls */
  const [tab, setTab] = useState<Tab>("catalog");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");

  const clearServerFilters = () => {
    setQuery("");
    setStatusFilter("all");
  };

  /* ---------------------------------------------- register / edit dialog */
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [picked, setPicked] = useState<MCPCatalogEntry | null>(null);
  const [custom, setCustom] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("python");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [logoSlug, setLogoSlug] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);

  // Test-before-connect: the UNSAVED config is POSTed to /mcp-servers/test;
  // the result is keyed to the config fingerprint so any later edit
  // automatically de-verifies the draft.
  const [draftTesting, setDraftTesting] = useState(false);
  const [draftTest, setDraftTest] = useState<TestResult | null>(null);
  const [draftTestKey, setDraftTestKey] = useState<string>("");

  /* ------------------------------------------------------ import dialog */
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: string[]; fail: { name: string; error: string }[] } | null>(null);
  const [importing, setImporting] = useState(false);

  /* -------------------------------------------- per-server interactions */
  const [testingId, setTestingId] = useState<number | null>(null);
  const [validatingId, setValidatingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [discoverResults, setDiscoverResults] = useState<Record<number, DiscoverResult>>({});
  const [discoverTarget, setDiscoverTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MCPServer | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* --------------------------------------------------- identity helpers */
  // Same-MCP-server fingerprint (ignores env/secrets) — used to match catalog
  // entries to saved connections and to block duplicate registrations.
  const configIdentity = (cfg: any): string => {
    if (!cfg) return "";
    const t = cfg.transport || (cfg.command ? "stdio" : "sse");
    if (t === "stdio") {
      const joined = (cfg.args || []).join(" ").trim().toLowerCase();
      return `stdio|${(cfg.command || "").trim().toLowerCase()}|${joined}`;
    }
    return `${t}|${(cfg.url || "").trim().toLowerCase()}`;
  };

  const entryIdentity = (e: MCPCatalogEntry): string =>
    configIdentity({ transport: e.transport, command: e.command, args: e.args, url: e.url });

  const connectedForEntry = (entry: MCPCatalogEntry): MCPServer | undefined =>
    serversList.find((s) => configIdentity(s.config) && configIdentity(s.config) === entryIdentity(entry));

  /* --------------------------------------------------------- form flows */
  const resetForm = () => {
    setPicked(null);
    setCustom(true);
    setName("");
    setDescription("");
    setTransport("stdio");
    setCommand("python");
    setArgs("");
    setUrl("");
    setHeadersText("");
    setLogoSlug("");
    setCategoryDraft("");
    setEnvRows([]);
  };

  const openCatalogEntry = (entry: MCPCatalogEntry) => {
    setEditingId(null);
    setPicked(entry);
    setCustom(false);
    setName(entry.name);
    setDescription(entry.description);
    setTransport(entry.transport);
    setCommand(entry.command || "python");
    setArgs((entry.args || []).join(" "));
    setUrl(entry.url || "");
    setHeadersText("");
    setLogoSlug(entry.icon?.slug || entry.slug);
    setCategoryDraft(entry.category);
    setEnvRows((entry.requiredEnv || []).map((e) => ({ key: e.name, value: "" })));
    setImportMsg(null);
    setDraftTest(null);
    setDraftTestKey("");
    setShowCreate(true);
  };

  const openCustom = () => {
    resetForm();
    setEditingId(null);
    setImportMsg(null);
    setDraftTest(null);
    setDraftTestKey("");
    setShowCreate(true);
  };

  const openEdit = (s: MCPServer) => {
    resetForm();
    setEditingId(s.id);
    setName(s.name);
    setDescription(s.description || "");
    setTransport((s.config?.transport || "stdio") as Transport);
    setCommand(s.config?.command || "python");
    setArgs((s.config?.args || []).join(" "));
    setUrl(s.config?.url || "");
    setHeadersText(
      s.config?.headers && typeof s.config.headers === "object"
        ? JSON.stringify(s.config.headers, null, 2)
        : ""
    );
    setLogoSlug(s.logo_slug || "");
    setCategoryDraft(s.category || "");
    const env = s.config?.env && typeof s.config.env === "object" ? s.config.env : {};
    setEnvRows(
      Object.keys(env).length > 0
        ? Object.entries(env).map(([key, value]) => ({ key, value: String(value) }))
        : [{ key: "", value: "" }]
    );
    setImportMsg(null);
    setDraftTest(null);
    setDraftTestKey("");
    setShowCreate(true);
  };

  const buildConfig = () => {
    const config: any = { name: name.trim() || picked?.name || "server", transport };
    if (transport === "stdio") {
      config.command = command;
      config.args = args.split(/\s+/).filter(Boolean);
    } else {
      config.url = url;
      try {
        const headers = headersText.trim() ? JSON.parse(headersText) : {};
        if (headers && typeof headers === "object" && !Array.isArray(headers) && Object.keys(headers).length > 0) {
          config.headers = headers;
        }
      } catch {
        /* invalid JSON is surfaced by `headersParseError` and blocks save/test */
      }
    }
    const env = Object.fromEntries(
      envRows.filter((r) => r.key.trim() && r.value.trim()).map((r) => [r.key.trim(), r.value.trim()])
    );
    if (Object.keys(env).length > 0) config.env = env;
    return config;
  };

  const headersParseError = useMemo<string | null>(() => {
    if (transport === "stdio" || !headersText.trim()) return null;
    try {
      const h = JSON.parse(headersText);
      if (!h || typeof h !== "object" || Array.isArray(h)) return "expected a JSON object";
      return null;
    } catch {
      return "invalid JSON";
    }
  }, [transport, headersText]);

  // ---- Draft verification: POST /mcp-servers/test ----
  const testDraft = async () => {
    setDraftTesting(true);
    setDraftTest(null);
    const key = JSON.stringify(buildConfig());
    try {
      const result = await api<TestResult>("/mcp-servers/test", {
        method: "POST",
        body: { config: buildConfig() },
      });
      setDraftTest(result);
    } catch (e: unknown) {
      setDraftTest({ healthy: false, tool_count: 0, error: messageFromError(e) });
    }
    setDraftTestKey(key);
    setDraftTesting(false);
  };

  const requiredEnvMissing =
    (picked?.requiredEnv || []).filter(
      (e) => !envRows.some((r) => r.key === e.name && r.value.trim())
    ).length > 0;

  const draftVerified = Boolean(draftTest?.healthy) && draftTestKey === JSON.stringify(buildConfig());
  // Editing without changing the config doesn't need a re-test
  const editConfigUnchanged =
    editingId !== null &&
    JSON.stringify(buildConfig()) === JSON.stringify(serversList.find((s) => s.id === editingId)?.config || null);
  const canConnect = (draftVerified || editConfigUnchanged) && !headersParseError;

  const dropDiscoverCache = (id: number) =>
    setDiscoverResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const saveServer = async () => {
    setSaving(true);
    try {
      const isEdit = editingId !== null;
      const body: any = {
        name: name.trim() || picked?.name || "MCP Server",
        description,
        config: buildConfig(),
      };
      if (isEdit) {
        body.logo_slug = logoSlug.trim() || null;
        body.category = categoryDraft || null;
      } else {
        body.logo_slug = picked?.icon?.slug || picked?.slug || logoSlug.trim() || null;
        body.category = picked?.category || categoryDraft || null;
      }
      await api<MCPServer>(isEdit ? `/mcp-servers/${editingId}` : `/mcp-servers/`, {
        method: isEdit ? "PUT" : "POST",
        body,
      });
      toast.success(isEdit ? "Connection updated" : "Connected", { description: body.name });
      setShowCreate(false);
      setEditingId(null);
      if (isEdit) dropDiscoverCache(editingId!);
      await reload();
    } catch (e: unknown) {
      // Duplicate configs (409 from the API) and all other failures surface
      // inline in the connect dialog's result panel…
      const msg = messageFromError(e);
      setDraftTest({ healthy: false, tool_count: 0, error: msg });
      // …plus a toast.
      toast.error(editingId !== null ? "Couldn't update connection" : "Couldn't connect", {
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------ import flow */
  // ---- Bulk import (Claude Desktop / Cursor mcpServers JSON, a name→config
  // map, an array of configs, or a single config object) ----
  const runImport = async () => {
    setImporting(true);
    setImportMsg(null);
    const out: { ok: string[]; fail: { name: string; error: string }[] } = { ok: [], fail: [] };
    try {
      let entries: [string, any][];
      const parsed = JSON.parse(importText);
      if (parsed && typeof parsed === "object" && parsed.mcpServers && typeof parsed.mcpServers === "object") {
        entries = Object.entries(parsed.mcpServers); // Claude Desktop / Cursor format
      } else if (Array.isArray(parsed)) {
        entries = parsed.map((cfg: any, i: number) => [`server-${i + 1}`, cfg]);
      } else if (
        parsed &&
        typeof parsed === "object" &&
        !("command" in parsed || "url" in parsed || "transport" in parsed)
      ) {
        entries = Object.entries(parsed); // name -> config map
      } else {
        entries = [["server", parsed]]; // single config object
      }

      for (const [key, rawCfg] of entries) {
        const cfg: any = rawCfg || {};
        const normalized: any = {
          name: cfg.name || key,
          transport: cfg.transport || (cfg.command ? "stdio" : "sse"),
        };
        if (cfg.command) normalized.command = cfg.command;
        if (cfg.args) normalized.args = cfg.args;
        if (cfg.url) normalized.url = cfg.url;
        if (cfg.env) normalized.env = cfg.env;
        if (cfg.headers) normalized.headers = cfg.headers;
        try {
          await api("/mcp-servers/", {
            method: "POST",
            body: { name: key || "server", description: "Imported MCP server", config: normalized },
          });
          out.ok.push(key);
        } catch (e: unknown) {
          out.fail.push({ name: key, error: messageFromError(e) });
        }
      }
      setImportMsg(out);
      await reload();
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "invalid JSON";
      setImportMsg({ ok: [], fail: [{ name: "(raw input)", error: raw }] });
    } finally {
      setImporting(false);
    }
  };

  /* --------------------------------------------------- server actions */
  const testConnection = async (id: number) => {
    if (!token) return;
    setTestingId(id);
    try {
      const result = await api<TestResult>(`/mcp-servers/${id}/test`, { method: "POST" });
      setTestResults((prev) => ({ ...prev, [id]: result }));
      await reload(); // refresh persisted last_status / last_checked_at
    } catch (e: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { healthy: false, tool_count: 0, error: messageFromError(e) },
      }));
    } finally {
      setTestingId(null);
    }
  };

  // Re-validate a saved config (shape/config parse) — reports via toast.
  const validateServer = async (s: MCPServer) => {
    setValidatingId(s.id);
    try {
      const data = await api<{ results?: Array<{ valid?: boolean; error?: string | null }> }>(
        `/mcp-servers/${s.id}/validate`,
        { method: "POST" }
      );
      const result = (data.results || [])[0];
      if (result?.valid) {
        toast.success("Config valid", {
          description: `“${s.name}” parsed for ${s.config?.transport || "stdio"}.`,
        });
      } else {
        toast.error("Invalid config", {
          description: result?.error || `“${s.name}” failed validation.`,
        });
      }
    } catch (e: unknown) {
      toast.error("Validation failed", { description: messageFromError(e) });
    } finally {
      setValidatingId(null);
    }
  };

  // Discover (tools/resources/prompts) — cached per server like before, shown
  // in a dialog instead of an inline drawer.
  const fetchDiscover = async (id: number) => {
    setDiscoverResults((prev) => ({ ...prev, [id]: {} })); // spinner placeholder
    try {
      const data = await api<DiscoverResult>(`/mcp-servers/${id}/discover`, { method: "POST" });
      setDiscoverResults((prev) => ({ ...prev, [id]: data }));
    } catch (e: unknown) {
      setDiscoverResults((prev) => ({ ...prev, [id]: { error: messageFromError(e) } }));
    }
  };

  const openDiscover = (s: MCPServer) => {
    setDiscoverTarget({ id: s.id, name: s.name });
    if (!discoverResults[s.id]) void fetchDiscover(s.id);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/mcp-servers/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Connection deleted", { description: deleteTarget.name });
      setDeleteTarget(null);
      dropDiscoverCache(deleteTarget.id);
      await reload();
    } catch (e: unknown) {
      toast.error("Delete failed", { description: messageFromError(e) });
    } finally {
      setDeleting(false);
    }
  };

  const copyText = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch (e: unknown) {
      toast.error("Couldn't copy", { description: messageFromError(e) });
    }
  };

  const copyConfig = (s: MCPServer) => {
    void copyText(JSON.stringify(s.config, null, 2), "Config copied");
  };

  /* -------------------------------------------------------- presentation */
  const statusPill = (status: string | null) => {
    if (status === "healthy")
      return { label: "healthy", pill: "bg-success/10 text-success", dot: "bg-success" };
    if (status === "unreachable")
      return { label: "unreachable", pill: "bg-destructive/10 text-destructive", dot: "bg-destructive" };
    return { label: "untested", pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" };
  };

  const configSummary = (s: MCPServer) => {
    const cfg = s.config || {};
    if (cfg.transport === "stdio") return `${cfg.command || "?"} ${(cfg.args || []).join(" ")}`.trim();
    return cfg.url || "";
  };

  const catalogEntries = MCP_CATALOG.filter((e) => {
    if (category === "all" || e.category === category) {
      const q = catalogQuery.trim().toLowerCase();
      if (!q || `${e.name} ${e.description}`.toLowerCase().includes(q)) return true;
    }
    return false;
  });

  const filtered = serversList.filter((s) => {
    if (query && !`${s.name} ${s.description || ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (statusFilter === "healthy") return s.last_status === "healthy";
    if (statusFilter === "unreachable") return s.last_status === "unreachable";
    if (statusFilter === "untested") return !s.last_status;
    return true;
  });

  const healthyCount = serversList.filter((s) => s.last_status === "healthy").length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="model context protocol"
        title="Tool Connections"
        description="Give your agents superpowers: connect popular tools in one click, or register your own server. Each connection is tested before it's added, and every agent can reuse it."
      >
        <Button
          variant="outline"
          onClick={() => {
            setImportMsg(null);
            setShowImport(true);
          }}
        >
          <UploadIcon className="size-3.5" /> Import JSON
        </Button>
        <Dialog
          open={showCreate}
          onOpenChange={(o: boolean) => {
            setShowCreate(o);
            if (!o) {
              setEditingId(null);
              setDraftTest(null);
              setDraftTestKey("");
            }
          }}
        >
          <DialogTrigger render={<Button onClick={openCustom} />}>
            <PlusIcon className="size-3.5" /> Register server
          </DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {editingId ? (
                  <McpLogo
                    slug={serversList.find((s: MCPServer) => s.id === editingId)?.logo_slug}
                    name={name}
                    size={20}
                  />
                ) : picked ? (
                  <McpLogo
                    slug={picked.icon?.slug || picked.slug}
                    name={picked.name}
                    size={20}
                    color={picked.icon?.color}
                  />
                ) : (
                  <McpLogo slug={logoSlug} name={name || "MCP Server"} size={20} />
                )}
                {editingId ? "Edit Connection" : custom ? "Register MCP Server" : `Connect ${picked?.name}`}
              </DialogTitle>
              <DialogDescription>
                {editingId
                  ? "Update the command, URL or secrets — the connection is re-tested whenever its config changes."
                  : "Test the connection before saving — Connect unlocks once it verifies."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-name">Name</Label>
                <Input id="mcp-name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mcp-description">Description (optional)</Label>
                <Textarea
                  id="mcp-description"
                  placeholder="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-transport">Transport</Label>
                  <Select
                    value={transport}
                    onValueChange={(v) => setTransport(((v ?? "stdio") as Transport))}
                  >
                    <SelectTrigger id="mcp-transport" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stdio">stdio (local command)</SelectItem>
                      <SelectItem value="streamable_http">streamable_http</SelectItem>
                      <SelectItem value="sse">sse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-logo">Logo slug</Label>
                  <div className="flex items-center gap-2">
                    <McpLogo
                      slug={logoSlug || null}
                      name={name || picked?.name || "MCP"}
                      size={24}
                      color={picked?.icon?.color}
                    />
                    <Input
                      id="mcp-logo"
                      className="font-mono text-xs"
                      placeholder="e.g. github (blank = monogram)"
                      value={logoSlug}
                      onChange={(e) => setLogoSlug(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mcp-category">Category (optional)</Label>
                <Select value={categoryDraft} onValueChange={(v) => setCategoryDraft(v ?? "")}>
                  <SelectTrigger id="mcp-category" className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {CATEGORIES.filter((c) => c !== "all").map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {transport === "stdio" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-command">Command</Label>
                    <Input
                      id="mcp-command"
                      placeholder="Command (e.g. python)"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-args">Args (space-separated)</Label>
                    <Input
                      id="mcp-args"
                      placeholder="Args (space-separated)"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-url">URL</Label>
                    <Input
                      id="mcp-url"
                      placeholder="URL"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-headers">Headers (JSON, optional)</Label>
                    <Textarea
                      id="mcp-headers"
                      rows={2}
                      className="font-mono text-xs"
                      placeholder={'{\n  "Authorization": "Bearer …"\n}'}
                      value={headersText}
                      onChange={(e) => setHeadersText(e.target.value)}
                    />
                    {headersParseError && (
                      <p className="font-mono text-[11px] text-destructive">headers — {headersParseError}</p>
                    )}
                  </div>
                </>
              )}

              <div className="space-y-2 rounded-lg bg-muted/40 p-3 ring-1 ring-foreground/10">
                <p className="font-mono text-[11px] text-muted-foreground uppercase">
                  environment secrets {picked?.requiredEnv?.length ? `(required by ${picked.name})` : "(optional)"}
                </p>
                {envRows.map((row, idx) => {
                  const locked = Boolean(
                    !editingId && picked?.requiredEnv?.some((e) => e.name === row.key)
                  );
                  const hint = picked?.requiredEnv?.find((e) => e.name === row.key)?.hint || "value";
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={row.key}
                        disabled={locked}
                        onChange={(e) =>
                          setEnvRows(envRows.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))
                        }
                        placeholder="ENV_KEY"
                        className="w-48 font-mono text-xs"
                      />
                      <Input
                        type="password"
                        value={row.value}
                        onChange={(e) =>
                          setEnvRows(envRows.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))
                        }
                        placeholder={hint}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove variable"
                        onClick={() => setEnvRows(envRows.filter((_, i) => i !== idx))}
                        disabled={locked}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEnvRows([...envRows, { key: "", value: "" }])}
                >
                  <PlusIcon className="size-3.5" /> Add variable
                </Button>
              </div>

              {/* test-before-connect result panel */}
              {draftTest && (
                <div>
                  {draftTesting ? (
                    <div className="rounded-lg bg-muted/40 px-2.5 py-2 ring-1 ring-foreground/10">
                      <p className="animate-pulse font-mono text-[11px] text-muted-foreground">
                        connecting & listing tools…
                      </p>
                    </div>
                  ) : draftVerified ? (
                    <div className="rounded-lg bg-success/10 px-2.5 py-2 ring-1 ring-success/25">
                      <p className="font-mono text-[11px] text-success">
                        ✓ verified — {draftTest.tool_count} tool{draftTest.tool_count === 1 ? "" : "s"}{" "}
                        reachable. You can connect now.
                      </p>
                      {draftTest.tools && draftTest.tools.length > 0 && (
                        <div className="mt-1.5 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                          {draftTest.tools.slice(0, 8).map((t) => (
                            <span
                              key={t}
                              className="rounded-md bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground ring-1 ring-foreground/10"
                            >
                              {t}
                            </span>
                          ))}
                          {draftTest.tools.length > 8 && (
                            <span className="self-center font-mono text-[10px] text-success">
                              +{draftTest.tools.length - 8}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg bg-destructive/10 px-2.5 py-2 ring-1 ring-destructive/25">
                      <p className="break-words font-mono text-[11px] text-destructive">
                        ✗ {draftTest.error || "connection failed"} — fix the config and test again
                      </p>
                    </div>
                  )}
                </div>
              )}

              {requiredEnvMissing && !draftVerified && (
                <p className="font-mono text-xs text-warning">
                  enter all required secrets for {picked?.name} to enable testing
                </p>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={testDraft}
                  disabled={draftTesting || requiredEnvMissing || Boolean(headersParseError)}
                >
                  {draftTesting ? "Testing…" : draftVerified ? "Re-test" : "Test connection"}
                </Button>
                <Button
                  onClick={saveServer}
                  disabled={saving || !name || !canConnect}
                  title={
                    !canConnect ? "Test the connection first — Connect unlocks once verified" : undefined
                  }
                >
                  {saving
                    ? editingId
                      ? "Updating..."
                      : "Connecting..."
                    : editingId
                      ? "Update Connection"
                      : "Connect"}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {/* stat chips — registered / healthy / in use by agents */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatChip label="connections registered" value={serverCount} />
        <StatChip label="healthy" value={healthyCount} tone="success" />
        <StatChip label="in use by agents" value={connectedAgents.size} tone="brand" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(((v ?? "catalog") as Tab))}>
        <TabsList className="mb-5">
          <TabsTrigger value="catalog">
            <LayoutGridIcon className="size-3.5" /> Catalog
          </TabsTrigger>
          <TabsTrigger value="servers">
            <ServerIcon className="size-3.5" /> My servers
            <span className="font-mono text-[10px] text-muted-foreground">{serverCount}</span>
          </TabsTrigger>
        </TabsList>

        {/* --------------------------------------------- catalog tab */}
        <TabsContent value="catalog">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search popular tools…"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                aria-label="Search the catalog"
              />
              {catalogQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setCatalogQuery("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-mono text-xs transition-colors",
                    category === c
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalogEntries.map((entry) => {
              const connected = connectedForEntry(entry);
              return (
                <Card
                  key={entry.slug}
                  className="flex flex-col transition-all hover:-translate-y-0.5 hover:ring-foreground/20"
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-tight">
                      <McpLogo slug={entry.icon?.slug} name={entry.name} size={22} color={entry.icon?.color} />
                      <span className="line-clamp-1">{entry.name}</span>
                    </CardTitle>
                    <CardAction className="flex shrink-0 items-center gap-1.5">
                      {connected && (
                        <span
                          title="Already in your registry"
                          className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10px] text-success"
                        >
                          <span className="size-1.5 rounded-full bg-success" /> connected
                        </span>
                      )}
                      {entry.official && <Badge variant="outline" className="font-mono">official</Badge>}
                    </CardAction>
                    <CardDescription className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary" className="font-mono text-[10px]">{entry.transport}</Badge>
                      <Badge variant="secondary" className="font-mono text-[10px]">{entry.category}</Badge>
                      {entry.requiresAuth && (
                        <Badge className="border-transparent bg-warning/10 font-mono text-[10px] text-warning">
                          auth
                        </Badge>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col">
                    <p className="mb-3 text-xs text-muted-foreground line-clamp-2">{entry.description}</p>
                    {connected ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-auto"
                        onClick={() => openEdit(connected)}
                      >
                        ✓ Connected — Manage
                      </Button>
                    ) : (
                      <Button size="sm" className="mt-auto" onClick={() => openCatalogEntry(entry)}>
                        Connect
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {catalogEntries.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-8 py-12 text-center">
              <p className="font-medium">No catalog servers match</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different search or category.</p>
              <Button
                variant="outline"
                className="mt-4"
                size="sm"
                onClick={() => {
                  setCatalogQuery("");
                  setCategory("all");
                }}
              >
                Clear catalog filters
              </Button>
            </div>
          )}
        </TabsContent>

        {/* -------------------------------------------- my servers tab */}
        <TabsContent value="servers">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search connections…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search connections"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(((v ?? "all") as StatusFilter))}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="unreachable">Unreachable</SelectItem>
                <SelectItem value="untested">Never tested</SelectItem>
              </SelectContent>
            </Select>
            {(query || statusFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={clearServerFilters}>
                <XIcon className="size-3.5" /> Clear
              </Button>
            )}
          </div>

          {serversError ? (
            <div className="rounded-xl border border-dashed border-destructive/40 px-8 py-12 text-center">
              <p className="font-medium">Couldn&apos;t load your connections</p>
              <p className="mt-1 text-sm text-muted-foreground">{serversError}</p>
              <Button variant="outline" className="mt-4" onClick={reload} disabled={serversLoading}>
                <RefreshCwIcon className="size-3.5" /> {serversLoading ? "Retrying…" : "Retry"}
              </Button>
            </div>
          ) : serversLoading && serverCount === 0 ? (
            <ServersSkeleton />
          ) : serverCount === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-8 py-14 text-center">
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-xl text-brand ring-1 ring-brand/20"
              >
                <PlugIcon className="size-5" />
              </span>
              <p className="mt-4 font-medium">No connections yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Pick a popular server from the catalog, register your own, or import a JSON config.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => setTab("catalog")}>
                  <LayoutGridIcon className="size-3.5" /> Browse the catalog
                </Button>
                <Button onClick={openCustom}>
                  <PlusIcon className="size-3.5" /> Register custom server
                </Button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-8 py-14 text-center">
              <p className="font-medium">No matches for this search / filter.</p>
              <Button variant="outline" className="mt-4" onClick={clearServerFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s) => {
                const pill = statusPill(s.last_status);
                const toolCount = testResults[s.id]?.tool_count ?? 0;
                return (
                  <Card
                    key={s.id}
                    className="flex flex-col transition-all hover:-translate-y-0.5 hover:ring-foreground/20"
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-tight">
                        <McpLogo slug={s.logo_slug} name={s.name} size={24} />
                        <span className="line-clamp-1">{s.name}</span>
                      </CardTitle>
                      <CardAction className="flex shrink-0 items-center gap-1.5">
                        {connectedAgents.has(s.id) && (
                          <span
                            title="In use by at least one agent"
                            className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[10px] text-brand ring-1 ring-brand/20"
                          >
                            in use
                          </span>
                        )}
                        {toolCount > 0 && (
                          <Badge variant="outline" className="font-mono">
                            {toolCount} tool{toolCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                        <Badge variant="outline" className="font-mono">
                          {s.config?.transport || "unknown"}
                        </Badge>
                        <span
                          title={`${s.last_status || "never tested"}${s.last_checked_at ? ` · ${new Date(s.last_checked_at).toLocaleString()}` : ""}`}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px]",
                            pill.pill
                          )}
                        >
                          <span className={cn("size-1.5 rounded-full", pill.dot)} />
                          {pill.label}
                        </span>
                      </CardAction>
                      <CardDescription className="space-y-0.5 font-mono text-[11px]">
                        <span className="block truncate" title={configSummary(s)}>
                          {configSummary(s) || "—"}
                        </span>
                        {s.last_checked_at && (
                          <span className="block text-muted-foreground/80">
                            last tested: {new Date(s.last_checked_at).toLocaleString()}
                          </span>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-2.5">
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {s.description || "No description"}
                      </p>

                      {testResults[s.id] &&
                        (() => {
                          const r = testResults[s.id];
                          return r.healthy ? (
                            <div className="rounded-lg bg-success/10 px-2.5 py-1.5 ring-1 ring-success/25">
                              <p className="font-mono text-[11px] text-success">
                                ✓ connected — {r.tool_count} tool{r.tool_count === 1 ? "" : "s"}
                              </p>
                              {r.tools && r.tools.length > 0 && (
                                <div className="mt-1.5 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                                  {r.tools.slice(0, 8).map((t) => (
                                    <span
                                      key={t}
                                      className="rounded-md bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground ring-1 ring-foreground/10"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                  {r.tools.length > 8 && (
                                    <span className="self-center font-mono text-[10px] text-success">
                                      +{r.tools.length - 8}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="rounded-lg bg-destructive/10 px-2.5 py-1.5 ring-1 ring-destructive/25">
                              <p className="break-words font-mono text-[11px] text-destructive">
                                ✗ {r.error || "connection failed"}
                              </p>
                            </div>
                          );
                        })()}

                      <div className="mt-auto flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label="Test connection"
                                onClick={() => testConnection(s.id)}
                                disabled={testingId === s.id}
                              />
                            }
                          >
                            <ActivityIcon />
                          </TooltipTrigger>
                          <TooltipContent>Test connection</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Validate config"
                                onClick={() => validateServer(s)}
                                disabled={validatingId === s.id}
                              />
                            }
                          >
                            <ShieldCheckIcon />
                          </TooltipTrigger>
                          <TooltipContent>Validate config</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Discover tools"
                                onClick={() => openDiscover(s)}
                              />
                            }
                          >
                            <RadarIcon />
                          </TooltipTrigger>
                          <TooltipContent>Discover tools</TooltipContent>
                        </Tooltip>
                        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Edit connection"
                                onClick={() => openEdit(s)}
                              />
                            }
                          >
                            <PencilIcon />
                          </TooltipTrigger>
                          <TooltipContent>Edit connection</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Copy config JSON"
                                onClick={() => copyConfig(s)}
                              />
                            }
                          >
                            <CopyIcon />
                          </TooltipTrigger>
                          <TooltipContent>Copy config JSON</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label="Delete connection"
                                onClick={() => setDeleteTarget(s)}
                              />
                            }
                          >
                            <Trash2Icon />
                          </TooltipTrigger>
                          <TooltipContent>Delete connection</TooltipContent>
                        </Tooltip>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {serverCount > 0 && (
            <p className="mt-4 font-mono text-xs text-muted-foreground">
              tip · attach these in any agent builder via “From registry…” — the agent uses your live config
              on every run.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* ------------------------------------------------ import dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import MCP Servers</DialogTitle>
            <DialogDescription>
              Paste a Claude Desktop / Cursor <span className="font-mono">mcpServers</span> config, a
              name→config map, or a single config JSON. Each server is validated and added to your registry.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={9}
            className="font-mono text-xs"
            placeholder={`{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]\n    }\n  }\n}`}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importMsg && (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-muted/40 px-2.5 py-2 font-mono text-[11px] ring-1 ring-foreground/10">
              {importMsg.ok.length > 0 && (
                <p className="text-success">✓ imported: {importMsg.ok.join(", ")}</p>
              )}
              {importMsg.fail.map((f, i) => (
                <p key={i} className="text-destructive">
                  ✗ {f.name}: {f.error}
                </p>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowImport(false)}>
              Close
            </Button>
            <Button onClick={runImport} disabled={importing || !importText.trim()}>
              {importing ? "Importing..." : "Import Servers"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------- discover dialog */}
      <Dialog
        open={discoverTarget !== null}
        onOpenChange={(o: boolean) => {
          if (!o) setDiscoverTarget(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {discoverTarget && (
                <McpLogo
                  slug={serversList.find((x) => x.id === discoverTarget.id)?.logo_slug}
                  name={discoverTarget.name}
                  size={20}
                />
              )}
              Tools · {discoverTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Everything this connection exposes. Click any item (or copy a whole section) to copy its JSON.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const r = discoverTarget ? discoverResults[discoverTarget.id] : undefined;
            const busy =
              r && !r.error && r.tools === undefined && r.resources === undefined && r.prompts === undefined;
            if (busy) {
              return (
                <div className="flex items-center justify-center rounded-lg bg-muted/40 px-3 py-10 ring-1 ring-foreground/10">
                  <span className="animate-pulse font-mono text-xs text-muted-foreground">discovering…</span>
                </div>
              );
            }
            if (r?.error) {
              return (
                <div className="rounded-lg bg-destructive/10 px-2.5 py-2 ring-1 ring-destructive/25">
                  <p className="break-words font-mono text-[11px] text-destructive">✗ {r.error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => discoverTarget && void fetchDiscover(discoverTarget.id)}
                  >
                    <RefreshCwIcon className="size-3.5" /> Retry
                  </Button>
                </div>
              );
            }
            if (!r) return null;
            return (
              <ScrollArea className="h-80 rounded-lg bg-muted/30 ring-1 ring-foreground/10">
                <div className="space-y-4 p-3">
                  <DiscoverSection label="Tools" items={r.tools || []} onCopy={copyText} />
                  <DiscoverSection label="Resources" items={r.resources || []} onCopy={copyText} />
                  <DiscoverSection label="Prompts" items={r.prompts || []} onCopy={copyText} />
                </div>
              </ScrollArea>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------- delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o: boolean) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the MCP connection from your registry. Any agent still using it may lose its
              tools. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function StatChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "success" | "brand";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs whitespace-nowrap ring-1",
        tone === "success" && "bg-success/10 text-success ring-success/20",
        tone === "brand" && "bg-brand/10 text-brand ring-brand/20",
        tone === "neutral" && "bg-muted/60 text-muted-foreground ring-foreground/10"
      )}
    >
      <span className={cn("font-mono text-[11px] font-semibold", tone === "neutral" && "text-foreground")}>
        {value}
      </span>
      <span className="truncate uppercase tracking-wide">{label}</span>
    </span>
  );
}

function DiscoverSection({
  label,
  items,
  onCopy,
}: {
  label: string;
  items: any[];
  onCopy: (text: string, label?: string) => Promise<void>;
}) {
  const nameOf = (t: any, i: number) => (typeof t === "string" ? t : t?.name || `item-${i + 1}`);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-muted-foreground uppercase">
          {label} <span className="text-foreground">({items.length})</span>
        </p>
        {items.length > 0 && (
          <Button variant="ghost" size="xs" onClick={() => void onCopy(JSON.stringify(items, null, 2))}>
            <CopyIcon className="size-3" /> Copy all
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">none</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t, i) => (
            <button
              key={i}
              type="button"
              title={`Copy this ${label.toLowerCase().slice(0, -1)} JSON`}
              onClick={() => void onCopy(JSON.stringify(t, null, 2), `${nameOf(t, i)} copied`)}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-background px-2 py-1 font-mono text-[11px] text-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted"
            >
              <span className="truncate">{nameOf(t, i)}</span>
              <CopyIcon className="size-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ServersSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
