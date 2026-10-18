import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-5xl font-bold tracking-tight">AI Agent Space</h1>
      <p className="max-w-2xl text-center text-lg text-muted-foreground">
        Build, configure, run, and share advanced AI agents with real tool use, MCP servers, and multi-agent workflows.
      </p>
      <div className="flex gap-4">
        <Button asChild size="lg">
          <Link href="/agents">Go to Agents</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/login">Login</Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href="/register">Register</Link>
        </Button>
      </div>
      <div className="mt-12 grid max-w-4xl gap-6 md:grid-cols-3">
        <div className="rounded-lg border p-6">
          <h3 className="font-semibold">Agent Builder</h3>
          <p className="mt-2 text-sm text-muted-foreground">Create agents with custom prompts, models, and tools.</p>
        </div>
        <div className="rounded-lg border p-6">
          <h3 className="font-semibold">Real MCP</h3>
          <p className="mt-2 text-sm text-muted-foreground">Connect to official MCP servers for tool discovery and execution.</p>
        </div>
        <div className="rounded-lg border p-6">
          <h3 className="font-semibold">Marketplace</h3>
          <p className="mt-2 text-sm text-muted-foreground">Publish, discover, clone, and sell agents.</p>
        </div>
      </div>
    </div>
  );
}
