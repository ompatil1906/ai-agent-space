"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { API_BASE } from "@/lib/api";

interface AgentVersion {
  id: number;
  agent_id: number;
  version_number: number;
  name: string;
  description?: string;
  system_prompt: string;
  model_name: string;
  temperature: number;
  tools_config: any[];
  memory_config: any;
  workflow_config: any;
  max_steps?: number;
  autonomy_level?: string;
  sandbox_enabled?: boolean;
  advanced_config?: any;
  change_note?: string;
  created_at: string;
}

function VersionsContent() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;
  const [token, setToken] = useState<string | null>(null);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [changeNote, setChangeNote] = useState("Manual snapshot");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<AgentVersion | null>(null);

  useEffect(() => {
    const t = localStorage.getItem("token");
    if (!t) {
      window.location.href = "/login";
      return;
    }
    setToken(t);
    loadVersions(t);
  }, [agentId]);

  const loadVersions = async (t: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}/versions`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = await res.json();
        setVersions(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const restoreVersion = async (versionId: number) => {
    if (!token || !confirm("Restore this version? A new snapshot of the current state will be created first.")) return;
    setRestoringId(versionId);
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}/versions/${versionId}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        alert("Version restored successfully. Redirecting to agent...");
        router.push(`/agents/${agentId}`);
      } else {
        const err = await res.text();
        alert(`Restore failed: ${err}`);
      }
    } catch (e) {
      alert(String(e));
    } finally {
      setRestoringId(null);
    }
  };

  const createSnapshot = async () => {
    if (!token) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}/versions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ change_note: changeNote }),
      });
      if (res.ok) {
        setShowCreate(false);
        setChangeNote("Manual snapshot");
        await loadVersions(token);
      } else {
        alert(await res.text());
      }
    } catch (e) {
      alert(String(e));
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const workflowSummary = (v: AgentVersion) => {
    const wf = v.workflow_config || {};
    const type = wf.type || "single";
    if (type === "hierarchical") return `hierarchical (${(wf.teams || []).length} teams)`;
    if (type !== "single") return `${type} (${(wf.sub_agents || wf.workers || []).length} agents)`;
    return "single";
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent Versions</h1>
          <p className="text-muted-foreground mt-1">
            Full history of configuration snapshots. Restore any previous state.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/agents/${agentId}`} className={buttonVariants({ variant: "outline" })}>
            ← Back to Agent
          </Link>
          <Button onClick={() => setShowCreate(true)}>Create Snapshot</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading versions...</div>
      ) : versions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No versions yet. Versions are created automatically on create/update, or manually below.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {versions.map((v) => (
            <Card key={v.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      v{v.version_number}
                      {v.version_number === versions[0]?.version_number && (
                        <Badge variant="secondary">Current</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {formatDate(v.created_at)} · {v.change_note || "No note"}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setSelected(v)}>
                      Details
                    </Button>
                    {v.version_number !== versions[0]?.version_number && (
                      <Button
                        size="sm"
                        onClick={() => restoreVersion(v.id)}
                        disabled={restoringId === v.id}
                      >
                        {restoringId === v.id ? "Restoring..." : "Restore"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>Model: <span className="text-foreground">{v.model_name}</span></div>
                <div>Temp: <span className="text-foreground">{v.temperature}</span></div>
                <div>Workflow: <span className="text-foreground">{workflowSummary(v)}</span></div>
                <div>Tools: <span className="text-foreground">{(v.tools_config || []).length}</span></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Snapshot Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Manual Snapshot</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium">Change note</label>
            <Textarea
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="What changed in this version?"
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createSnapshot} disabled={creating}>
              {creating ? "Creating..." : "Create Snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Version {selected?.version_number} Details</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div>
                <div className="font-medium">System Prompt</div>
                <pre className="mt-1 p-3 bg-muted rounded-md whitespace-pre-wrap text-xs">{selected.system_prompt}</pre>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="font-medium">Workflow Config</div>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-auto max-h-48">{JSON.stringify(selected.workflow_config, null, 2)}</pre>
                </div>
                <div>
                  <div className="font-medium">Tools Config</div>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-xs overflow-auto max-h-48">{JSON.stringify(selected.tools_config, null, 2)}</pre>
                </div>
              </div>
              <div>
                <div className="font-medium">Memory Config</div>
                <pre className="mt-1 p-3 bg-muted rounded-md text-xs">{JSON.stringify(selected.memory_config, null, 2)}</pre>
              </div>
              {selected.advanced_config && Object.keys(selected.advanced_config).length > 0 && (
                <div>
                  <div className="font-medium">Advanced Config</div>
                  <pre className="mt-1 p-3 bg-muted rounded-md text-xs">{JSON.stringify(selected.advanced_config, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function VersionsPage() {
  return (
    <Suspense fallback={<div className="container py-8">Loading...</div>}>
      <VersionsContent />
    </Suspense>
  );
}
