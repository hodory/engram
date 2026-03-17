/**
 * engram hook session-end
 *
 * SessionEnd hook handler — replaces scripts/stop-hook.sh.
 * Reads CWD from process, drains stdin, runs compact in background.
 */

import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Drain stdin (hook context JSON) — read and discard
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {});

const subcommand = process.argv[3];
if (subcommand !== 'session-end') {
  console.error('Usage: engram hook session-end');
  process.exit(1);
}

const HOME = homedir();
const projectDir = process.cwd().replaceAll('/', '-');
const logFile = join(HOME, '.claude', 'compaction', 'hook.log');
const bunPath = join(process.env.BUN_INSTALL ?? join(HOME, '.bun'), 'bin', 'bun');
const mainMjs = join(__dirname, 'main.mjs');

// Ensure log directory exists
mkdirSync(dirname(logFile), { recursive: true });

const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
appendFileSync(logFile, `[${timestamp}] compact ${projectDir}\n`);

// Spawn compact as detached background process
const child = spawn(bunPath, [mainMjs, 'compact', projectDir], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Pipe stdout/stderr to log file
child.stdout.on('data', (data) => appendFileSync(logFile, data));
child.stderr.on('data', (data) => appendFileSync(logFile, data));

// Detach so hook exits immediately
child.unref();

// Exit after a tick to ensure spawn is complete
setTimeout(() => process.exit(0), 50);
