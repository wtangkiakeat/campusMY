/** Start an isolated real PostgreSQL cluster, run tests, and always stop it. */
import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'campusmy-pg-'));
const password = randomBytes(24).toString('hex');
const port = await new Promise((res, rej) => {
  const socket = net.createServer();
  socket.on('error', rej);
  socket.listen(0, '127.0.0.1', () => {
    const value = socket.address().port;
    socket.close(() => res(value));
  });
});
const pg = new EmbeddedPostgres({
  databaseDir: directory,
  user: 'campusmy_test',
  password,
  port,
  persistent: true,
  authMethod: 'scram-sha-256',
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  postgresFlags: ['-h', '127.0.0.1', '-k', directory],
  onLog: () => {},
  onError: (message) => process.stderr.write(String(message) + '\n'),
});
let started = false;
try {
  await pg.initialise();
  await pg.start();
  started = true;
  await pg.createDatabase('campusmy_test');
  const url = `postgresql+psycopg://campusmy_test:${password}@127.0.0.1:${port}/campusmy_test`;
  const command = process.argv.slice(2);
  const args = command.length ? command : ['-m', 'pytest', 'tests/backend', 'tests/security', 'tests/postgres', '-q'];
  const child = spawn(join(root, 'services/api/.venv/bin/python'), args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CAMPUSMY_TEST_DATABASE_URL: url },
  });
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', terminate);
  process.on('SIGTERM', terminate);
  process.exitCode = await new Promise((res, rej) => {
    child.on('error', rej);
    child.on('exit', (code) => res(code ?? 1));
  });
  process.off('SIGINT', terminate);
  process.off('SIGTERM', terminate);
} finally {
  if (started) await pg.stop();
  await rm(directory, { recursive: true, force: true });
}
