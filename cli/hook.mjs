/**
 * engram hook handler
 *
 * Subcommands:
 *   session-end   — run compact in background after session
 *   session-start — check version (cached 6h), auto-update if remote is newer
 */

import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/hodory/engram/master/package.json';
const CHECK_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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
// session-start: cached version check + auto-update
// ---------------------------------------------------------------------------
function sessionStart() {
  const HOME = homedir();
  const logFile = join(HOME, '.claude', 'compaction', 'hook.log');
  const cacheFile = join(HOME, '.claude', 'compaction', '.version-cache.json');
  mkdirSync(dirname(logFile), { recursive: true });

  // Check cache — skip network call if TTL not expired
  const cached = readCache(cacheFile);
  if (cached && (Date.now() - cached.checked_at) < CHECK_TTL_MS) {
    // Cache still fresh — only act if a pending update was found previously
    if (cached.remote_version && cached.needs_update) {
      applyUpdate(cached.remote_version, logFile, cacheFile);
    }
    return setTimeout(() => process.exit(0), 10);
  }

  // TTL expired — fetch remote version via GitHub raw API
  const localVersion = getLocalVersion();
  const remoteVersion = fetchRemoteVersion();

  // Save cache regardless of result
  writeCache(cacheFile, {
    checked_at: Date.now(),
    local_version: localVersion,
    remote_version: remoteVersion,
    needs_update: remoteVersion && localVersion && isNewer(remoteVersion, localVersion),
  });

  if (!remoteVersion || !localVersion) {
    return setTimeout(() => process.exit(0), 10);
  }

  if (isNewer(remoteVersion, localVersion)) {
    applyUpdate(remoteVersion, logFile, cacheFile);
  }

  setTimeout(() => process.exit(0), 10);
}

// ---------------------------------------------------------------------------
// Update logic
// ---------------------------------------------------------------------------
function applyUpdate(remoteVersion, logFile, cacheFile) {
  const HOME = homedir();
  const localVersion = getLocalVersion();
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

    // Clear needs_update flag in cache
    writeCache(cacheFile, {
      checked_at: Date.now(),
      local_version: remoteVersion,
      remote_version: remoteVersion,
      needs_update: false,
    });
  } catch (e) {
    appendFileSync(logFile, `[${timestamp}] update failed: ${e.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/** Compare semver strings. Returns true if a > b. */
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

/** Fetch remote version via GitHub raw API (~200ms, no git fetch needed). */
function fetchRemoteVersion() {
  try {
    const raw = execSync(`curl -sL --max-time 5 "${GITHUB_RAW_URL}"`, {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(raw).version;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------
function readCache(cacheFile) {
  try {
    if (!existsSync(cacheFile)) return null;
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(cacheFile, data) {
  try {
    writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* best effort */ }
}
