"""
Built-in, sandboxed tools exposed to agents: code execution, terminal access,
and file operations on a per-run workspace.

Every execution goes through SandboxService (Docker with resource limits and
network isolation by default). File tools operate on the run's workspace only,
with strict path traversal guards.
"""
import logging
from pathlib import Path
from typing import List, Optional

from langchain_core.tools import tool

from app.services.sandbox_service import SandboxUnavailableError, sandbox_service

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
