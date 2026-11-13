"""Run the local website and API together; terminate both on exit."""
from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    python = ROOT / "services/api/.venv/bin/python"
    if not python.exists() or not (ROOT / "node_modules").exists():
        print("Run bash scripts/setup.sh first.", file=sys.stderr)
        return 1
    children: list[subprocess.Popen] = []
    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        for child in children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except PermissionError:
                # A supervisor may already have stopped the group. Only fall back
                # to signaling our direct child if it is actually still alive.
                if child.poll() is None:
                    child.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        env = {**os.environ, "PYTHONPATH": str(ROOT / "services/api")}
        children.append(subprocess.Popen(
            [str(python), "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
            cwd=ROOT / "services/api", env=env, start_new_session=True,
        ))
        children.append(subprocess.Popen(
            ["npm", "run", "dev:web"], cwd=ROOT, env=os.environ.copy(), start_new_session=True,
        ))
        print("CampusMY: http://localhost:3000 | API: http://localhost:8000/docs", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.3)
        return next((child.returncode for child in children if child.returncode), 0)
    except KeyboardInterrupt:
        return 0
    finally:
        stop()
        for child in children:
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
