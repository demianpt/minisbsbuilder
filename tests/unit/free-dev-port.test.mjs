import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Reclaiming the dev port, without killing somebody else's process.
 *
 * `npm run dev` died with "Port 5173 is already in use" and took the API server
 * with it, because `concurrently -k` kills the survivors. The usual cause is a
 * previous run that was interrupted rather than stopped.
 *
 * The dangerous version of this fix kills whatever holds the port. These tests
 * exist for the other half: a listener the project does not own must be named and
 * left alone, because killing an unidentified process to free a port is a way to
 * lose somebody's work.
 */

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const SCRIPT = join(ROOT, 'scripts/free-dev-port.mjs');
/* Outside the usual dev range, so a real dev server cannot join in. */
const PORT = 5399;

let running = [];
let scratch = [];

afterEach(() => {
  for (const child of running) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  running = [];
  for (const dir of scratch) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } }
  scratch = [];
});

/** A listener whose command line and working directory we choose. */
function listener({ name, cwd }) {
  const dir = mkdtempSync(join(tmpdir(), 'sbs-port-'));
  scratch.push(dir);
  const file = join(dir, name);
  writeFileSync(file, `import { createServer } from 'node:http';
createServer((_q, s) => s.end('held')).listen(${PORT}, '127.0.0.1', () => console.log('listening'));
`);
  const child = spawn(process.execPath, [file], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  running.push(child);
  /*
   * `stopped` rather than a liveness probe.
   *
   * These listeners are children of the test process, so a signalled one stays
   * visible to `process.kill(pid, 0)` until it is reaped — the first version of
   * this test read that as "still running" and failed on a script that had
   * worked. The exit event is the thing that actually means stopped.
   */
  child.stopped = new Promise((done) => child.once('exit', () => done(true)));
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('the listener never started')), 8_000);
    child.stdout.on('data', () => { clearTimeout(timer); done(child); });
    child.on('exit', () => { clearTimeout(timer); fail(new Error('the listener exited')); });
  });
}

/** Resolves true if the child exits within the window, false if it outlives it. */
function stoppedWithin(child, ms) {
  return Promise.race([child.stopped, new Promise((done) => setTimeout(() => done(false), ms))]);
}

const reclaim = () => spawnSync(process.execPath, [SCRIPT, String(PORT)], { encoding: 'utf8' });

describe('freeing the dev port', () => {
  it('does nothing, quietly, when the port is free', () => {
    const result = reclaim();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
    expect(result.stderr.trim()).toBe('');
  });

  it('reclaims a stale dev server belonging to this project', async () => {
    // Both conditions the script requires: the working directory is the repo and
    // the command line looks like the dev client.
    const child = await listener({ name: 'vite-probe.mjs', cwd: ROOT });
    const result = reclaim();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('stale dev server from this project');
    expect(result.stdout).toContain(String(child.pid));
    expect(await stoppedWithin(child, 3_000), 'the stale server should have been stopped').toBe(true);
  });

  it('names a listener it does not own, and leaves it running', async () => {
    // Somebody else's process: not in this project, and not a dev client.
    const child = await listener({ name: 'someone-elses-server.mjs', cwd: tmpdir() });
    const result = reclaim();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('something this project does not own');
    expect(result.stderr).toContain(String(child.pid));
    // The message has to be actionable, because the script refuses to act.
    expect(result.stderr).toContain('--port');
    expect(result.stderr).toContain('PUBLIC_APP_ORIGIN');
    expect(await stoppedWithin(child, 600), 'a process we do not own must not be killed').toBe(false);
  });

  it('will not kill a project process that is not a dev server', async () => {
    // In the repo, but not the dev client — something a developer started on
    // purpose, holding the port for a reason the script cannot know.
    const child = await listener({ name: 'build-watcher.mjs', cwd: ROOT });
    const result = reclaim();
    expect(result.status).toBe(1);
    expect(await stoppedWithin(child, 600)).toBe(false);
  });
});
