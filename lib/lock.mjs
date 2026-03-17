/**
 * File-system lock module using atomic mkdir.
 *
 * acquireLock(lockDir, options?) - Acquire an exclusive lock.
 * releaseLock(lockDir)           - Release the lock.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const TEST_RETRY_DELAY_MS = 100;

/**
 * Check whether a process with the given PID is still alive.
 *
 * @param {number} pid - Process ID to check.
 * @returns {boolean} true if the process exists.
 */
function isProcessAlive(pid) {
  try {
    // Signal 0 does not kill; it checks existence.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the PID stored inside a lock directory.
 *
 * @param {string} lockDir - Path to the lock directory.
 * @returns {number | null} The PID, or null if unreadable.
 */
function readLockPid(lockDir) {
  try {
    const raw = readFileSync(`${lockDir}/pid`, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Remove a lock directory and all its contents.
 *
 * @param {string} lockDir - Path to the lock directory.
 */
function removeLock(lockDir) {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Best-effort removal; ignore errors.
  }
}

/**
 * Sleep for the given number of milliseconds.
 *
 * @param {number} ms - Duration in milliseconds.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire a file-system lock by atomically creating a directory.
 *
 * If the lock directory already exists, the function inspects the PID file
 * inside it. When the owning process is dead (stale lock), it removes the
 * lock and retries. When the owning process is alive, it waits and retries.
 *
 * @param {string} lockDir - Path to use as the lock directory.
 * @param {object} [options]
 * @param {number} [options.retries=3]       - Max retry attempts.
 * @param {number} [options.retryDelay]      - Delay between retries in ms
 *                                             (default 10000, 100 in test).
 * @returns {Promise<boolean>} true if the lock was acquired.
 */
export async function acquireLock(lockDir, options = {}) {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelay = options.retryDelay ??
    (process.env.NODE_ENV === 'test' ? TEST_RETRY_DELAY_MS : DEFAULT_RETRY_DELAY_MS);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      mkdirSync(lockDir, { recursive: false });
      // Directory created — we own the lock. Write our PID.
      writeFileSync(`${lockDir}/pid`, String(process.pid));
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      // Lock directory already exists — check for staleness.
      const pid = readLockPid(lockDir);

      if (pid !== null && !isProcessAlive(pid)) {
        // Stale lock from a dead process — clean up and retry immediately.
        removeLock(lockDir);
        continue;
      }

      // Lock held by a live process (or PID unreadable). Wait before retry.
      if (attempt < retries) {
        await sleep(retryDelay);
      }
    }
  }

  return false;
}

/**
 * Release a previously acquired lock.
 *
 * @param {string} lockDir - Path to the lock directory.
 */
export function releaseLock(lockDir) {
  rmSync(lockDir, { recursive: true, force: true });
}
