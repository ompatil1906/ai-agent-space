"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SubAgent {
  name: string;
  description?: string;
  system_prompt?: string;
  team_workflow_type?: string;
  specialists?: SubAgent[];
  workflow?: any;
}

interface WorkflowConfig {
  type?: string;
  sub_agents?: SubAgent[];
  workers?: SubAgent[];
  teams?: any[];
}

interface WorkflowVisualizerProps {
  workflow: WorkflowConfig | null | undefined;
  agentName?: string;
}

function NodeCard({ title, subtitle, type, children }: { title: string; subtitle?: string; type: string; children?: React.ReactNode }) {
  const color =
    type === "supervisor" || type === "hierarchical" ? "border-blue-500" :
    type === "parallel" || type === "map_reduce" ? "border-purple-500" :
    type === "debate" || type === "consensus" ? "border-orange-500" :
    type === "sequential" ? "border-green-500" : "border-gray-400";

  return (
    <Card className={`border-2 ${color} shadow-sm`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <Badge variant="outline" className="text-xs capitalize">{type}</Badge>
        </div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardHeader>
      {children && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

function renderSubAgents(agents: SubAgent[] | undefined, parentType: string) {
  if (!agents || agents.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 pl-4 border-l-2 border-dashed border-muted">
      {agents.map((sa, idx) => (
        <div key={idx}>
          <NodeCard
            title={sa.name || `Specialist ${idx + 1}`}
            subtitle={sa.description}
            type={sa.team_workflow_type || parentType || "single"}
          >
            {sa.specialists && renderSubAgents(sa.specialists, sa.team_workflow_type || "supervisor")}
            {sa.workflow?.sub_agents && renderSubAgents(sa.workflow.sub_agents, sa.workflow.type || "supervisor")}
          </NodeCard>
        </div>
      ))}
    </div>
  );
}

export default function WorkflowVisualizer({ workflow, agentName = "Agent" }: WorkflowVisualizerProps) {
  if (!workflow || !workflow.type || workflow.type === "single") {
    return (
      <NodeCard title={agentName} subtitle="Single-agent ReAct loop with optional tools and reflection" type="single" />
    );
  }

  const type = workflow.type;
  const subs = workflow.sub_agents || workflow.workers || [];
  const teams = workflow.teams || [];

  if (type === "hierarchical" && teams.length > 0) {
    return (
      <div className="space-y-4">
        <NodeCard title={`${agentName} (Orchestrator)`} type="hierarchical" subtitle="Routes work to specialized teams">
          <div className="mt-3 space-y-3">
            {teams.map((team: any, idx: number) => (
              <div key={idx} className="pl-4 border-l-2 border-dashed">
                <NodeCard
                  title={team.name || `Team ${idx + 1}`}
                  subtitle={team.description}
                  type={team.workflow?.type || "supervisor"}
                >
                  {renderSubAgents(team.workflow?.sub_agents || team.workflow?.workers || team.specialists, team.workflow?.type || "supervisor")}
                </NodeCard>
              </div>
            ))}
          </div>
        </NodeCard>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <NodeCard
        title={`${agentName} (${type.replace("_", " ")})`}
        subtitle={
          type === "supervisor" ? "Coordinates specialists and synthesizes final answer" :
          type === "parallel" ? "Runs specialists concurrently then reduces" :
          type === "debate" ? "Pro/con debate with moderator synthesis" :
          type === "consensus" ? "Independent specialists + consensus facilitator" :
          type === "map_reduce" ? "Fan-out with Send API then reduce" :
          type === "sequential" ? "Pass-through chain of specialists" : ""
        }
        type={type}
      >
        {renderSubAgents(subs, type)}
      </NodeCard>
    </div>
  );
}
