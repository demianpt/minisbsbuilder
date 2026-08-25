#!/usr/bin/env node
/**
 * Clears a stale dev server off the port before Vite tries to bind it.
 *
 * `npm run dev` died with "Port 5173 is already in use" and took the API server
 * down with it, because `concurrently -k` kills the survivors. The usual cause is
 * a previous run that was interrupted rather than stopped — a crashed terminal, a
 * background start, a test run that was cancelled — leaving a listener nobody can
 * see.
 *
 * Vite's own answer is `strictPort: false`, which picks 5174 instead. That is
 * worse here: the API server checks the request origin against
 * `PUBLIC_APP_ORIGIN`, so a client on another port loads and then fails every
 * call with a CORS refusal — a broken app that looks like it started fine.
 *
 * So the port is reclaimed, but only from a process this project owns.
 *
 *   node scripts/free-dev-port.mjs [port]
 *
 * A listener belonging to something else is never touched: it is named, and the
 * script exits non-zero so the developer decides. Killing an unidentified process
 * to free a port is not a convenience, it is a way to lose somebody's work.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const PORT = Number(process.argv[2] || process.env.SBS_DEV_PORT || 5173);
const ROOT = resolve(new URL('..', import.meta.url).pathname);

function sh(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

/** PIDs listening on the port. `lsof` is on macOS and every Linux we build on. */
function listeners(port) {
  const out = sh('lsof', ['-tnP', `-iTCP:${port}`, '-sTCP:LISTEN']);
  return [...new Set(out.split('\n').map((line) => Number(line.trim())).filter(Boolean))];
}

/** The command line and working directory of a process, for identifying it. */
function describe(pid) {
  const command = sh('ps', ['-o', 'command=', '-p', String(pid)]);
  const cwdLine = sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const cwd = (cwdLine.split('\n').find((line) => line.startsWith('n')) || '').slice(1);
  return { pid, command, cwd };
}

/**
 * Whether this process is one of ours.
 *
 * Both conditions, deliberately: a Vite anywhere else on the machine is somebody
 * else's, and a process of ours that is not a dev server is not what is holding
 * the port for a reason we understand.
 */
function isOurDevServer({ command, cwd }) {
  const ours = cwd === ROOT || cwd.startsWith(`${ROOT}/`) || command.includes(ROOT);
  return ours && /\b(vite|dev:client)\b/.test(command);
}

/** A blocking pause. This script runs before anything else and has nothing to await. */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stop(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  /*
   * A moment to close the socket, then insist.
   *
   * Waited on the *port*, not on the process: a signalled child of whoever ran
   * this stays visible to `kill(pid, 0)` until its parent reaps it, so polling
   * the process would wait the full timeout every time and then escalate to
   * SIGKILL for no reason. The port is what we actually need back.
   */
  const until = Date.now() + 2_500;
  while (Date.now() < until) {
    pause(100);
    if (!listeners(PORT).includes(pid)) return true;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  pause(200);
  return true;
}

const held = listeners(PORT);
if (!held.length) process.exit(0);

const strangers = [];
for (const pid of held) {
  const info = describe(pid);
  if (!isOurDevServer(info)) { strangers.push(info); continue; }
  stop(pid);
  console.log(`Port ${PORT} was held by a stale dev server from this project (pid ${pid}). Reclaimed it.`);
}

if (strangers.length) {
  console.error(`\nPort ${PORT} is in use by something this project does not own:\n`);
  for (const { pid, command, cwd } of strangers) {
    console.error(`  pid ${pid}  ${command.slice(0, 100)}`);
    if (cwd) console.error(`            cwd ${cwd}`);
  }
  console.error(`\nStop it yourself, or run the client on another port:\n`);
  console.error(`  npm run dev:client -- --port 5175`);
  console.error(`\nIf you change the port, set PUBLIC_APP_ORIGIN in .env to match, or the`);
  console.error(`API server will refuse every request from the new origin.\n`);
  process.exit(1);
}

if (listeners(PORT).length) {
  console.error(`Port ${PORT} is still held after reclaiming it. Try again, or use another port.`);
  process.exit(1);
}
