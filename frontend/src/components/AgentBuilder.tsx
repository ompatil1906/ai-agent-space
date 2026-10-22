"use client";

import { useState, useEffect } from "react";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { API_BASE } from "@/lib/api";

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
  // Nested support for hierarchical teams
  team_workflow_type?: "single" | "sequential" | "supervisor" | "parallel" | "debate" | "map_reduce";
  specialists?: SubAgent[];
}

interface AgentBuilderProps {
  onSubmit: (payload: any) => Promise<void>;
  initial?: Partial<any>;
}


const TEMPLATES = [
  {
    name: "Research Assistant",
    description: "Web research with tool use and structured summaries",
    system_prompt: "You are an expert research assistant. Use tools to gather information, then synthesize clear, cited answers. Prefer primary sources.",
    model_name: "gpt-4o-mini",
    workflow_type: "single" as const,
    longterm_enabled: true,
  },
  {
    name: "Code Reviewer",
    description: "Multi-agent code review: security, style, and correctness",
    system_prompt: "You coordinate specialists to review code for bugs, security issues, and style. Provide actionable feedback.",
    model_name: "gpt-4o",
    workflow_type: "supervisor" as const,
  },
  {
    name: "Debate Moderator",
    description: "Two-sided debate on any topic with a final synthesis",
    system_prompt: "You moderate a structured debate between pro and con specialists, then produce a balanced summary.",
    model_name: "gpt-4o-mini",
    workflow_type: "debate" as const,
  },
];

const DEFAULT_PROMPT = "You are a helpful AI assistant. You have access to tools when configured.";

export default function AgentBuilder({ onSubmit, initial }: AgentBuilderProps) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt || DEFAULT_PROMPT);
  const [modelName, setModelName] = useState(initial?.model_name || "gpt-4o-mini");
  const [temperature, setTemperature] = useState(initial?.temperature || 0.7);
  const [tools, setTools] = useState<ToolConfig[]>(initial?.tools_config || []);
  const [registeredServers, setRegisteredServers] = useState<any[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [memoryEnabled, setMemoryEnabled] = useState(initial?.memory_config?.enabled ?? true);
  const [maxMessages, setMaxMessages] = useState<number>(initial?.memory_config?.max_messages ?? 20);
  const [longtermEnabled, setLongtermEnabled] = useState(initial?.memory_config?.longterm_enabled ?? false);
  const [longtermK, setLongtermK] = useState<number>(initial?.memory_config?.longterm_k ?? 5);
  const [sharedMemory, setSharedMemory] = useState(initial?.memory_config?.shared ?? false);
  const [workflowType, setWorkflowType] = useState<"single" | "sequential" | "supervisor" | "parallel" | "debate" | "map_reduce" | "consensus" | "hierarchical">(
    initial?.workflow_config?.type || "single"
  );
  const [subAgents, setSubAgents] = useState<SubAgent[]>(() => {
    const wf = initial?.workflow_config || {};
    if (wf.type === "hierarchical" && Array.isArray(wf.teams)) {
      return wf.teams.map((t: any) => ({
        name: String(t.name ?? "team"),
        description: String(t.description ?? ""),
        system_prompt: String(t.system_prompt ?? "You lead this team."),
        team_workflow_type: (t.workflow?.type as any) || "supervisor",
        specialists: (t.workflow?.sub_agents || t.workflow?.workers || []).map((s: any) => ({
          name: String(s.name ?? "specialist"),
          description: String(s.description ?? ""),
          system_prompt: String(s.system_prompt ?? "You are a specialist."),
        })),
      }));
    }
    return wf.sub_agents || wf.workers || [];
  });
  // Execution / autonomy controls
  const [maxSteps, setMaxSteps] = useState<number>(initial?.max_steps ?? 25);
  const [autonomyLevel, setAutonomyLevel] = useState<string>(initial?.autonomy_level || "supervised");
  const [sandboxEnabled, setSandboxEnabled] = useState<boolean>(initial?.sandbox_enabled ?? false);
  const [planningEnabled, setPlanningEnabled] = useState<boolean>(initial?.advanced_config?.planning_enabled ?? false);
  const [reflectEnabled, setReflectEnabled] = useState<boolean>(initial?.advanced_config?.reflection_enabled ?? false);
  const [maxReflections, setMaxReflections] = useState<number>(initial?.advanced_config?.max_reflections ?? 2);
  const [structuredEnabled, setStructuredEnabled] = useState<boolean>(initial?.advanced_config?.structured_output_enabled ?? false);
  const [outputSchemaText, setOutputSchemaText] = useState<string>(
    initial?.advanced_config?.output_schema ? JSON.stringify(initial.advanced_config.output_schema, null, 2) : '{\n  "type": "object",\n  "properties": {\n    "answer": { "type": "string" },\n    "confidence": { "type": "number" }\n  },\n  "required": ["answer"]\n}'
  );
  const [toolChoice, setToolChoice] = useState<string>(initial?.advanced_config?.tool_choice ?? "auto");

  // YAML editor
  const [editorMode, setEditorMode] = useState<"visual" | "yaml">("visual");
  const [yamlText, setYamlText] = useState<string>("");
  const [yamlError, setYamlError] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredTools, setDiscoveredTools] = useState<any[]>([]);
  const [discoveringResources, setDiscoveringResources] = useState(false);
  const [discoveredResources, setDiscoveredResources] = useState<any[]>([]);
  const [discoveringPrompts, setDiscoveringPrompts] = useState(false);
  const [discoveredPrompts, setDiscoveredPrompts] = useState<any[]>([]);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  const buildWorkflowConfig = (): any => {
    const workflow_config: any = { type: workflowType };
    if (workflowType === "hierarchical") {
      workflow_config.teams = subAgents.map((sa) => ({
        name: sa.name,
        description: sa.description,
        system_prompt: sa.system_prompt,
        workflow: {
          type: sa.team_workflow_type || "supervisor",
          sub_agents: (sa.specialists || []).map((sp) => ({
            name: sp.name,
            description: sp.description,
            system_prompt: sp.system_prompt,
          })),
        },
      }));
    } else if (workflowType !== "single") {
      const flat = subAgents.map(({ name, description, system_prompt }) => ({
        name,
        description,
        system_prompt,
      }));
      workflow_config.sub_agents = flat;
      if (workflowType === "supervisor") {
        workflow_config.workers = flat;
      }
    }
    return workflow_config;
  };

  const buildPayload = () => ({
    name,
    description,
    system_prompt: systemPrompt,
    model_name: modelName,
    temperature,
    tools_config: serializeTools(),
    memory_config: {
      enabled: memoryEnabled,
      max_messages: maxMessages,
      type: longtermEnabled ? "hybrid" : "window",
      longterm_enabled: longtermEnabled,
      longterm_k: longtermK,
      shared: sharedMemory,
    },
    workflow_config: buildWorkflowConfig(),
    max_steps: maxSteps,
    autonomy_level: autonomyLevel,
    sandbox_enabled: sandboxEnabled,
    advanced_config: {
      planning_enabled: planningEnabled,
      reflection_enabled: reflectEnabled,
      max_reflections: maxReflections,
    },
  });

  const serializeTools = (): any[] =>
    tools.map((t) => {
      const cfg: any = { name: t.name, transport: t.transport };
      if (t.transport === "stdio") {
        cfg.command = t.command || "python";
        cfg.args = t.args || [];
      } else {
        cfg.url = t.url || "";
      }
      return cfg;
    });

  const agentToYaml = (): string =>
    yamlDump(
      {
        name,
        description,
        system_prompt: systemPrompt,
        model_name: modelName,
        temperature,
        memory: {
          enabled: memoryEnabled,
          max_messages: maxMessages,
          longterm: { enabled: longtermEnabled, k: longtermK, shared: sharedMemory },
        },
        workflow: buildWorkflowConfig(),
        execution: {
          max_steps: maxSteps,
          autonomy_level: autonomyLevel,
          sandbox_enabled: sandboxEnabled,
          planning_enabled: planningEnabled,
          reflection_enabled: reflectEnabled,
          max_reflections: maxReflections,
          structured_output_enabled: structuredEnabled,
          output_schema: (() => { try { return JSON.parse(outputSchemaText || "{}"); } catch { return null; } })(),
          tool_choice: toolChoice,
        },
        tools: serializeTools(),
      },
      { lineWidth: 120 }
    );

  const applyYaml = (text: string): boolean => {
    try {
      const doc = yamlLoad(text) as any;
      if (!doc || typeof doc !== "object") throw new Error("Document must be a mapping");
      if (typeof doc.name !== "string" || !doc.name) throw new Error("'name' is required");
      setName(doc.name);
      setDescription(doc.description ?? description);
      setSystemPrompt(doc.system_prompt ?? systemPrompt);
      setModelName(doc.model_name ?? modelName);
      if (typeof doc.temperature === "number") setTemperature(doc.temperature);
      const mem = doc.memory || {};
      setMemoryEnabled(mem.enabled ?? true);
      setMaxMessages(Number(mem.max_messages ?? 20));
      setLongtermEnabled(mem.longterm?.enabled ?? false);
      setLongtermK(Number(mem.longterm?.k ?? 5));
      setSharedMemory(!!mem.longterm?.shared);
      const wf = doc.workflow || {};
      const types = ["single", "sequential", "supervisor", "parallel", "debate", "map_reduce", "consensus", "hierarchical"];
      if (wf.type && types.includes(wf.type)) setWorkflowType(wf.type);
      if (wf.type === "hierarchical" && Array.isArray(wf.teams)) {
        setSubAgents(
          wf.teams.map((t: any) => ({
            name: String(t.name ?? "team"),
            description: String(t.description ?? ""),
            system_prompt: String(t.system_prompt ?? "You lead this team."),
            team_workflow_type: (t.workflow?.type as any) || "supervisor",
            specialists: (t.workflow?.sub_agents || t.workflow?.workers || []).map((s: any) => ({
              name: String(s.name ?? "specialist"),
              description: String(s.description ?? ""),
              system_prompt: String(s.system_prompt ?? "You are a specialist."),
            })),
          }))
        );
      } else {
        const subs = wf.sub_agents || wf.workers || [];
        setSubAgents(
          subs.map((sa: any) => ({
            name: String(sa.name ?? "agent"),
            description: String(sa.description ?? ""),
            system_prompt: String(sa.system_prompt ?? "You are a specialist."),
          }))
        );
      }
      const ex = doc.execution || {};
      setMaxSteps(Number(ex.max_steps ?? 25));
      setAutonomyLevel(ex.autonomy_level ?? "supervised");
      setSandboxEnabled(Boolean(ex.sandbox_enabled));
      setPlanningEnabled(Boolean(ex.planning_enabled ?? (ex.autonomy_level && ex.autonomy_level !== "supervised")));
      setReflectEnabled(Boolean(ex.reflection_enabled));
      setMaxReflections(Number(ex.max_reflections ?? 2));
      const t = Array.isArray(doc.tools) ? doc.tools : [];
      setTools(
        t.map((tool: any) => ({
          name: String(tool.name ?? "tool"),
          transport: tool.transport ?? tool.type ?? "stdio",
          command: tool.command,
          args: Array.isArray(tool.args) ? tool.args : undefined,
          url: tool.url,
        }))
      );
      setYamlError("");
      return true;
    } catch (e: any) {
      setYamlError(`YAML error: ${e?.message || e}`);
      return false;
    }
  };

  const addTool = () => {
    setTools([...tools, { name: `tool_${tools.length + 1}`, transport: "stdio", command: "python", args: [] }]);
  };

  const loadRegisteredServers = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;
      const res = await fetch(`${API_BASE}/mcp-servers/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setRegisteredServers(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const addRegisteredServer = () => {
    const id = parseInt(selectedServerId, 10);
    const server = registeredServers.find((s) => s.id === id);
    if (!server) return;
    // Store as server_id reference (resolved at runtime) plus name for UI
    setTools([
      ...tools,
      {
        name: server.name,
        transport: server.config?.transport || "stdio",
        // @ts-ignore - extra field for resolution
        server_id: server.id,
        ...(server.config || {}),
      } as any,
    ]);
    setSelectedServerId("");
  };

  // Load registered servers on mount
  useEffect(() => {
    loadRegisteredServers();
  }, []);

  const updateTool = (index: number, updates: Partial<ToolConfig>) => {
    const next = [...tools];
    next[index] = { ...next[index], ...updates };
    setTools(next);
  };

  const removeTool = (index: number) => {
    setTools(tools.filter((_, i) => i !== index));
  };

  const addSubAgent = () => {
    const base = {
      name: workflowType === "hierarchical" ? `team_${subAgents.length + 1}` : `specialist_${subAgents.length + 1}`,
      description: workflowType === "hierarchical" ? "Coordinates specialists" : "Specialist agent",
      system_prompt: workflowType === "hierarchical" ? "You lead this team." : "You are a specialist.",
    };
    if (workflowType === "hierarchical") {
      setSubAgents([
        ...subAgents,
        { ...base, team_workflow_type: "supervisor", specialists: [] },
      ]);
    } else {
      setSubAgents([...subAgents, base]);
    }
  };

  const updateSubAgent = (index: number, updates: Partial<SubAgent>) => {
    const next = [...subAgents];
    next[index] = { ...next[index], ...updates };
    setSubAgents(next);
  };

  const addSpecialist = (teamIndex: number) => {
    const next = [...subAgents];
    const team = next[teamIndex];
    const specialists = team.specialists || [];
    next[teamIndex] = {
      ...team,
      specialists: [
        ...specialists,
        { name: `specialist_${specialists.length + 1}`, description: "Specialist", system_prompt: "You are a specialist." },
      ],
    };
    setSubAgents(next);
  };

  const updateSpecialist = (teamIndex: number, specIndex: number, updates: Partial<SubAgent>) => {
    const next = [...subAgents];
    const team = next[teamIndex];
    const specialists = [...(team.specialists || [])];
    specialists[specIndex] = { ...specialists[specIndex], ...updates };
    next[teamIndex] = { ...team, specialists };
    setSubAgents(next);
  };

  const removeSpecialist = (teamIndex: number, specIndex: number) => {
    const next = [...subAgents];
    const team = next[teamIndex];
    next[teamIndex] = {
      ...team,
      specialists: (team.specialists || []).filter((_, i) => i !== specIndex),
    };
    setSubAgents(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(buildPayload());
    } finally {
      setLoading(false);
    }
  };

  const validateTools = async () => {
    if (tools.length === 0) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/mcp/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(tools),
      });
      if (res.ok) {
        setValidationResult(await res.json());
      } else {
        setValidationResult({ error: await res.text() });
      }
    } catch (e: any) {
      setValidationResult({ error: e.message });
    } finally {
      setValidating(false);
    }
  };

  const discoverTools = async () => {
    setDiscovering(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/discover-tools`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify(tools),
      });
      if (res.ok) {
        const data = await res.json();
        setDiscoveredTools(data.tools || []);
      } else {
        setDiscoveredTools([{ name: "Error", description: await res.text() }]);
      }
    } catch (e) {
      setDiscoveredTools([{ name: "Error", description: String(e) }]);
    }
    setDiscovering(false);
  };

  const discoverResources = async () => {
    setDiscoveringResources(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/discover-resources`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify(tools),
      });
      if (res.ok) {
        const data = await res.json();
        setDiscoveredResources(data.resources || []);
      } else {
        setDiscoveredResources([{ uri: "Error", name: await res.text() }]);
      }
    } catch (e) {
      setDiscoveredResources([{ uri: "Error", name: String(e) }]);
    }
    setDiscoveringResources(false);
  };

  const discoverPrompts = async () => {
    setDiscoveringPrompts(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/discover-prompts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify(tools),
      });
      if (res.ok) {
        const data = await res.json();
        setDiscoveredPrompts(data.prompts || []);
      } else {
        setDiscoveredPrompts([{ name: "Error", description: await res.text() }]);
      }
    } catch (e) {
      setDiscoveredPrompts([{ name: "Error", description: String(e) }]);
    }
    setDiscoveringPrompts(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Builder</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Start from template:</span>
          <select
            className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
            onChange={(e) => {
              const t = TEMPLATES.find((x) => x.name === e.target.value);
              if (!t) return;
              setName(t.name);
              setDescription(t.description);
              setSystemPrompt(t.system_prompt);
              setModelName(t.model_name);
              setWorkflowType(t.workflow_type);
              if ("longterm_enabled" in t) setLongtermEnabled(!!(t as any).longterm_enabled);
            }}
            defaultValue=""
          >
            <option value="" disabled>Choose a template…</option>
            {TEMPLATES.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>
        <Tabs
          value={editorMode}
          onValueChange={(value: any) => {
            const next = value === "yaml" ? "yaml" : "visual";
            if (next === "yaml") setYamlText(agentToYaml());
            setEditorMode(next);
          }}
        >
          <TabsList>
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="yaml">YAML</TabsTrigger>
          </TabsList>

          <TabsContent value="visual">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="font-mono text-xs text-muted-foreground uppercase">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div>
                  <label className="font-mono text-xs text-muted-foreground uppercase">Model</label>
                  <Input value={modelName} onChange={(e) => setModelName(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="font-mono text-xs text-muted-foreground uppercase">Description</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <label className="font-mono text-xs text-muted-foreground uppercase">System Prompt</label>
                <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4} />
              </div>
              <div>
                <label className="font-mono text-xs text-muted-foreground uppercase">
                  Temperature: <span className="text-foreground">{temperature}</span>
                </label>
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

              {/* Execution & autonomy */}
              <div className="space-y-3 rounded-lg border border-border p-4">
                <h3 className="font-mono text-sm text-muted-foreground uppercase">Execution &amp; Autonomy</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="font-mono text-xs text-muted-foreground uppercase">Max Steps</label>
                    <Input
                      type="number"
                      min={3}
                      max={200}
                      value={maxSteps}
                      onChange={(e) => setMaxSteps(parseInt(e.target.value) || 25)}
                    />
                  </div>
                  <div>
                    <label className="font-mono text-xs text-muted-foreground uppercase">Autonomy Level</label>
                    <Select value={autonomyLevel} onValueChange={(v: any) => setAutonomyLevel(v ?? "supervised")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="supervised">Supervised (asks when unsure)</SelectItem>
                        <SelectItem value="semi_autonomous">Semi-Autonomous</SelectItem>
                        <SelectItem value="autonomous">Autonomous (plans long-horizon)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="font-mono text-xs text-muted-foreground uppercase">Max Reflections</label>
                    <Input
                      type="number"
                      min={0}
                      max={3}
                      value={maxReflections}
                      onChange={(e) => setMaxReflections(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={sandboxEnabled} onChange={(e) => setSandboxEnabled(e.target.checked)} />
                    <span className="font-mono text-xs">sandbox: code, terminal &amp; files (Docker-isolated)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={planningEnabled} onChange={(e) => setPlanningEnabled(e.target.checked)} />
                    <span className="font-mono text-xs">planning: long-horizon plan → act → verify</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={reflectEnabled} onChange={(e) => setReflectEnabled(e.target.checked)} />
                    <span className="font-mono text-xs">self-reflection with confidence + escalation</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={structuredEnabled} onChange={(e) => setStructuredEnabled(e.target.checked)} />
                    <span className="font-mono text-xs">structured output (JSON Schema enforced)</span>
                  </label>
                  {structuredEnabled && (
                    <div className="ml-6 space-y-1">
                      <span className="text-xs text-muted-foreground">Output JSON Schema:</span>
                      <textarea
                        className="w-full h-32 text-xs font-mono border rounded p-2 bg-background"
                        value={outputSchemaText}
                        onChange={(e) => setOutputSchemaText(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs">tool_choice:</span>
                    <select
                      className="text-xs border rounded px-1 py-0.5 bg-background"
                      value={toolChoice}
                      onChange={(e) => setToolChoice(e.target.value)}
                    >
                      <option value="auto">auto</option>
                      <option value="required">required</option>
                      <option value="none">none</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="memory"
                    checked={memoryEnabled}
                    onChange={(e) => setMemoryEnabled(e.target.checked)}
                  />
                  <label htmlFor="memory" className="text-sm">
                    Enable conversation memory (thread-based windowing)
                  </label>
                  {memoryEnabled && (
                    <div className="flex items-center gap-2 ml-6 text-sm">
                      <span>Max messages:</span>
                      <Input
                        type="number"
                        min={2}
                        max={100}
                        className="w-20 h-8"
                        value={maxMessages}
                        onChange={(e) => setMaxMessages(parseInt(e.target.value) || 20)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="longterm"
                    checked={longtermEnabled}
                    onChange={(e) => setLongtermEnabled(e.target.checked)}
                  />
                  <label htmlFor="longterm" className="text-sm">
                    Enable long-term semantic memory (vector store)
                  </label>
                  {longtermEnabled && (
                    <div className="flex items-center gap-2 ml-6">
                      <input
                        type="checkbox"
                        id="shared-memory"
                        checked={sharedMemory}
                        onChange={(e) => setSharedMemory(e.target.checked)}
                      />
                      <label htmlFor="shared-memory" className="text-sm text-muted-foreground">
                        Share memory across multi-agent team (hierarchical / supervisor)
                      </label>
                    </div>
                  )}
                  {longtermEnabled && (
                    <div className="flex items-center gap-2 ml-6 text-sm">
                      <span>Retrieve k:</span>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        className="w-20 h-8"
                        value={longtermK}
                        onChange={(e) => setLongtermK(parseInt(e.target.value) || 5)}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="font-mono text-xs text-muted-foreground uppercase">Workflow Type</label>
                <Select value={workflowType} onValueChange={(v: any) => setWorkflowType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Agent</SelectItem>
                    <SelectItem value="sequential">Sequential Multi-Agent</SelectItem>
                    <SelectItem value="supervisor">Supervisor Multi-Agent</SelectItem>
                    <SelectItem value="parallel">Parallel Multi-Agent (Synthesizer)</SelectItem>
                    <SelectItem value="consensus">Consensus Multi-Agent (Independent + Synthesis)</SelectItem>
                    <SelectItem value="debate">Debate Multi-Agent (Pro/Con + Judge)</SelectItem>
                    <SelectItem value="map_reduce">Map-Reduce (Parallel Specialists + Synthesizer)</SelectItem>
                    <SelectItem value="hierarchical">Hierarchical (Manager → Teams)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {workflowType !== "single" && (
                <div className="space-y-4 rounded-lg border border-border p-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-mono text-sm text-muted-foreground uppercase">
                      {workflowType === "hierarchical" ? "Teams (Manager → Teams)" : workflowType === "map_reduce" ? "Mapper Specialists" : "Sub-Agents / Workers"}
                    </h3>
                    <Button type="button" size="sm" variant="outline" onClick={addSubAgent}>
                      {workflowType === "hierarchical" ? "Add Team" : "Add Sub-Agent"}
                    </Button>
                  </div>
                  {subAgents.map((sa, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                      <div className="flex justify-between">
                        <Badge variant="secondary" className="font-mono">{workflowType === "hierarchical" ? `Team ${i + 1}` : `Sub-Agent ${i + 1}`}</Badge>
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
                      {workflowType === "hierarchical" && (
                        <div className="mt-3 space-y-3 rounded border border-dashed border-border p-3 bg-muted/30">
                          <div className="flex items-center gap-2">
                            <label className="font-mono text-xs text-muted-foreground uppercase whitespace-nowrap">Team Workflow</label>
                            <Select
                              value={sa.team_workflow_type || "supervisor"}
                              onValueChange={(v: any) => updateSubAgent(i, { team_workflow_type: v })}
                            >
                              <SelectTrigger className="h-8 w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="single">Single</SelectItem>
                                <SelectItem value="sequential">Sequential</SelectItem>
                                <SelectItem value="supervisor">Supervisor</SelectItem>
                                <SelectItem value="parallel">Parallel</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="font-mono text-xs text-muted-foreground uppercase">Team Specialists</span>
                            <Button type="button" size="sm" variant="outline" onClick={() => addSpecialist(i)}>
                              Add Specialist
                            </Button>
                          </div>
                          {(sa.specialists || []).map((sp, j) => (
                            <div key={j} className="space-y-1 rounded border border-border/60 p-2 bg-background">
                              <div className="flex justify-between items-center">
                                <Badge variant="outline" className="text-xs font-mono">Specialist {j + 1}</Badge>
                                <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => removeSpecialist(i, j)}>
                                  ×
                                </Button>
                              </div>
                              <Input
                                placeholder="Name"
                                className="h-8 text-sm"
                                value={sp.name}
                                onChange={(e) => updateSpecialist(i, j, { name: e.target.value })}
                              />
                              <Input
                                placeholder="Description"
                                className="h-8 text-sm"
                                value={sp.description}
                                onChange={(e) => updateSpecialist(i, j, { description: e.target.value })}
                              />
                              <Textarea
                                placeholder="System Prompt"
                                className="text-sm"
                                value={sp.system_prompt}
                                onChange={(e) => updateSpecialist(i, j, { system_prompt: e.target.value })}
                                rows={2}
                              />
                            </div>
                          ))}
                          {(sa.specialists || []).length === 0 && (
                            <p className="text-xs text-muted-foreground">No specialists yet — team will run as a single agent.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 rounded-lg border border-border p-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-mono text-sm text-muted-foreground uppercase">mcp tools</h3>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={validateTools} disabled={validating || tools.length === 0}>
                      {validating ? "Validating..." : "Validate Configs"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={discoverTools} disabled={discovering || tools.length === 0}>
                      {discovering ? "Discovering..." : "Preview Tools"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={discoverResources} disabled={discoveringResources || tools.length === 0}>
                      {discoveringResources ? "Discovering..." : "Preview Resources"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={discoverPrompts} disabled={discoveringPrompts || tools.length === 0}>
                      {discoveringPrompts ? "Discovering..." : "Preview Prompts"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={addTool}>
                      Add MCP Server
                    </Button>
                    {registeredServers.length > 0 && (
                      <div className="flex gap-2 items-center">
                        <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="From registry..." />
                          </SelectTrigger>
                          <SelectContent>
                            {registeredServers.map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="button" size="sm" variant="secondary" onClick={addRegisteredServer} disabled={!selectedServerId}>
                          Add
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {validationResult && (
                  <div className="mt-3 rounded-lg border border-border p-3 text-sm">
                    <strong className="font-mono text-xs text-muted-foreground uppercase">Validation</strong>{" "}
                    {validationResult.error ? (
                      <span className="text-red-400">{validationResult.error}</span>
                    ) : validationResult.all_valid ? (
                      <span className="text-emerald-400">All configs valid</span>
                    ) : (
                      <ul className="list-disc pl-5 mt-1">
                        {validationResult.results?.map((r: any, i: number) => (
                          <li key={i} className={r.valid ? "text-emerald-400" : "text-red-400"}>
                            {r.name}: {r.valid ? "OK" : r.error}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {discoveredTools.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
                    <strong>Discovered Tools:</strong>
                    <ul className="list-disc pl-4 space-y-1">
                      {discoveredTools.map((t, idx) => (
                        <li key={idx}>
                          <span className="font-medium">{t.name}</span>: {t.description}
                          {t.args_schema && (
                            <pre className="mt-1 text-[10px] opacity-70 overflow-auto max-h-16">{JSON.stringify(t.args_schema, null, 1)}</pre>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {discoveredResources.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
                    <strong>Discovered Resources:</strong>
                    <ul className="list-disc pl-4 space-y-1">
                      {discoveredResources.map((r, idx) => (
                        <li key={idx}>
                          <span className="font-medium">{r.uri || r.name}</span>: {r.description || r.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {discoveredPrompts.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
                    <strong>Discovered Prompts:</strong>
                    <ul className="list-disc pl-4 space-y-1">
                      {discoveredPrompts.map((p, idx) => (
                        <li key={idx}>
                          <span className="font-medium">{p.name}</span>: {p.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {tools.map((tool, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex justify-between">
                      <Badge variant="secondary" className="font-mono">Tool {i + 1}</Badge>
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
          </TabsContent>

          <TabsContent value="yaml">
            <div className="space-y-3">
              <p className="font-mono text-xs text-muted-foreground">
                edit the full agent definition as yaml, then apply to the visual form before saving
              </p>
              <Textarea
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                rows={28}
                className="font-mono text-xs"
                spellCheck={false}
              />
              {yamlError && <p className="font-mono text-xs text-red-400">{yamlError}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (applyYaml(yamlText)) setEditorMode("visual");
                  }}
                >
                  Apply to Visual Form
                </Button>
                <Button type="button" variant="outline" onClick={() => setYamlText(agentToYaml())}>
                  Reset to Current
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
