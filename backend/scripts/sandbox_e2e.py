#!/usr/bin/env python
"""
End-to-end verification of the secure sandbox service and its agent tools.

Checks (in order): workspace creation, sandboxed Python execution, terminal
execution, file tools with path-traversal guard, network isolation, and
workspace cleanup.

Usage:
    ./venv/bin/python scripts/sandbox_e2e.py            # auto: docker if daemon, else local
    ./venv/bin/python scripts/sandbox_e2e.py --docker   # force docker (fails if daemon unreachable)

Exit code 0 = all applicable checks passed.
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.services.sandbox_service import sandbox_service
from app.agents.tools import build_sandbox_tools


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", action="store_true", help="force the Docker engine")
    args = parser.parse_args()

    if args.docker:
        settings.SANDBOX_MODE = "docker"

    steps: list = []
    last_engine = "n/a"

    def record(name: str, ok: bool, detail: str = "") -> None:
        steps.append({"step": name, "ok": ok, "detail": detail})
        print(("PASS " if ok else "FAIL ") + f"{name}" + (f" — {detail}" if detail else ""))

    # 1. Workspace lifecycle
    ws = sandbox_service.create_workspace("e2e")
    record("workspace.create", Path(ws).is_dir(), ws)

    # 2. Sandboxed Python
    r = sandbox_service.run_python("print('answer:', 40 + 2)", ws)
    last_engine = r.engine
    record(
        "python.exec",
        r.exit_code == 0 and "answer: 42" in r.stdout,
        f"engine={r.engine} stdout={r.stdout.strip()[:80]!r}",
    )

    # 3. Sandboxed terminal
    r = sandbox_service.run_command(["/bin/sh", "-c", "ls -la"], ws)
    last_engine = r.engine
    record("terminal.exec", r.exit_code == 0 and "total" in r.stdout, f"engine={r.engine}")

    # 4. File tools (write → read round-trip)
    tools = build_sandbox_tools(ws)
    out = tools[2].invoke({"file_path": "hello.txt", "content": "sandbox e2e"})
    record("tools.write_file", out.startswith("OK"), out[:80])
    out = tools[3].invoke({"file_path": "hello.txt"})
    record("tools.read_file", out == "sandbox e2e", repr(out[:40]))

    # 5. Path-traversal guard
    out = tools[2].invoke({"file_path": "../escape.txt", "content": "nope"})
    record("tools.path_guard", out.startswith("Error"), out[:100])

    # 6. Network isolation (docker only; local engine is documented dev-only)
    r = sandbox_service.run_python(
        "import socket\n"
        "try:\n"
        "    socket.create_connection(('example.com', 80), timeout=3)\n"
        "    print('NET_OK')\n"
        "except Exception as e:\n"
        "    print('NET_BLOCKED', type(e).__name__)\n",
        ws,
    )
    last_engine = r.engine
    net_out = r.stdout.strip()
    if r.engine == "docker":
        record("network.isolation", "NET_BLOCKED" in net_out, net_out[:80])
    else:
        record(
            "network.isolation",
            True,
            f"skipped — engine=local has no network isolation (seen: {net_out[:60]!r})",
        )

    # 7. Cleanup
    sandbox_service.cleanup_workspace(ws)
    time.sleep(0.1)
    record("workspace.cleanup", not Path(ws).exists(), ws)

    failed = [s["step"] for s in steps if not s["ok"]]
    summary = {"engine": last_engine, "ok": not failed, "failed": failed, "steps": steps}
    print(json.dumps(summary, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
