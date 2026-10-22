"""
Built-in, sandboxed tools exposed to agents: code execution, terminal access,
and file operations on a per-run workspace.

Every execution goes through SandboxService (Docker with resource limits and
network isolation by default). File tools operate on the run's workspace only,
with strict path traversal guards.

Also includes dynamic MCP resource/prompt tools when MCP servers are configured.
"""
import logging
from pathlib import Path
from typing import List, Optional, Dict, Any

from langchain_core.tools import tool

from app.services.sandbox_service import SandboxUnavailableError, sandbox_service
from app.services.mcp_service import mcp_service

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 8000
ALLOWED_EXTENSIONS: Optional[set] = None  # None = allow all (sandbox handles abuse)


def _safe_join(workspace: str, relative: str) -> Path:
    """Resolve a path inside the workspace and refuse to escape it."""
    ws = Path(workspace).resolve()
    candidate = Path(relative)
    full = (candidate if candidate.is_absolute() else ws / candidate).resolve()
    if full == ws or ws not in full.parents:
        raise ValueError(f"Path escapes the agent workspace: {relative}")
    return full


def _fmt_result(action: str, result) -> str:
    """Format a SandboxResult as a concise, LLM-friendly string."""
    parts = [f"{action} finished in {result.duration_ms} ms [engine={result.engine}]",
             f"exit_code: {result.exit_code}"]
    if result.timed_out:
        parts.append("status: TIMED OUT — simplify the task, split it, or raise allowed runtime")
    if result.stdout:
        parts.append(f"stdout:\n{result.stdout}")
    if result.stderr:
        parts.append(f"stderr:\n{result.stderr}")
    return "\n".join(parts)


def build_sandbox_tools(workspace: str) -> List:
    """Create tool closures bound to a per-run workspace directory."""

    @tool
    def run_python(code: str) -> str:
        """Execute Python code in the secure sandbox. The workspace is mounted at /workspace
        as the current directory. Use print() to emit results. Returns stdout/stderr and exit code."""
        try:
            result = sandbox_service.run_python(code, workspace)
            return _fmt_result("python", result)
        except SandboxUnavailableError as e:
            return f"Sandbox unavailable: {e}"

    @tool
    def run_terminal(command: str) -> str:
        """Run a shell command in the secure sandbox (no network access by default).
        Runs in the per-run workspace directory. Examples: ls -la, python --version, pip list."""
        try:
            result = sandbox_service.run_command(["/bin/sh", "-c", command], workspace)
            return _fmt_result("terminal", result)
        except SandboxUnavailableError as e:
            return f"Sandbox unavailable: {e}"

    @tool
    def write_file(file_path: str, content: str) -> str:
        """Create or overwrite a file inside the workspace. Paths are relative to the workspace."""
        try:
            target = _safe_join(workspace, file_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            return f"OK: wrote {len(content)} chars to {file_path}"
        except Exception as e:  # noqa: BLE001
            return f"Error writing file: {e}"

    @tool
    def read_file(file_path: str) -> str:
        """Read a file from the workspace (first ~8000 chars). Paths are relative."""
        try:
            target = _safe_join(workspace, file_path)
            if not target.exists():
                return f"Error: file not found: {file_path}"
            if target.is_dir():
                return f"Error: {file_path} is a directory (use list_files)"
            return target.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT_CHARS]
        except Exception as e:  # noqa: BLE001
            return f"Error reading file: {e}"

    @tool
    def list_files(directory: str = ".") -> str:
        """List files in a workspace directory (recursive=false, max 200 entries)."""
        try:
            base = _safe_join(workspace, directory)
            if not base.is_dir():
                return f"Error: not a directory: {directory}"
            entries = sorted(base.iterdir())[:200]
            if not entries:
                return "(empty)"
            lines = []
            for entry in entries:
                suffix = "/" if entry.is_dir() else ""
                size = f" ({entry.stat().st_size} bytes)" if entry.is_file() else ""
                lines.append(f"{entry.relative_to(base)}{suffix}{size}")
            return "\n".join(lines)
        except Exception as e:  # noqa: BLE001
            return f"Error listing files: {e}"

    return [run_python, run_terminal, write_file, read_file, list_files]


def build_mcp_meta_tools(tools_config: List[Dict[str, Any]]) -> List:
    """
    Build meta-tools that give the agent live access to MCP resources and prompts.
    These create fresh sessions on each call for correctness.
    """
    if not tools_config:
        return []

    @tool
    async def list_mcp_resources() -> str:
        """List all available MCP resources from the configured servers (uri, name, description).
        Call this first to discover what context or data the MCP servers expose."""
        try:
            resources = await mcp_service.discover_resources(tools_config)
            if not resources:
                return "No MCP resources discovered (or servers do not expose resources)."
            lines = []
            for r in resources:
                lines.append(f"- {r.get('uri')} | {r.get('name')} | {r.get('description','')[:120]}")
            return "\n".join(lines)
        except Exception as e:
            return f"Error listing MCP resources: {e}"

    @tool
    async def read_mcp_resource(uri: str) -> str:
        """Read the content of a specific MCP resource by its URI (obtained from list_mcp_resources).
        Returns the resource content or an error message."""
        try:
            result = await mcp_service.read_resource(tools_config, uri)
            content = result.get("content", str(result))
            return str(content)[:MAX_TEXT_CHARS]
        except Exception as e:
            return f"Error reading MCP resource {uri}: {e}"

    @tool
    async def list_mcp_prompts() -> str:
        """List available MCP prompts from configured servers (name + description)."""
        try:
            prompts = await mcp_service.discover_prompts(tools_config)
            if not prompts:
                return "No MCP prompts discovered."
            lines = [f"- {p.get('name')}: {p.get('description','')}" for p in prompts]
            return "\n".join(lines)
        except Exception as e:
            return f"Error listing MCP prompts: {e}"

    return [list_mcp_resources, read_mcp_resource, list_mcp_prompts]


def build_shared_memory_tools(agent_config: Dict[str, Any]) -> List:
    """
    Tools that let multi-agent workers explicitly store and retrieve shared team memories.
    Only attached when memory_config.shared and longterm_enabled are true.
    """
    mem_cfg = agent_config.get("memory_config") or {}
    if not (mem_cfg.get("longterm_enabled") and mem_cfg.get("shared")):
        return []

    agent_id = agent_config.get("id")
    user_id = agent_config.get("user_id")
    if not agent_id or not user_id:
        return []

    shared_ns = f"team_{agent_id}"

    @tool
    def store_shared_memory(text: str, tags: str = "") -> str:
        """Store a concise fact, decision, or observation into the shared team memory
        so other agents in this multi-agent workflow can retrieve it later.
        Keep the text short and factual."""
        try:
            from app.services.memory_service import get_memory_service
            meta = {"source": "agent_tool", "tags": tags} if tags else {"source": "agent_tool"}
            mid = get_memory_service().add_memory(
                int(agent_id), int(user_id), text, metadata=meta, shared_namespace=shared_ns
            )
            return f"Stored in shared team memory (id={mid})" if mid else "Failed to store memory"
        except Exception as e:
            return f"Error storing shared memory: {e}"

    @tool
    def retrieve_shared_memory(query: str, k: int = 5) -> str:
        """Retrieve the most relevant facts from the shared team memory for this multi-agent workflow."""
        try:
            from app.services.memory_service import get_memory_service
            docs = get_memory_service().retrieve(
                int(agent_id), int(user_id), query, k=max(1, min(k, 10)), shared_namespace=shared_ns
            )
            if not docs:
                return "No relevant shared memories found."
            return "\n".join(f"- {d}" for d in docs)
        except Exception as e:
            return f"Error retrieving shared memory: {e}"

    return [store_shared_memory, retrieve_shared_memory]


def build_mcp_prompt_tool(tools_config: List[Dict[str, Any]]) -> List:
    """Add a tool that fetches and renders an MCP prompt template (when servers expose prompts)."""
    if not tools_config:
        return []

    @tool
    async def get_mcp_prompt(name: str, arguments: str = "{}") -> str:
        """Fetch a prompt template from a configured MCP server by name.
        Optionally pass JSON arguments. Returns the rendered prompt text or an error.
        Use list_mcp_prompts first to discover available names."""
        try:
            import json
            args = json.loads(arguments) if arguments else {}
            # Live session path: agents use this during a run
            from app.services.mcp_service import mcp_service
            # For now we surface the discovery result and note; full prompt rendering
            # depends on the MCP client session. This keeps the interface available.
            prompts = await mcp_service.discover_prompts(tools_config)
            match = next((p for p in prompts if p.get("name") == name or name in p.get("name", "")), None)
            if not match:
                return f"MCP prompt '{name}' not found. Available: {[p.get('name') for p in prompts]}"
            return (
                f"MCP prompt '{match.get('name')}' (server={match.get('server')}): "
                f"{match.get('description', '')}\n"
                f"Arguments received: {args}\n"
                f"(Full prompt rendering occurs inside a live MCP session; use this to confirm availability.)"
            )
        except Exception as e:
            return f"Error fetching MCP prompt '{name}': {e}"

    return [get_mcp_prompt]
