/**
 * engram hook handler
 *
 * Subcommands:
 *   session-end   — run compact in background after session
 *   session-start — check version, auto-update if remote is newer
 */

import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, appendFileSync, readFileSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

// Drain stdin (hook context JSON) — read and discard
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {});

const subcommand = process.argv[3];

if (subcommand === 'session-end') {
  sessionEnd();
} else if (subcommand === 'session-start') {
  sessionStart();
} else {
  console.error('Usage: engram hook <session-end|session-start>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// session-end: compact in background
// ---------------------------------------------------------------------------
function sessionEnd() {
  const HOME = homedir();
  const projectDir = process.cwd().replaceAll('/', '-');
  const logFile = join(HOME, '.claude', 'compaction', 'hook.log');
  const bunPath = join(process.env.BUN_INSTALL ?? join(HOME, '.bun'), 'bin', 'bun');
  const mainMjs = join(__dirname, 'main.mjs');

  mkdirSync(dirname(logFile), { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  appendFileSync(logFile, `[${timestamp}] compact ${projectDir}\n`);

  const child = spawn(bunPath, [mainMjs, 'compact', projectDir], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data) => appendFileSync(logFile, data));
  child.stderr.on('data', (data) => appendFileSync(logFile, data));
  child.unref();

  setTimeout(() => process.exit(0), 50);
}

// ---------------------------------------------------------------------------
// session-start: version check + auto-update (only if remote is newer)
// ---------------------------------------------------------------------------
function sessionStart() {
  const HOME = homedir();
  const logFile = join(HOME, '.claude', 'compaction', 'hook.log');
  mkdirSync(dirname(logFile), { recursive: true });

  const localVersion = getLocalVersion();
  const remoteVersion = getRemoteVersion();

  if (!remoteVersion || !localVersion) {
    return setTimeout(() => process.exit(0), 10);
  }

  // Only update if remote is strictly newer
  if (!isNewer(remoteVersion, localVersion)) {
    return setTimeout(() => process.exit(0), 10);
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  appendFileSync(logFile, `[${timestamp}] update ${localVersion} → ${remoteVersion}\n`);

  try {
    execSync('git pull --ff-only origin master', {
      cwd: PACKAGE_ROOT,
      stdio: 'ignore',
      timeout: 15000,
    });

    // Re-install skills
    const bunPath = join(process.env.BUN_INSTALL ?? join(HOME, '.bun'), 'bin', 'bun');
    execSync(`"${bunPath}" "${join(__dirname, 'main.mjs')}" init --project dummy 2>/dev/null || true`, {
      cwd: PACKAGE_ROOT,
      stdio: 'ignore',
      timeout: 30000,
    });

    appendFileSync(logFile, `[${timestamp}] updated to ${remoteVersion}\n`);
    console.log(`engram updated: ${localVersion} → ${remoteVersion}`);
  } catch (e) {
    appendFileSync(logFile, `[${timestamp}] update failed: ${e.message}\n`);
  }

  setTimeout(() => process.exit(0), 10);
}

/**
 * Compare semver strings. Returns true if a > b.
 */
function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function getLocalVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return null;
  }
}

function getRemoteVersion() {
  try {
    const raw = execSync(
      'git fetch origin master --quiet 2>/dev/null && git show origin/master:package.json',
      { cwd: PACKAGE_ROOT, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return JSON.parse(raw).version;
  } catch {
    return null;
  }
}
