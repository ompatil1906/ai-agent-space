import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-5xl font-bold tracking-tight">AI Agent Space</h1>
      <p className="max-w-2xl text-center text-lg text-muted-foreground">
        Build, configure, run, and share advanced AI agents with real tool use, MCP servers, and multi-agent workflows.
      </p>
      <div className="flex gap-4">
        <Link href="/agents" className={buttonVariants({ size: "lg" })}>
          My Agents
        </Link>
        <Link href="/marketplace" className={buttonVariants({ size: "lg", variant: "secondary" })}>
          Marketplace
        </Link>
        <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Login
        </Link>
        <Link href="/register" className={buttonVariants({ size: "lg", variant: "secondary" })}>
          Register
        </Link>
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
