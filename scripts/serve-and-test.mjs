/**
 * Serves the production build and runs every smoke suite against it.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.SMOKE_PORT ?? '4173';
const BASE = `http://127.0.0.1:${PORT}`;

const preview = spawn('npx', ['vite', 'preview', '--port', PORT, '--host', '127.0.0.1'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});

const waitForServer = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return false;
};

const run = (script) =>
  new Promise((resolve) => {
    const child = spawn('node', [script, BASE], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

let failures = 0;
try {
  if (!(await waitForServer())) throw new Error(`preview server did not start on ${BASE}`);
  for (const script of ['scripts/smoke.mjs', 'scripts/smoke-tools.mjs', 'scripts/smoke-offline.mjs']) {
    console.log(`\n=== ${script} ===`);
    failures += (await run(script)) === 0 ? 0 : 1;
  }
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  preview.kill('SIGTERM');
}

process.exit(failures === 0 ? 0 : 1);
