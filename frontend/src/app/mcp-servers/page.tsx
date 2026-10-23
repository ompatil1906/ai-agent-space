"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { API_BASE } from "@/lib/api";

interface MCPServer {
  id: number;
  name: string;
  description: string | null;
  config: any;
  is_public: boolean;
  created_at: string;
}

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<"stdio" | "streamable_http" | "sse">("stdio");
  const [command, setCommand] = useState("python");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

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

  const createServer = async () => {
    setLoading(true);
    try {
      const config: any = { name, transport };
      if (transport === "stdio") {
        config.command = command;
        config.args = args.split(/\s+/).filter(Boolean);
      } else {
        config.url = url;
      }
      const res = await fetch(`${API_BASE}/mcp-servers/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, description, config }),
      });
      if (res.ok) {
        setShowCreate(false);
        setName("");
        setDescription("");
        setArgs("");
        setUrl("");
        load();
      } else {
        const err = await res.json();
        alert(err.detail || "Failed to create");
      }
    } finally {
      setLoading(false);
    }
  };

  const deleteServer = async (id: number) => {
    if (!confirm("Delete this MCP server?")) return;
    await fetch(`${API_BASE}/mcp-servers/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  };

  const discover = async (id: number) => {
    const res = await fetch(`${API_BASE}/mcp-servers/${id}/discover`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      alert(
        `Tools: ${data.tools?.length || 0}\nResources: ${data.resources?.length || 0}\nPrompts: ${data.prompts?.length || 0}`
      );
    } else {
      alert("Discovery failed (is the server reachable?)");
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">MCP Server Registry</h1>
          <p className="text-muted-foreground">Save reusable MCP server configurations for your agents.</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger render={<Button>Register Server</Button>} />
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Register MCP Server</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Textarea
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <Select value={transport} onValueChange={(v: any) => setTransport(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio (local command)</SelectItem>
                  <SelectItem value="streamable_http">streamable_http</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
              {transport === "stdio" ? (
                <>
                  <Input placeholder="Command (e.g. python)" value={command} onChange={(e) => setCommand(e.target.value)} />
                  <Input placeholder="Args (space-separated)" value={args} onChange={(e) => setArgs(e.target.value)} />
                </>
              ) : (
                <Input placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
              )}
              <Button onClick={createServer} disabled={loading || !name}>
                {loading ? "Validating..." : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {servers.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                {s.name}
                <Badge variant="outline">{s.config?.transport || "unknown"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">{s.description || "No description"}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => discover(s.id)}>
                  Discover
                </Button>
                <Button size="sm" variant="destructive" onClick={() => deleteServer(s.id)}>
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {servers.length === 0 && (
          <p className="text-muted-foreground col-span-full">No MCP servers registered yet.</p>
        )}
      </div>
    </div>
  );
}
