"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface ToolConfig {
  name: string;
  transport: "stdio" | "streamable_http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
}

interface SubAgent {
  name: string;
  description: string;
  system_prompt: string;
}

interface AgentBuilderProps {
  onSubmit: (payload: any) => Promise<void>;
  initial?: Partial<any>;
}

export default function AgentBuilder({ onSubmit, initial }: AgentBuilderProps) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [systemPrompt, setSystemPrompt] = useState(
    initial?.system_prompt || "You are a helpful AI assistant. You have access to tools when configured."
  );
  const [modelName, setModelName] = useState(initial?.model_name || "gpt-4o-mini");
  const [temperature, setTemperature] = useState(initial?.temperature || 0.7);
  const [tools, setTools] = useState<ToolConfig[]>(initial?.tools_config || []);
  const [memoryEnabled, setMemoryEnabled] = useState(initial?.memory_config?.enabled ?? true);
  const [workflowType, setWorkflowType] = useState<"single" | "sequential" | "supervisor">(
    initial?.workflow_config?.type || "single"
  );
  const [subAgents, setSubAgents] = useState<SubAgent[]>(
    initial?.workflow_config?.sub_agents || initial?.workflow_config?.workers || []
  );
  const [loading, setLoading] = useState(false);

  const addTool = () => {
    setTools([...tools, { name: `tool_${tools.length + 1}`, transport: "stdio", command: "python", args: [] }]);
  };

  const updateTool = (index: number, updates: Partial<ToolConfig>) => {
    const next = [...tools];
    next[index] = { ...next[index], ...updates };
    setTools(next);
  };

  const removeTool = (index: number) => {
    setTools(tools.filter((_, i) => i !== index));
  };

  const addSubAgent = () => {
    setSubAgents([
      ...subAgents,
      { name: `specialist_${subAgents.length + 1}`, description: "Specialist agent", system_prompt: "You are a specialist." },
    ]);
  };

  const updateSubAgent = (index: number, updates: Partial<SubAgent>) => {
    const next = [...subAgents];
    next[index] = { ...next[index], ...updates };
    setSubAgents(next);
  };

  const removeSubAgent = (index: number) => {
    setSubAgents(subAgents.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const tools_config = tools.map((t) => {
        const cfg: any = { name: t.name, transport: t.transport };
        if (t.transport === "stdio") {
          cfg.command = t.command || "python";
          cfg.args = t.args || [];
        } else {
          cfg.url = t.url || "";
        }
        return cfg;
      });

      const workflow_config: any = { type: workflowType };
      if (workflowType !== "single") {
        workflow_config.sub_agents = subAgents;
        if (workflowType === "supervisor") {
          workflow_config.workers = subAgents;
        }
      }

      const payload = {
        name,
        description,
        system_prompt: systemPrompt,
        model_name: modelName,
        temperature,
        tools_config,
        memory_config: { enabled: memoryEnabled },
        workflow_config,
      };

      await onSubmit(payload);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Builder</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium">Model</label>
              <Input value={modelName} onChange={(e) => setModelName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">System Prompt</label>
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4} />
          </div>
          <div>
            <label className="text-sm font-medium">Temperature: {temperature}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="memory"
              checked={memoryEnabled}
              onChange={(e) => setMemoryEnabled(e.target.checked)}
            />
            <label htmlFor="memory" className="text-sm font-medium">
              Enable conversation memory (thread-based)
            </label>
          </div>

          <div>
            <label className="text-sm font-medium">Workflow Type</label>
            <Select value={workflowType} onValueChange={(v: any) => setWorkflowType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single Agent</SelectItem>
                <SelectItem value="sequential">Sequential Multi-Agent</SelectItem>
                <SelectItem value="supervisor">Supervisor Multi-Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {workflowType !== "single" && (
            <div className="space-y-4 border rounded-lg p-4">
              <div className="flex justify-between items-center">
                <h3 className="font-medium">Sub-Agents / Workers</h3>
                <Button type="button" size="sm" variant="outline" onClick={addSubAgent}>
                  Add Sub-Agent
                </Button>
              </div>
              {subAgents.map((sa, i) => (
                <div key={i} className="border rounded p-3 space-y-2">
                  <div className="flex justify-between">
                    <Badge>Sub-Agent {i + 1}</Badge>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeSubAgent(i)}>
                      Remove
                    </Button>
                  </div>
                  <Input
                    placeholder="Name"
                    value={sa.name}
                    onChange={(e) => updateSubAgent(i, { name: e.target.value })}
                  />
                  <Input
                    placeholder="Description"
                    value={sa.description}
                    onChange={(e) => updateSubAgent(i, { description: e.target.value })}
                  />
                  <Textarea
                    placeholder="System Prompt"
                    value={sa.system_prompt}
                    onChange={(e) => updateSubAgent(i, { system_prompt: e.target.value })}
                    rows={3}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-4 border rounded-lg p-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">MCP Tools</h3>
              <Button type="button" size="sm" variant="outline" onClick={addTool}>
                Add MCP Server
              </Button>
            </div>
            {tools.map((tool, i) => (
              <div key={i} className="border rounded p-3 space-y-2">
                <div className="flex justify-between">
                  <Badge variant="secondary">Tool {i + 1}</Badge>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeTool(i)}>
                    Remove
                  </Button>
                </div>
                <Input
                  placeholder="Name"
                  value={tool.name}
                  onChange={(e) => updateTool(i, { name: e.target.value })}
                />
                <Select
                  value={tool.transport}
                  onValueChange={(v: any) => updateTool(i, { transport: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio</SelectItem>
                    <SelectItem value="streamable_http">streamable_http</SelectItem>
                    <SelectItem value="sse">sse</SelectItem>
                  </SelectContent>
                </Select>
                {tool.transport === "stdio" ? (
                  <>
                    <Input
                      placeholder="Command (e.g. python)"
                      value={tool.command || ""}
                      onChange={(e) => updateTool(i, { command: e.target.value })}
                    />
                    <Input
                      placeholder="Args (space separated)"
                      value={(tool.args || []).join(" ")}
                      onChange={(e) => updateTool(i, { args: e.target.value.split(" ").filter(Boolean) })}
                    />
                  </>
                ) : (
                  <Input
                    placeholder="URL (e.g. http://localhost:8001/mcp)"
                    value={tool.url || ""}
                    onChange={(e) => updateTool(i, { url: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>

          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Agent"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
