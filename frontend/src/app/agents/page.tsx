"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BotIcon, CpuIcon, GlobeIcon, LayersIcon, Undo2Icon, GitBranchIcon } from "lucide-react";
import { api, getToken, AUTH_EVENT } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, EmptyState } from "@/components/ui-page";
import { AgentMonogram } from "@/components/marketplace/agent-card";
import AgentBuilder from "@/components/AgentBuilder";
import {
  Dialog,
  DialogContent,
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

interface Agent {
  id: number;
  name: string;
  description: string | null;
  slug?: string | null;
  avatar_url?: string | null;
  system_prompt: string;
  model_name: string;
  temperature: number;
  is_public: boolean;
  is_published?: boolean;
  status?: string;
  price?: number;
  tools_config?: Array<Record<string, unknown>>;
  workflow_config?: Record<string, unknown>;
}

interface AgentVersion {
  id: number;
  version_number: number;
  name: string;
  change_note?: string | null;
  system_prompt: string;
  created_at: string;
}

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [publishTarget, setPublishTarget] = useState<Agent | null>(null);
  const [publishAction, setPublishAction] = useState<"publish" | "unpublish">("publish");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const sync = async () => {
      const t = await Promise.resolve(getToken());
      setToken(t);
      setAuthed(Boolean(t));
    };
    void sync();
    window.addEventListener(AUTH_EVENT, sync);
    return () => window.removeEventListener(AUTH_EVENT, sync);
  }, []);

  const fetchAgents = useCallback(async () => {
    if (!getToken()) return;
    try {
      const data = await api<Agent[]>("/agents/");
      setAgents(data);
    } catch (e) {
      toast.error("Could not load agents", { description: (e as Error).message });
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    if (!authed || !token) {
      if (token === null && !authed && getToken() === null) {
        return; // wait for auth check to settle
      }
    }
    if (authed && token) void Promise.resolve().then(() => fetchAgents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, token]);

  // Redirect once we know this visitor is signed out.
  useEffect(() => {
    if (!authed) return;
    if (!getToken()) router.replace("/login");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const setPublishing = async (publish: boolean) => {
    if (!publishTarget) return;
    setWorking(true);
    try {
      const endpoint = publish ? "publish" : "unpublish";
      await api(`/marketplace/agents/${publishTarget.id}/${endpoint}`, { method: "POST" });
      toast.success(
        publish
          ? `${publishTarget.name} submitted for review`
          : `${publishTarget.name} removed from the marketplace`
      );
      setPublishTarget(null);
      await fetchAgents();
    } catch (e) {
      toast.error(publish ? "Publish failed" : "Unpublish failed", {
        description: (e as Error).message,
      });
    } finally {
      setWorking(false);
    }
  };

  const cloneAgent = async (id: number) => {
    try {
      await api(`/marketplace/agents/${id}/clone`, { method: "POST" });
      toast.success("Duplicated — the copy is in your workspace");
      await fetchAgents();
    } catch (e) {
      toast.error("Duplicate failed", { description: (e as Error).message });
    }
  };

  const createAgent = async (payload: Agent) => {
    if (!token) return;
    setWorking(true);
    try {
      await api("/agents/", { method: "POST", body: payload });
      toast.success("Agent created", { description: "It starts as a free draft — configure pricing when you publish." });
      setShowCreate(false);
      await fetchAgents();
    } catch (e) {
      toast.error("Failed to create agent", { description: (e as Error).message });
    } finally {
      setWorking(false);
    }
  };

  const updateAgent = async (payload: Agent) => {
    if (!token || !editingAgent) return;
    setWorking(true);
    try {
      await api(`/agents/${editingAgent.id}`, { method: "PUT", body: payload });
      toast.success("Agent updated", { description: "A version snapshot was created automatically." });
      setEditingAgent(null);
      await fetchAgents();
    } catch (e) {
      toast.error("Failed to update agent", { description: (e as Error).message });
    } finally {
      setWorking(false);
    }
  };

  const loadVersions = async (agent: Agent) => {
    try {
      const data = await api<AgentVersion[]>(`/agents/${agent.id}/versions`);
      setVersions(data);
      setSelectedAgent(agent);
      setVersionsOpen(true);
    } catch (e) {
      toast.error("Could not load versions", { description: (e as Error).message });
    }
  };

  const restoreVersion = async (agentId: number, versionId: number) => {
    try {
      await api(`/agents/${agentId}/versions/${versionId}/restore`, { method: "POST" });
      toast.success("Restored", { description: "A new version was created from the snapshot." });
      setVersionsOpen(false);
      await fetchAgents();
    } catch (e) {
      toast.error("Restore failed", { description: (e as Error).message });
    }
  };

  if (!authed) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <Skeleton className="h-9 w-48" />
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
      <PageHeader
        title="My Agents"
        description="Your digital workers. Open one to chat with it — or hand it a task to run on its own."
      >
        <Button variant="outline" render={<Link href="/marketplace" />}>
          Marketplace
        </Button>
        <Button
          onClick={() => {
            setShowCreate((v) => !v);
            setEditingAgent(null);
          }}
        >
          {showCreate ? "Cancel" : "New agent"}
        </Button>
      </PageHeader>

      {showCreate && (
        <div className="mb-8">
          <AgentBuilder onSubmit={createAgent} />
        </div>
      )}

      {editingAgent && (
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-medium tracking-tight">
              <span className="text-xs font-normal text-muted-foreground">Editing · </span>
              {editingAgent.name}
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setEditingAgent(null)}>
              Cancel edit
            </Button>
          </div>
          <AgentBuilder onSubmit={updateAgent} initial={editingAgent} />
        </div>
      )}

      {agents === null ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-7 w-40" />
            </div>
          ))}
        </div>
      ) : agents.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="transition-all hover:ring-foreground/20">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <AgentMonogram agent={{ id: agent.id, name: agent.name, avatar_url: agent.avatar_url }} />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-sm font-medium tracking-tight">
                      {agent.name}
                    </CardTitle>
                    {agent.is_published && (
                      <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                        <GlobeIcon className="size-3" /> listed on the marketplace
                      </p>
                    )}
                  </div>
                  <CardAction>
                    <Badge variant="secondary" className="text-[10px]">
                      <CpuIcon className="size-3" />
                      {agent.model_name}
                    </Badge>
                  </CardAction>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <p className="text-muted-foreground line-clamp-2 mb-3 text-sm">
                  {agent.description || "No description"}
                </p>
                <div className="text-muted-foreground mb-4 flex flex-wrap items-center gap-1.5">
                  {agent.tools_config && agent.tools_config.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {agent.tools_config.length} tool{agent.tools_config.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {String(agent.workflow_config?.["type"] ?? "single") !== "single" && (
                    <Badge variant="outline" className="text-[10px]">
                      <LayersIcon className="size-3" /> team
                    </Badge>
                  )}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" render={<Link href={`/agents/${agent.id}`} />}>
                    Open
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingAgent(agent)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPublishAction(agent.is_published ? "unpublish" : "publish");
                      setPublishTarget(agent);
                    }}
                  >
                    {agent.is_published ? "Unpublish" : "Publish…"}
                  </Button>
                </div>
                <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-[11px]">
                  <Link
                    href={`/agents/${agent.id}/evaluations`}
                    className="flex items-center gap-1 transition-colors hover:text-foreground"
                  >
                    Quality checks
                  </Link>
                  <button
                    className="flex items-center gap-1 transition-colors hover:text-foreground"
                    onClick={() => loadVersions(agent)}
                  >
                    <GitBranchIcon className="size-3" /> Versions
                  </button>
                  <button
                    className="flex items-center gap-1 transition-colors hover:text-foreground"
                    onClick={() => cloneAgent(agent.id)}
                  >
                    <Undo2Icon className="size-3" /> Duplicate
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : agents.length === 0 && !showCreate && !editingAgent ? (
        <EmptyState
          icon={<BotIcon className="size-5" />}
          title="No agents yet"
          hint="Create your first agent from a template, or grab a ready-made one from the marketplace."
          actionLabel="New agent"
          onAction={() => setShowCreate(true)}
        />
      ) : null}

      {/* versions dialog */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Versions · {selectedAgent?.name ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {versions.map((v, i) => (
              <div
                key={v.id}
                className="ring-foreground/10 flex items-start justify-between gap-3 rounded-lg bg-card px-3 py-2.5 ring-1"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] ring-1 ${
                        i === 0
                          ? "bg-brand/10 text-brand ring-brand/20"
                          : "bg-muted text-muted-foreground ring-border"
                      }`}
                    >
                      v{v.version_number}
                    </span>
                    {v.name}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {v.change_note || "no note"} ·{" "}
                    {new Date(v.created_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <p className="text-muted-foreground/70 mt-1 line-clamp-2 text-[11px]">
                    {v.system_prompt.slice(0, 140)}
                  </p>
                </div>
                {i !== 0 && (
                  <Button size="sm" variant="outline" onClick={() => selectedAgent && restoreVersion(selectedAgent.id, v.id)}>
                    Restore
                  </Button>
                )}
              </div>
            ))}
            {versions.length === 0 && (
              <p className="text-muted-foreground py-4 text-center text-sm">
                No versions yet — every edit creates a snapshot automatically.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* publish/unpublish confirm */}
      <AlertDialog
        open={Boolean(publishTarget)}
        onOpenChange={(open) => !open && setPublishTarget(null)}
      >
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {publishAction === "publish"
                ? `Publish “${publishTarget?.name}”?`
                : `Unpublish “${publishTarget?.name}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {publishAction === "publish"
                ? "Publishing makes the listing publicly discoverable — buyers then run it under your configured plan. If manual review is enabled, it goes to review first."
                : "The listing stops being discoverable immediately. Buyers who already own it keep their access."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={publishAction === "unpublish" ? "destructive" : "default"}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
                void setPublishing(publishAction === "publish");
              }}
              disabled={working}
            >
              {working ? "Working…" : publishAction === "publish" ? "Publish listing" : "Unpublish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* (versions/publish dialogs above) */}
    </div>
  );
}
