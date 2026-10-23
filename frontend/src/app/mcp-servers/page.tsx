"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { McpLogo } from "@/components/McpLogo";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { API_BASE } from "@/lib/api";
import { MCP_CATALOG, CATEGORIES, type MCPCatalogEntry } from "@/lib/mcp-catalog";

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

type StatusFilter = "all" | "healthy" | "unreachable" | "untested";

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [connectedAgents, setConnectedAgents] = useState<Set<number>>(new Set());

  // Register / Edit dialog
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [picked, setPicked] = useState<MCPCatalogEntry | null>(null);
  const [custom, setCustom] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<"stdio" | "streamable_http" | "sse">("stdio");
  const [command, setCommand] = useState("python");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);

  // Import dialog
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: string[]; fail: { name: string; error: string }[] } | null>(null);
  const [importing, setImporting] = useState(false);

  // List controls
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Connection testing + discovery
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [discoverResults, setDiscoverResults] = useState<Record<number, DiscoverResult>>({});
  const [openDiscover, setOpenDiscover] = useState<Record<number, boolean>>({});

  // Draft test (connect dialog: Test first → Connect enabled once verified)
  const [draftTesting, setDraftTesting] = useState(false);
  const [draftTest, setDraftTest] = useState<TestResult | null>(null);
  const [draftTestKey, setDraftTestKey] = useState<string>("");

  // Catalog filter
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");

  const load = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/mcp-servers/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setServers(await res.json());
    }
  };

  useEffect(() => {
    const t = localStorage.getItem("token");
    if (!t) {
      window.location.href = "/login";
      return;
    }
    setToken(t);
  }, []);

  useEffect(() => {
    if (token) load();
  }, [token]);

  // Which of this user's agents use which connections (for the stats strip)
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/agents/`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((agents: any[]) => {
        const used = new Set<number>();
        (agents || []).forEach((a: any) =>
          (a.tools_config || []).forEach((t: any) => t?.server_id && used.add(Number(t.server_id)))
        );
        setConnectedAgents(used);
      })
      .catch(() => {});
  }, [token, servers.length]);

  // Same-MCP-server fingerprint (ignores env/secrets) — used to match catalog
  // entries to saved connections and to block duplicate registrations.
  const configIdentity = (cfg: any): string => {
    if (!cfg) return "";
    const transport = cfg.transport || (cfg.command ? "stdio" : "sse");
    if (transport === "stdio") {
      const args = (cfg.args || []).join(" ").trim().toLowerCase();
      return `stdio|${(cfg.command || "").trim().toLowerCase()}|${args}`;
    }
    return `${transport}|${(cfg.url || "").trim().toLowerCase()}`;
  };

  const entryIdentity = (e: MCPCatalogEntry): string =>
    configIdentity({ transport: e.transport, command: e.command, args: e.args, url: e.url });

  const connectedForEntry = (entry: MCPCatalogEntry): MCPServer | undefined =>
    servers.find((s) => configIdentity(s.config) && configIdentity(s.config) === entryIdentity(entry));

  const resetForm = () => {
    setPicked(null);
    setCustom(true);
    setName("");
    setDescription("");
    setTransport("stdio");
    setCommand("python");
    setArgs("");
    setUrl("");
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
    setTransport((s.config?.transport || "stdio") as any);
    setCommand(s.config?.command || "python");
    setArgs((s.config?.args || []).join(" "));
    setUrl(s.config?.url || "");
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
    }
    const env = Object.fromEntries(
      envRows.filter((r) => r.key.trim() && r.value.trim()).map((r) => [r.key.trim(), r.value.trim()])
    );
    if (Object.keys(env).length > 0) config.env = env;
    return config;
  };

  // ---- Draft verification: POST /mcp-servers/test with the UNSAVED config.
  // The result is keyed to the current config fingerprint so any later edit
  // automatically de-verifies the draft. ----
  const testDraft = async () => {
    setDraftTesting(true);
    setDraftTest(null);
    const key = JSON.stringify(buildConfig());
    try {
      const res = await fetch(`${API_BASE}/mcp-servers/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ config: buildConfig() }),
      });
      const result = await res.json();
      setDraftTest(
        res.ok
          ? result
          : { healthy: false, tool_count: 0, error: result?.detail || "Test failed" }
      );
      setDraftTestKey(key);
    } catch (e: any) {
      setDraftTest({ healthy: false, tool_count: 0, error: e?.message || "Network error" });
      setDraftTestKey(key);
    } finally {
      setDraftTesting(false);
    }
  };

  const requiredEnvMissing =
    (picked?.requiredEnv || []).filter(
      (e) => !envRows.some((r) => r.key === e.name && r.value.trim())
    ).length > 0;

  const draftVerified = Boolean(draftTest?.healthy) && draftTestKey === JSON.stringify(buildConfig());
  // Editing without changing the config doesn't need a re-test
  const editConfigUnchanged =
    editingId !== null &&
    JSON.stringify(buildConfig()) === JSON.stringify(servers.find((s) => s.id === editingId)?.config || null);
  const canConnect = draftVerified || editConfigUnchanged;

  const saveServer = async () => {
    setSaving(true);
    try {
      const isEdit = editingId !== null;
      const body: any = {
        name: name.trim() || picked?.name || "MCP Server",
        description,
        config: buildConfig(),
      };
      if (!isEdit) {
        body.logo_slug = picked?.icon?.slug || picked?.slug || null;
        body.category = picked?.category || null;
      }
      const res = await fetch(isEdit ? `${API_BASE}/mcp-servers/${editingId}` : `${API_BASE}/mcp-servers/`, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowCreate(false);
        setEditingId(null);
        await load();
      } else {
        const err = await res.json();
        if (res.status === 409) {
          setDraftTest({ healthy: false, tool_count: 0, error: err.detail });
        } else {
          alert(err.detail || (isEdit ? "Failed to update" : "Failed to create"));
        }
      }
    } finally {
      setSaving(false);
    }
  };

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
          const res = await fetch(`${API_BASE}/mcp-servers/`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: key || "server", description: "Imported MCP server", config: normalized }),
          });
          if (res.ok) out.ok.push(key);
          else {
            const err = await res.json();
            out.fail.push({ name: key, error: err.detail || "rejected" });
          }
        } catch (e: any) {
          out.fail.push({ name: key, error: e?.message || "network error" });
        }
      }
      setImportMsg(out);
      await load();
    } catch (e: any) {
      setImportMsg({ ok: [], fail: [{ name: "(raw input)", error: e?.message || "invalid JSON" }] });
    } finally {
      setImporting(false);
    }
  };

  const deleteServer = async (id: number) => {
    if (!confirm("Delete this MCP server connection?")) return;
    await fetch(`${API_BASE}/mcp-servers/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  };

  const testConnection = async (id: number) => {
    if (!token) return;
    setTestingId(id);
    try {
      const res = await fetch(`${API_BASE}/mcp-servers/${id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const result = await res.json();
        setTestResults((prev) => ({ ...prev, [id]: result }));
        await load(); // refresh persisted last_status / last_checked_at
      } else {
        const err = await res.json();
        setTestResults((prev) => ({
          ...prev,
          [id]: { healthy: false, tool_count: 0, error: err.detail || "Test failed" },
        }));
      }
    } catch (e: any) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { healthy: false, tool_count: 0, error: e?.message || "Network error" },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const toggleDiscover = async (id: number) => {
    const next = !openDiscover[id];
    setOpenDiscover((prev) => ({ ...prev, [id]: next }));
    if (next && !discoverResults[id]) {
      setDiscoverResults((prev) => ({ ...prev, [id]: {} })); // spinner state
      try {
        const res = await fetch(`${API_BASE}/mcp-servers/${id}/discover`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setDiscoverResults((prev) => ({
          ...prev,
          [id]: res.ok ? data : { error: data?.detail || "discovery failed" },
        }));
      } catch (e: any) {
        setDiscoverResults((prev) => ({ ...prev, [id]: { error: e?.message || "network error" } }));
      }
    }
  };

  const copyConfig = (s: MCPServer) => {
    navigator.clipboard.writeText(JSON.stringify(s.config, null, 2));
  };

  const statusPill = (status: string | null) => {
    if (status === "healthy")
      return {
        label: "healthy",
        pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        dot: "bg-emerald-400",
      };
    if (status === "unreachable")
      return {
        label: "unreachable",
        pill: "border-red-500/40 bg-red-500/10 text-red-300",
        dot: "bg-red-400",
      };
    return {
      label: "untested",
      pill: "border-border bg-muted/60 text-muted-foreground",
      dot: "bg-muted-foreground/50",
    };
  };

  const configSummary = (s: MCPServer) => {
    const cfg = s.config || {};
    if (cfg.transport === "stdio") return `${cfg.command || "?"} ${(cfg.args || []).join(" ")}`.trim();
    return cfg.url || "";
  };

  const catalogEntries =
    category === "all" ? MCP_CATALOG : MCP_CATALOG.filter((e) => e.category === category);

  const filtered = servers.filter((s) => {
    if (query && !`${s.name} ${s.description || ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (statusFilter === "healthy") return s.last_status === "healthy";
    if (statusFilter === "unreachable") return s.last_status === "unreachable";
    if (statusFilter === "untested") return !s.last_status;
    return true;
  });

  const healthyCount = servers.filter((s) => s.last_status === "healthy").length;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 font-mono text-lg font-bold text-white ring-1 ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
          >
            ✦
          </span>
          <div>
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              model context protocol
            </p>
            <h1 className="mt-1 text-3xl font-medium tracking-tight">MCP Server Registry</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Save reusable MCP server configurations for your agents — connect a famous server or your own,
              then attach it in the builder; configs resolve live at run time.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setImportMsg(null); setShowImport(true); }}>
            Import JSON
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
            <DialogTrigger render={<Button onClick={openCustom}>Register Server</Button>} />
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {editingId ? (
                    <McpLogo slug={servers.find((s) => s.id === editingId)?.logo_slug} name={name} size={20} />
                  ) : (
                    picked && (
                      <McpLogo
                        slug={picked.icon.slug || picked.slug}
                        name={picked.name}
                        size={20}
                        color={picked.icon.color}
                      />
                    )
                  )}
                  {editingId ? "Edit Connection" : custom ? "Register MCP Server" : `Connect ${picked?.name}`}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                <Textarea
                  placeholder="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
                <Select value={transport} onValueChange={(v: any) => setTransport(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio (local command)</SelectItem>
                    <SelectItem value="streamable_http">streamable_http</SelectItem>
                    <SelectItem value="sse">sse</SelectItem>
                  </SelectContent>
                </Select>
                {transport === "stdio" ? (
                  <>
                    <Input
                      placeholder="Command (e.g. python)"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                    />
                    <Input
                      placeholder="Args (space-separated)"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </>
                ) : (
                  <Input
                    placeholder="URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="font-mono text-xs"
                  />
                )}

                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="font-mono text-xs text-muted-foreground uppercase">
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
                          className="font-mono text-xs w-48"
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
                          size="sm"
                          onClick={() => setEnvRows(envRows.filter((_, i) => i !== idx))}
                          disabled={locked}
                        >
                          ✕
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEnvRows([...envRows, { key: "", value: "" }])}
                  >
                    + Add variable
                  </Button>
                </div>

                {draftTest && (
                  <div
                    className={`rounded-md border p-2 font-mono text-[11px] ${
                      draftVerified
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-red-500/40 bg-red-500/10 text-red-300"
                    }`}
                  >
                    {draftTesting ? (
                      <>connecting & listing tools…</>
                    ) : draftVerified ? (
                      <>✓ verified — {draftTest.tool_count} tool{draftTest.tool_count === 1 ? "" : "s"} reachable. You can connect now.
                        {draftTest.tools && draftTest.tools.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                            {draftTest.tools.slice(0, 8).map((t) => (
                              <span key={t} className="rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px]">{t}</span>
                            ))}
                            {draftTest.tools.length > 8 && <span className="self-end px-1 text-muted-foreground">+{draftTest.tools.length - 8}</span>}
                          </div>
                        )}
                      </>
                    ) : (
                      <>✗ {draftTest.error || "connection failed"} — fix the config and test again</>
                    )}
                  </div>
                )}

                {requiredEnvMissing && !draftVerified && (
                  <p className="font-mono text-xs text-amber-400">
                    enter all required secrets for {picked?.name} to enable testing
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={testDraft}
                    disabled={draftTesting || requiredEnvMissing}
                  >
                    {draftTesting ? "Testing…" : draftVerified ? "Re-test" : "Test connection"}
                  </Button>
                  <Button
                    onClick={saveServer}
                    disabled={saving || !name || !canConnect}
                    title={!canConnect ? "Test the connection first — Connect unlocks once verified" : undefined}
                  >
                    {saving
                      ? editingId
                        ? "Updating..."
                        : "Connecting..."
                      : editingId
                        ? "Update Connection"
                        : "Connect"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Import JSON dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import MCP Servers</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Paste a Claude Desktop / Cursor <span className="font-mono">mcpServers</span> config, a name→config
            map, or a single config JSON. Each server is validated and added to your registry.
          </p>
          <Textarea
            rows={9}
            className="font-mono text-xs"
            placeholder={`{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]\n    }\n  }\n}`}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importMsg && (
            <div className="rounded-md border border-border p-2 font-mono text-[11px] max-h-32 overflow-y-auto">
              {importMsg.ok.length > 0 && (
                <p className="text-emerald-300">✓ imported: {importMsg.ok.join(", ")}</p>
              )}
              {importMsg.fail.map((f, i) => (
                <p key={i} className="text-red-300">
                  ✗ {f.name}: {f.error}
                </p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowImport(false)}>
              Close
            </Button>
            <Button onClick={runImport} disabled={importing || !importText.trim()}>
              {importing ? "Importing..." : "Import Servers"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Famous servers catalog */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-sm text-muted-foreground uppercase">famous servers · one-click connect</h2>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                  category === c ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalogEntries.map((entry) => (
            <Card
              key={entry.slug}
              className="flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-tight">
                  <McpLogo slug={entry.icon.slug} name={entry.name} size={22} color={entry.icon.color} />
                  <span className="line-clamp-1">{entry.name}</span>
                  <span className="ml-auto flex shrink-0 gap-1.5">
                    {connectedForEntry(entry) && (
                      <span
                        title="Already in your registry"
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300"
                      >
                        <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
                        connected
                      </span>
                    )}
                    {entry.official && <Badge variant="outline" className="font-mono">official</Badge>}
                  </span>
                </CardTitle>
                <div className="flex gap-1.5 pt-1">
                  <Badge variant="secondary" className="font-mono text-[10px]">{entry.transport}</Badge>
                  <Badge variant="secondary" className="font-mono text-[10px]">{entry.category}</Badge>
                  {entry.requiresAuth && (
                    <Badge variant="outline" className="font-mono text-[10px] text-amber-400 border-amber-400/40">
                      auth
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{entry.description}</p>
                {(() => {
                  const existing = connectedForEntry(entry);
                  if (existing) {
                    return (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-auto border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                        onClick={() => openEdit(existing)}
                      >
                        ✓ Connected — Manage
                      </Button>
                    );
                  }
                  return (
                    <Button size="sm" className="mt-auto" onClick={() => openCatalogEntry(entry)}>
                      Connect
                    </Button>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Server list */}
      <div className="mt-10">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-mono text-sm text-muted-foreground uppercase">your connections</h2>
          <Button variant="outline" size="sm" onClick={openCustom}>
            + Custom Server
          </Button>
        </div>

        {/* Stats + filters */}
        <div className="mt-3 flex flex-wrap items-stretch gap-3">
          <div className="flex items-center divide-x divide-border overflow-hidden rounded-lg border border-border bg-muted/30">
            {(
              [
                ["connections", servers.length],
                ["healthy", healthyCount],
                ["in use by agents", connectedAgents.size],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="px-4 py-2">
                <div className="text-xl font-semibold tracking-tight">{value}</div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <Input
            placeholder="Search connections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-56 text-xs"
          />
          <div className="flex gap-1">
            {(["all", "healthy", "unreachable", "untested"] as StatusFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                  statusFilter === f ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Card
              key={s.id}
              className="transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-tight">
                  <McpLogo slug={s.logo_slug} name={s.name} size={20} />
                  <span className="line-clamp-1">{s.name}</span>
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {connectedAgents.has(s.id) && (
                      <Badge className="font-mono text-[10px]" variant="secondary">
                        in use
                      </Badge>
                    )}
                    {(() => {
                      const pill = statusPill(s.last_status);
                      return (
                        <span
                          title={s.last_status || "never tested"}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${pill.pill}`}
                        >
                          <span className={`inline-block size-1.5 rounded-full ${pill.dot}`} />
                          {pill.label}
                        </span>
                      );
                    })()}
                    <Badge variant="outline" className="font-mono">
                      {s.config?.transport || "unknown"}
                    </Badge>
                  </span>
                </CardTitle>
                <p className="font-mono text-[10px] text-muted-foreground truncate" title={configSummary(s)}>
                  {configSummary(s) || "—"}
                </p>
                {s.last_checked_at && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    last tested: {new Date(s.last_checked_at).toLocaleString()}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{s.description || "No description"}</p>

                {testResults[s.id] &&
                  (() => {
                    const r = testResults[s.id];
                    return (
                      <div
                        className={`mb-2 rounded-md border p-2 font-mono text-[11px] ${
                          r.healthy
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/40 bg-red-500/10 text-red-300"
                        }`}
                      >
                        {r.healthy ? (
                          <>
                            ✓ connected — {r.tool_count} tool{r.tool_count === 1 ? "" : "s"}
                            {r.tools && r.tools.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                                {r.tools.slice(0, 8).map((t) => (
                                  <span
                                    key={t}
                                    className="rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px]"
                                  >
                                    {t}
                                  </span>
                                ))}
                                {r.tools.length > 8 && (
                                  <span className="self-end px-1 text-muted-foreground">
                                    +{r.tools.length - 8}
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <>✗ {r.error || "connection failed"}</>
                        )}
                      </div>
                    );
                  })()}

                {openDiscover[s.id] && (
                  <div className="mb-2 rounded-md bg-muted p-2 font-mono text-[11px] max-h-40 overflow-y-auto">
                    {!discoverResults[s.id] ? (
                      <p className="text-muted-foreground">discovering…</p>
                    ) : discoverResults[s.id].error ? (
                      <p className="text-red-300">✗ {discoverResults[s.id].error}</p>
                    ) : (
                      <>
                        <p className="font-medium">
                          tools ({discoverResults[s.id].tools?.length || 0})
                          <span className="text-muted-foreground">
                            {" "}
                            · resources ({discoverResults[s.id].resources?.length || 0}) · prompts (
                            {discoverResults[s.id].prompts?.length || 0})
                          </span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(discoverResults[s.id].tools || []).slice(0, 12).map((t: any, i: number) => (
                            <span
                              key={i}
                              className="rounded border border-border bg-background/60 px-1.5 py-0.5"
                            >
                              {t.name || t}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testConnection(s.id)}
                    disabled={testingId === s.id}
                  >
                    {testingId === s.id ? "Testing…" : "Test"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => toggleDiscover(s.id)}>
                    {openDiscover[s.id] ? "Hide Tools" : "Tools"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => copyConfig(s)} title="Copy config JSON">
                    Copy
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteServer(s.id)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="mt-2 flex flex-col items-center rounded-lg border border-dashed border-border p-10 text-center">
            <span
              aria-hidden
              className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 font-mono text-xl font-bold text-white ring-1 ring-white/10"
            >
              ✦
            </span>
            <p className="mt-3 text-sm text-muted-foreground">
              {servers.length === 0
                ? "No connections yet — pick a famous server above, register your own, or import a JSON config."
                : "No matches for this search / filter."}
            </p>
          </div>
        )}
        {servers.length > 0 && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            tip · attach these in any agent builder via “From registry…” — the agent uses your live config on
            every run.
          </p>
        )}
      </div>
    </div>
  );
}
