/** Isolated, disposable full-stack member browser test runner. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'campusmy-member-browser-'));
const fixture = join(temporary, 'fixture.json');
const children = [];
let interrupted = false;
function start(command, args, cwd, environment) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...environment }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { child, output: '', exit: undefined };
  children.push(record);
  const append = (data) => { record.output = (record.output + String(data)).slice(-40_000); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  child.on('error', (error) => { append(error); record.exit = 1; });
  child.on('exit', (code) => { record.exit = code ?? 1; });
  return record;
}
async function ready(url, processRecord, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (processRecord.exit !== undefined) throw Error(`Test service exited (${processRecord.exit}):\n${processRecord.output}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw Error(`Test service did not become ready: ${url}\n${processRecord.output}`);
}
async function cleanup() {
  for (const { child } of children.reverse()) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  for (const { child, exit } of children) {
    if (exit === undefined) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  await rm(temporary, { recursive: true, force: true });
}
process.on('SIGINT', () => { interrupted = true; void cleanup().finally(() => process.exit(130)); });
process.on('SIGTERM', () => { interrupted = true; void cleanup().finally(() => process.exit(143)); });
try {
  const api = start(join(root, 'services/api/.venv/bin/python'), [join(root, 'tests/member-browser/test_server.py')], root,
    { CAMPUSMY_MEMBER_FIXTURE: fixture });
  await ready('http://127.0.0.1:8001/health/ready', api);
  const web = start(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3001'], join(root, 'apps/web'), {
    CAMPUSMY_NEXT_DIST_DIR: '.next-member-tests',
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:8001/api/v1',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test-project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-only-publishable-key',
    NEXT_TELEMETRY_DISABLED: '1',
  });
  await ready('http://127.0.0.1:3001', web);
  const playwright = spawn(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'tests/member-browser/playwright.config.ts', ...process.argv.slice(2)], {
    cwd: root, stdio: 'inherit', env: { ...process.env, CAMPUSMY_MEMBER_FIXTURE: fixture },
  });
  process.exitCode = await new Promise((resolve, reject) => { playwright.on('error', reject); playwright.on('exit', code => resolve(code ?? 1)); });
  if (process.exitCode) {
    process.stderr.write('\nAPI output:\n' + api.output.slice(-5000) + '\nWeb output:\n' + web.output.slice(-5000));
  }
} catch (error) {
  process.stderr.write(String(error) + '\n'); process.exitCode = 1;
} finally {
  if (!interrupted) await cleanup();
}
