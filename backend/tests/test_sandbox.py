"""Sandbox service and sandboxed-tools tests.

The Docker-backed tests skip automatically when no daemon is reachable,
so CI environments without Docker still validate the local engine, the
workspace lifecycle, and the path-traversal guard.
"""
import pytest
from pathlib import Path

from app.core.config import settings
from app.services.sandbox_service import sandbox_service
from app.agents.tools import build_sandbox_tools


@pytest.fixture
def local_sandbox(monkeypatch):
    """Force the local engine for deterministic, dependency-free tests."""
    monkeypatch.setattr(settings, "SANDBOX_MODE", "local")
    return sandbox_service


def test_workspace_lifecycle():
    ws = sandbox_service.create_workspace("pytest-lc")
    assert Path(ws).is_dir()
    sandbox_service.cleanup_workspace(ws)
    assert not Path(ws).exists()


def test_local_python_execution(local_sandbox):
    ws = sandbox_service.create_workspace("pytest-py")
    try:
        result = sandbox_service.run_python("print('answer:', 40 + 2)", ws)
        assert result.exit_code == 0
        assert "answer: 42" in result.stdout
        assert result.engine == "local"
        assert result.timed_out is False
    finally:
        sandbox_service.cleanup_workspace(ws)


def test_local_terminal_execution(local_sandbox):
    ws = sandbox_service.create_workspace("pytest-sh")
    try:
        result = sandbox_service.run_command(["/bin/sh", "-c", "echo hello sandbox"], ws)
        assert result.exit_code == 0
        assert "hello sandbox" in result.stdout
    finally:
        sandbox_service.cleanup_workspace(ws)


def test_local_timeout_enforcement(local_sandbox):
    ws = sandbox_service.create_workspace("pytest-to")
    try:
        result = sandbox_service.run_python(
            "import time; time.sleep(30); print('done')", ws, timeout=2
        )
        assert result.timed_out is True
        assert result.exit_code != 0
        assert "done" not in result.stdout
    finally:
        sandbox_service.cleanup_workspace(ws)


def test_tool_file_roundtrip_and_guard(local_sandbox):
    ws = sandbox_service.create_workspace("pytest-tools")
    try:
        tools = build_sandbox_tools(ws)
        # tools order: run_python, run_terminal, write_file, read_file, list_files
        assert tools[2].invoke({"file_path": "a/b.txt", "content": "nested"}) == "OK: wrote 6 chars to a/b.txt"
        assert tools[3].invoke({"file_path": "a/b.txt"}) == "nested"
        listing = tools[4].invoke({})
        assert "a" in listing
        # Path traversal must be rejected, never leave the workspace
        guard = tools[2].invoke({"file_path": "../escape.txt", "content": "x"})
        assert guard.startswith("Error")
        assert "escapes the agent workspace" in guard
        # Absolute path outside workspace must be rejected too
        abs_guard = tools[2].invoke({"file_path": "/tmp/opencode/escape.txt", "content": "x"})
        assert abs_guard.startswith("Error")
    finally:
        sandbox_service.cleanup_workspace(ws)


def test_docker_execution_when_available():
    if sandbox_service._get_docker() is None:
        pytest.skip("Docker daemon not available")
    ws = sandbox_service.create_workspace("pytest-docker")
    try:
        result = sandbox_service.run_python("print('docker ok')", ws)
        assert result.engine == "docker"
        assert result.exit_code == 0
        assert "docker ok" in result.stdout
    finally:
        sandbox_service.cleanup_workspace(ws)
