"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

interface StreamEvent {
  type: string;
  content?: string;
  agent?: string;
  name?: string;
  args?: any;
  round?: number;
  confidence?: number;
}

interface MultiAgentTimelineProps {
  events: StreamEvent[];
  className?: string;
}

export default function MultiAgentTimeline({ events, className = "" }: MultiAgentTimelineProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, StreamEvent[]>();
    for (const ev of events) {
      if (["agent_step", "thought", "reflection", "tool_call", "tool_result", "confidence"].includes(ev.type)) {
        const key = ev.agent || (ev.type.startsWith("tool") ? "tools" : "main");
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
      }
    }
    return Array.from(map.entries());
  }, [events]);

  if (grouped.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Multi-Agent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Agent steps will appear here during multi-agent runs.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Multi-Agent Activity
          <Badge variant="outline" className="text-xs">{grouped.length} agents</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-96 overflow-auto">
        {grouped.map(([agent, steps]) => (
          <div key={agent} className="border-l-2 border-primary/40 pl-3">
            <div className="font-mono text-xs font-semibold text-primary mb-1">{agent}</div>
            {steps.slice(-6).map((step, i) => (
              <div key={i} className="text-xs text-muted-foreground mb-1 whitespace-pre-wrap">
                {step.type === "reflection" && "⟳ "}
                {step.type === "tool_call" && `🔧 ${step.name || "tool"} `}
                {step.type === "tool_result" && "✓ "}
                {step.type === "confidence" && "★ "}
                {(step.content || JSON.stringify(step.args || "") || "").slice(0, 240)}
                {(step.content || "").length > 240 ? "…" : ""}
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
