"""
Secure sandbox execution for agent-generated code and commands.

Primary engine: Docker containers with hard resource limits
(CPU, memory, wall-clock timeout, network isolation) and a per-run
workspace volume mounted at /workspace.

Engine selection (settings.SANDBOX_MODE):
- "docker": always Docker (recommended; raises if the daemon is unreachable)
- "local": direct subprocess in a restricted environment (dev convenience)
- "auto": Docker when available, otherwise local (default)

Security notes:
- Containers run as uid 65534 (nobody) with the network disabled and
  bounded memory/CPU. Only the per-run workspace directory is mounted.
- The "local" engine is NOT isolated and exists only to keep development
  frictionless on machines without a running Docker daemon.
"""
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class SandboxUnavailableError(RuntimeError):
    """Raised when no execution engine can serve the request."""


@dataclass
class SandboxResult:
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    engine: str  # "docker" | "local"
    timed_out: bool = False


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = text[: limit // 2]
    tail = text[-limit // 2 :]
    return f"{head}\n... [truncated {len(text) - limit} chars] ...\n{tail}"


def _prepare_workspace(workdir: str) -> Path:
    """Validate/normalize a workspace path created by this service."""
    root = Path(workdir).resolve()
    if not root.is_dir():
        raise SandboxUnavailableError(f"Workspace not found: {workdir}")
    return root


class SandboxService:
    def __init__(self) -> None:
        self._docker_client = None
        self._docker_checked = False
        self._docker_ok = False

    # ------------------------------------------------------------------ #
    # Workspace management
    # ------------------------------------------------------------------ #
    def create_workspace(self, label: str = "run") -> str:
        base = settings.SANDBOX_WORKSPACE_ROOT or None
        root = Path(tempfile.gettempdir()) if base is None else Path(base)
        if base:
            root.mkdir(parents=True, exist_ok=True)
        ws = root / f"aas-ws-{label}-{uuid.uuid4().hex[:10]}"
        ws.mkdir(parents=True, exist_ok=True)
        # Docker runs as uid 65534 (nobody) and must be able to write here.
        try:
            os.chmod(ws, 0o777)
        except OSError:
            pass
        return str(ws)

    def cleanup_workspace(self, workspace: str) -> None:
        if settings.SANDBOX_KEEP_WORKSPACES:
            return
        try:
            path = Path(workspace).resolve()
            root = Path(tempfile.gettempdir()).resolve()
            if settings.SANDBOX_WORKSPACE_ROOT:
                root = Path(settings.SANDBOX_WORKSPACE_ROOT).resolve()
            if root not in path.parents and path.parent != root:
                logger.warning("Refusing to delete workspace outside root: %s", path)
                return
            shutil.rmtree(path, ignore_errors=True)
        except Exception as e:  # noqa: BLE001 - cleanup must never break a run
            logger.debug("Workspace cleanup failed for %s: %s", workspace, e)

    # ------------------------------------------------------------------ #
    # Docker engine
    # ------------------------------------------------------------------ #
    def _get_docker(self):
        if not self._docker_checked:
            self._docker_checked = True
            try:
                import docker  # type: ignore

                client = docker.from_env()
                client.ping()
                self._docker_client = client
                self._docker_ok = True
            except Exception as e:
                logger.info("Docker engine unavailable: %s", e)
                self._docker_ok = False
        return self._docker_client if self._docker_ok else None

    def _run_docker(
        self,
        image: str,
        command: list,
        workdir: Path,
        timeout: int,
    ) -> SandboxResult:
        import docker  # type: ignore
        from docker.errors import ImageNotFound  # type: ignore

        client = self._get_docker()
        if client is None:
            raise SandboxUnavailableError("Docker daemon is not reachable")

        try:
            client.images.get(image)
        except ImageNotFound:
            logger.info("Pulling sandbox image %s (one-time)...", image)
            client.images.pull(image)

        stdout_chunks: list = []
        stderr_chunks: list = []
        exit_code = -1
        timed_out = False
        started = time.monotonic()

        container = client.containers.run(
            image,
            command=command,
            detach=True,
            network_disabled=not settings.SANDBOX_NETWORK_ENABLED,
            mem_limit=settings.SANDBOX_MEMORY_LIMIT,
            nano_cpus=settings.SANDBOX_NANO_CPUS,
            user="65534:65534",
            working_dir="/workspace",
            volumes={str(workdir): {"bind": "/workspace", "mode": "rw"}},
            environment={"PYTHONUNBUFFERED": "1", "HOME": "/tmp"},
        )
        try:
            try:
                result = container.wait(timeout=timeout)
                exit_code = int(result.get("StatusCode", -1))
            except Exception:
                timed_out = True
                try:
                    container.kill()
                except Exception:  # noqa: BLE001
                    pass
            try:
                logs = container.logs(stdout=True, stderr=False, tail=4000)
                stdout_chunks.append(logs.decode("utf-8", errors="replace"))
                logs = container.logs(stdout=False, stderr=True, tail=4000)
                stderr_chunks.append(logs.decode("utf-8", errors="replace"))
            except Exception as e:  # noqa: BLE001
                stderr_chunks.append(f"[log retrieval failed: {e}]")
        finally:
            try:
                container.remove(force=True)
            except Exception:  # noqa: BLE001
                pass

        duration_ms = int((time.monotonic() - started) * 1000)
        return SandboxResult(
            stdout=_truncate("".join(stdout_chunks), settings.SANDBOX_MAX_OUTPUT_CHARS),
            stderr=_truncate("".join(stderr_chunks), settings.SANDBOX_MAX_OUTPUT_CHARS),
            exit_code=exit_code,
            duration_ms=duration_ms,
            engine="docker",
            timed_out=timed_out,
        )

    # ------------------------------------------------------------------ #
    # Local engine (dev-only fallback)
    # ------------------------------------------------------------------ #
    def _run_local(self, command: list, workdir: Path, timeout: int) -> SandboxResult:
        started = time.monotonic()
        timed_out = False
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(workdir), "PYTHONUNBUFFERED": "1"}
        try:
            proc = subprocess.run(
                command,
                cwd=str(workdir),
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            stdout, stderr, exit_code = proc.stdout, proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as e:
            timed_out = True
            stdout = (e.stdout or b"").decode("utf-8", errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
            stderr = (e.stderr or b"").decode("utf-8", errors="replace") if isinstance(e.stderr, bytes) else (e.stderr or "")
            stderr = (stderr or "") + "\n[terminated: timeout]"
            exit_code = -1
        duration_ms = int((time.monotonic() - started) * 1000)
        return SandboxResult(
            stdout=_truncate(stdout, settings.SANDBOX_MAX_OUTPUT_CHARS),
            stderr=_truncate(stderr, settings.SANDBOX_MAX_OUTPUT_CHARS),
            exit_code=exit_code,
            duration_ms=duration_ms,
            engine="local",
            timed_out=timed_out,
        )

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def is_available(self) -> bool:
        """Whether an execution engine can serve requests under the current mode."""
        mode = settings.SANDBOX_MODE
        if mode == "docker":
            return self._get_docker() is not None
        # "local" and "auto" can always execute (local fallback)
        return True

    def _resolve_engine(self) -> str:
        mode = settings.SANDBOX_MODE
        if mode == "docker":
            if self._get_docker() is None:
                raise SandboxUnavailableError("SANDBOX_MODE=docker but the Docker daemon is unreachable")
            return "docker"
        if mode == "local":
            return "local"
        # auto
        if self._get_docker() is not None:
            return "docker"
        logger.warning("Docker unavailable; falling back to LOCAL sandbox execution (not isolated)")
        return "local"

    def run_command(
        self,
        command: list,
        workdir: str,
        image: Optional[str] = None,
        timeout: Optional[int] = None,
    ) -> SandboxResult:
        """Execute a command inside the sandbox with the workspace mounted at cwd."""
        ws = _prepare_workspace(workdir)
        engine = self._resolve_engine()
        image = image or settings.SANDBOX_IMAGE
        timeout = timeout or settings.SANDBOX_TIMEOUT_SECONDS

        if engine == "docker":
            container_cmd = list(command)
            if not container_cmd or container_cmd[0] != "/bin/sh":
                container_cmd = ["/bin/sh", "-c", " ".join(command)]
            return self._run_docker(image, container_cmd, ws, timeout)

        local_cmd = list(command)
        if local_cmd and local_cmd[0] == "/bin/sh":
            local_cmd = local_cmd[2] if len(local_cmd) > 2 else ""
            return self._run_local(["/bin/sh", "-c", local_cmd], ws, timeout)
        return self._run_local(local_cmd, ws, timeout)

    def run_python(
        self,
        code: str,
        workdir: str,
        filename: str = "main.py",
        timeout: Optional[int] = None,
    ) -> SandboxResult:
        """Write code into the workspace and execute it with the sandbox interpreter."""
        ws = _prepare_workspace(workdir)
        script = ws / filename
        if not filename.endswith(".py"):
            raise ValueError("filename must end with .py")
        script.write_text(code, encoding="utf-8")
        try:
            os.chmod(script, 0o666)
        except OSError:
            pass
        engine = self._resolve_engine()
        timeout = timeout or settings.SANDBOX_TIMEOUT_SECONDS
        image = settings.SANDBOX_IMAGE
        if engine == "docker":
            return self._run_docker(image, ["python", f"/workspace/{filename}"], ws, timeout)
        # Use the current interpreter for the local fallback (always resolvable)
        return self._run_local([sys.executable, str(script)], ws, timeout)


# Singleton
sandbox_service = SandboxService()
