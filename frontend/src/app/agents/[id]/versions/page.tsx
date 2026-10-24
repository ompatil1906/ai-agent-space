"use client";

/**
 * Agent version history. Every save (auto or manual) snapshots the full agent
 * config; restoring re-applies an old snapshot by creating a NEW version, so
 * history is append-only and nothing is ever overwritten.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PageHeader, EmptyState } from "@/components/ui-page";
import { api, getToken, messageFromError, useApiQuery } from "@/lib/api";
import { cn } from "cn";

interface AgentVersion {
  id: number;
  agent_id: number;
  version_number: number;
  name: string;
  description?: string | null;
  system_prompt: string;
  model_name: string;
  temperature: number;
  tools_config: unknown[];
  memory_config: unknown;
  workflow_config: unknown;
  max_steps?: number | null;
  autonomy_level?: string | null;
  sandbox_enabled?: boolean | null;
  advanced_config?: unknown;
  change_note?: string | null;
  created_at: string;
}

interface AgentIdentity {
  name?: string | null;
  model_name?: string | null;
}

/** "2 days ago" relative timestamp, with the absolute time as a title. */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function fullDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function workflowSummary(v: AgentVersion): string {
  const wf = (v.workflow_config ?? {}) as Record<string, unknown>;
  const type = typeof wf.type === "string" ? wf.type : "single";
  if (type === "hierarchical") {
    return `hierarchical (${Array.isArray(wf.teams) ? wf.teams.length : 0} teams)`;
  }
  if (type !== "single") {
    const workers = Array.isArray(wf.sub_agents)
      ? wf.sub_agents
      : Array.isArray(wf.workers)
        ? wf.workers
        : [];
    return `${type} (${workers.length} agents)`;
  }
  return "single";
}

function VersionsContent() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<AgentIdentity | null>(null);

  // snapshot-now dialog
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [changeNote, setChangeNote] = useState("Manual snapshot");
  const [creating, setCreating] = useState(false);

  // restore confirm + detail dialog
  const [restoreTarget, setRestoreTarget] = useState<AgentVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [selected, setSelected] = useState<AgentVersion | null>(null);

  // Auth gate — preserve the redirect-to-login entry flow. The token is
  // deferred one tick so no state is set synchronously inside the effect.
  useEffect(() => {
    const t = getToken();
    if (!t) {
      window.location.href = "/login";
      return;
    }
    const timer = window.setTimeout(() => setToken(t), 0);
    return () => window.clearTimeout(timer);
  }, [agentId]);

  const {
    data: versions,
    loading: versionsLoading,
    error: versionsError,
    reload,
  } = useApiQuery<AgentVersion[]>(token ? `/agents/${agentId}/versions` : null);

  // Agent identity (name/model) — best-effort, never blocks the page.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api<AgentIdentity>(`/agents/${agentId}`, { signal: controller.signal })
      .then(setIdentity)
      .catch(() => {});
    return () => controller.abort();
  }, [token, agentId]);

  const createSnapshot = async () => {
    setCreating(true);
    try {
      await api<AgentVersion>(`/agents/${agentId}/versions`, {
        method: "POST",
        body: { change_note: changeNote },
      });
      toast.success("Snapshot created", {
        description: `Saved as a new version — ${changeNote.trim() || "Manual snapshot"}`,
      });
      setSnapshotOpen(false);
      setChangeNote("Manual snapshot");
      reload();
    } catch (e: unknown) {
      toast.error("Could not create snapshot", {
        description: messageFromError(e),
      });
    } finally {
      setCreating(false);
    }
  };

  const confirmRestore = async () => {
    const target = restoreTarget;
    if (!target) return;
    setRestoring(true);
    try {
      await api<unknown>(
        `/agents/${agentId}/versions/${target.id}/restore`,
        { method: "POST" }
      );
      toast.success("Version restored", {
        description: `The agent now runs the config from v${target.version_number}.`,
      });
      setRestoreTarget(null);
      router.push(`/agents/${agentId}`);
    } catch (e: unknown) {
      toast.error("Restore failed", { description: messageFromError(e) });
    } finally {
      setRestoring(false);
    }
  };

  const agentName = identity?.name?.trim() || `Agent #${agentId}`;
  const latestNumber = versions?.[0]?.version_number;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* breadcrumbs — back to the agent list + into the agent console */}
      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Link href="/agents" className="hover:text-foreground">
          ← back to agent list
        </Link>
        <span aria-hidden className="text-muted-foreground/50">/</span>
        <Link href={`/agents/${agentId}`} className="min-w-0 truncate hover:text-foreground">
          {agentName}
        </Link>
        <span aria-hidden className="text-muted-foreground/50">/</span>
        <span className="text-foreground">versions</span>
      </nav>

      <PageHeader
        eyebrow={`agent · ${agentName}`}
        title="Version history"
        description="Append-only snapshots of the agent's full configuration. Restore any previous state — it creates a new version and never overwrites history."
      >
        <Button variant="outline" render={<Link href={`/agents/${agentId}`} />}>
          Open console
        </Button>
        <Button onClick={() => setSnapshotOpen(true)}>Snapshot now</Button>
      </PageHeader>

      <div className="mb-1 flex flex-wrap items-center gap-2">
        {identity?.model_name && (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {identity.model_name}
          </Badge>
        )}
        <Badge variant="outline" className="font-mono text-[10px]">
          agent #{agentId}
        </Badge>
      </div>

      {/* ------------------------------------------------------- list */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] tracking-widest text-muted-foreground/70 uppercase">
          snapshots · newest first
        </p>
        {token && !versionsLoading && !versionsError && (
          <p className="font-mono text-xs text-muted-foreground">
            {versions?.length ?? 0} version{(versions?.length ?? 0) === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {versionsError ? (
        <div className="rounded-xl border border-dashed border-border px-8 py-14 text-center">
          <p className="font-medium">Couldn’t load versions</p>
          <p className="text-muted-foreground mt-1 text-sm">{versionsError}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={reload}
            disabled={versionsLoading}
          >
            Retry
          </Button>
        </div>
      ) : !token || (versionsLoading && versions === null) ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px] w-full rounded-lg" />
          ))}
        </div>
      ) : !versions || versions.length === 0 ? (
        <EmptyState
          title="No versions yet"
          hint="A snapshot is taken automatically whenever the agent is created or updated — or take one now."
          actionLabel="Snapshot now"
          onAction={() => setSnapshotOpen(true)}
        />
      ) : (
        <div className="space-y-2">
          {versions.map((v) => {
            const isLatest = v.version_number === latestNumber;
            return (
              <div
                key={v.id}
                className={cn(
                  "border-l-2 rounded-lg bg-card px-4 py-3.5 ring-1 transition-all hover:ring-foreground/20",
                  isLatest ? "border-l-brand ring-brand/25" : "border-l-transparent ring-foreground/10"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-2 py-0.5 font-mono text-xs font-medium ring-1",
                        isLatest
                          ? "bg-brand/10 text-brand ring-brand/30"
                          : "bg-muted text-foreground ring-foreground/10"
                      )}
                    >
                      v{v.version_number}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {v.change_note?.trim() ? (
                        v.change_note
                      ) : (
                        <span className="text-muted-foreground">No change note</span>
                      )}
                    </p>
                    {isLatest && (
                      <span className="shrink-0 rounded-4xl bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand ring-1 ring-brand/25">
                        latest
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className="hidden font-mono text-[11px] text-muted-foreground sm:inline"
                      title={fullDate(v.created_at)}
                    >
                      {timeAgo(v.created_at)}
                    </span>
                    <Button size="xs" variant="outline" onClick={() => setSelected(v)}>
                      Details
                    </Button>
                    {!isLatest && (
                      <Button
                        size="xs"
                        onClick={() => setRestoreTarget(v)}
                        disabled={restoring}
                      >
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span>
                    model <span className="text-foreground">{v.model_name}</span>
                  </span>
                  <span>
                    temp <span className="text-foreground">{v.temperature}</span>
                  </span>
                  <span>
                    workflow <span className="text-foreground">{workflowSummary(v)}</span>
                  </span>
                  <span>
                    tools <span className="text-foreground">{v.tools_config.length}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ----------------------------------------- snapshot-now dialog */}
      <Dialog open={snapshotOpen} onOpenChange={setSnapshotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snapshot now</DialogTitle>
            <DialogDescription>
              Captures the agent’s current configuration as a new append-only version.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="change-note">Change note (optional)</Label>
            <Input
              id="change-note"
              placeholder="What changed in this version?"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSnapshotOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={createSnapshot} disabled={creating}>
              {creating ? "Creating…" : "Create snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------- restore confirm */}
      <AlertDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open && !restoring) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore version v{restoreTarget?.version_number}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Restoring re-applies this snapshot to the agent’s live configuration.
              History is append-only — it creates a NEW version from this snapshot
              rather than overwriting any existing version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore} disabled={restoring}>
              {restoring ? "Restoring…" : "Restore version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --------------------------------------------------- details */}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              v{selected?.version_number} · {selected?.change_note?.trim() || "No change note"}
            </DialogTitle>
            <DialogDescription>
              {selected && `${fullDate(selected.created_at)} · ${timeAgo(selected.created_at)}`}
            </DialogDescription>
          </DialogHeader>
          {selected && <SnapshotDetails version={selected} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Rendered only while the detail dialog is open, so the pretty-printed
 * snapshot JSON is computed lazily on open. */
function SnapshotDetails({ version }: { version: AgentVersion }) {
  const meta: Array<[string, string]> = useMemo(
    () => [
      ["Model", version.model_name],
      ["Temperature", String(version.temperature)],
      ["Workflow", workflowSummary(version)],
      ["Tools", String(version.tools_config.length)],
      ["Autonomy", version.autonomy_level ?? "default"],
      ["Max steps", version.max_steps != null ? String(version.max_steps) : "—"],
      ["Sandbox", version.sandbox_enabled ? "enabled" : "off"],
    ],
    [version]
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        {meta.map(([k, val]) => (
          <div key={k} className="min-w-0">
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
              {k}
            </p>
            <p className="mt-0.5 truncate font-medium">{val}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
          snapshot json
        </p>
        <ScrollArea className="h-64 rounded-lg bg-muted/40 ring-1 ring-foreground/10">
          <pre className="block w-max min-w-full p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
            {JSON.stringify(version, null, 2)}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
}

export default function VersionsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[74px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <VersionsContent />
    </Suspense>
  );
}
