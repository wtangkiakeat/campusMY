"""Run all checks with isolated local application data and supervised servers.

Requires free loopback ports 3000/8000 and 3001/8001 for the member harness.
Never uses the configured application database or sends production email.
"""
from __future__ import annotations

import os
import argparse
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / 'services/api/.venv/bin/python'


def run(command: list[str], *, cwd=ROOT, env=None):
    print('\nChecking: ' + ' '.join(command), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def free_ports():
    for port in (3000, 8000, 3001, 8001):
        with socket.socket() as connection:
            if connection.connect_ex(('127.0.0.1', port)) == 0:
                raise RuntimeError(f'Port {port} is busy. Stop existing CampusMY test/dev servers before running check:all.')


def ready(url, children):
    deadline = time.monotonic() + 50
    while time.monotonic() < deadline:
        if any(child.poll() is not None for child in children):
            raise RuntimeError('A local test server stopped before readiness.')
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, TimeoutError):
            pass
        time.sleep(.3)
    raise RuntimeError(f'Local service was not ready: {url}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ui-only', action='store_true', help='Run planner/types/build/browser checks without repeating unchanged API/PostgreSQL suites')
    args = parser.parse_args()
    free_ports()
    env = os.environ.copy()
    env.pop('CAMPUSMY_TEST_DATABASE_URL', None)
    env.update(NEXT_TELEMETRY_DISABLED='1',
               NEXT_PUBLIC_API_URL='http://127.0.0.1:8000/api/v1',
               NEXT_PUBLIC_SUPABASE_URL='', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='',
               CAMPUSMY_NEXT_DIST_DIR='.next')
    commands = [['npm', 'run', 'test:frontend'], ['npm', 'run', 'typecheck'], ['npm', 'run', 'build']]
    if not args.ui_only:
        commands.insert(0, ['npm', 'run', 'test:api'])
        commands.append(['npm', 'run', 'test:postgres'])
    for command in commands:
        run(command, env=env)

    children = []
    with tempfile.TemporaryDirectory(prefix='campusmy-full-check-') as folder:
        local = {**env, 'CAMPUSMY_ENVIRONMENT': 'development',
                 'CAMPUSMY_DATABASE_URL': f'sqlite:///{folder}/public-test.db',
                 'CAMPUSMY_DATABASE_SCHEMA': '', 'CAMPUSMY_SUPABASE_URL': '',
                 'CAMPUSMY_AUTH_JWKS_JSON': '', 'CAMPUSMY_CREATE_TABLES': 'false',
                 'CAMPUSMY_SMTP_HOST': '', 'CAMPUSMY_SMTP_FROM': ''}
        run([str(PYTHON), '-m', 'app.cli', 'init'], cwd=ROOT / 'services/api', env=local)
        with open(Path(folder) / 'services.log', 'w+') as logs:
            try:
                children.append(subprocess.Popen([str(PYTHON), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'],
                                                 cwd=ROOT / 'services/api', env=local, stdout=logs, stderr=logs, start_new_session=True))
                children.append(subprocess.Popen(['npm', 'run', 'start', '--workspace=@campusmy/web'],
                                                 cwd=ROOT, env=local, stdout=logs, stderr=logs, start_new_session=True))
                ready('http://127.0.0.1:8000/health/ready', children)
                ready('http://127.0.0.1:3000/courses', children)
                run(['npm', 'run', 'test:browser'], env=env)
            except Exception:
                logs.flush()
                logs.seek(0)
                print(logs.read()[-12000:], file=sys.stderr)
                raise
            finally:
                for child in children:
                    if child.poll() is None:
                        os.killpg(child.pid, signal.SIGTERM)
                for child in children:
                    try:
                        child.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
    run(['node', 'tests/member-browser/run.mjs'], env=env)
    run(['node', 'tests/member-browser/run.mjs'], env={**env, 'MEMBER_BROWSER_VIEWPORT': 'mobile'})
    print('\nAll requested automated checks passed. External providers and public deployment still need configuration.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
