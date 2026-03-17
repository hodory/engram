import { describe, expect, test, afterEach } from 'bun:test';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { acquireLock, releaseLock } from '../lib/lock.mjs';

/**
 * Generate a unique lock directory path under /tmp to avoid test collisions.
 */
function tempLockDir() {
  const random = Math.random().toString(36).slice(2, 10);
  return `/tmp/engram-test-lock-${random}`;
}

/** Collected lock dirs for cleanup. */
const lockDirs = [];

afterEach(() => {
  for (const dir of lockDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  lockDirs.length = 0;
});

describe('acquireLock / releaseLock', () => {
  test('acquires and releases lock', async () => {
    const dir = tempLockDir();
    lockDirs.push(dir);

    const acquired = await acquireLock(dir, { retries: 0, retryDelay: 10 });

    expect(acquired).toBe(true);
    expect(existsSync(dir)).toBe(true);

    // PID file should contain our process ID
    const storedPid = readFileSync(`${dir}/pid`, 'utf8').trim();
    expect(Number(storedPid)).toBe(process.pid);

    releaseLock(dir);
    expect(existsSync(dir)).toBe(false);
  });

  test('fails when already locked (retries: 0)', async () => {
    const dir = tempLockDir();
    lockDirs.push(dir);

    // Simulate an existing lock held by a live process (our own PID)
    mkdirSync(dir, { recursive: false });
    writeFileSync(`${dir}/pid`, String(process.pid));

    const acquired = await acquireLock(dir, { retries: 0, retryDelay: 10 });

    expect(acquired).toBe(false);
    // Original lock should still exist
    expect(existsSync(dir)).toBe(true);
  });

  test('detects and cleans stale lock (dead PID)', async () => {
    const dir = tempLockDir();
    lockDirs.push(dir);

    // Create a lock with a PID that almost certainly does not exist.
    // PID 2147483647 (max 32-bit) is extremely unlikely to be running.
    const fakePid = 2147483647;
    mkdirSync(dir, { recursive: false });
    writeFileSync(`${dir}/pid`, String(fakePid));

    const acquired = await acquireLock(dir, { retries: 1, retryDelay: 10 });

    expect(acquired).toBe(true);

    // Should now contain our PID, not the stale one
    const storedPid = readFileSync(`${dir}/pid`, 'utf8').trim();
    expect(Number(storedPid)).toBe(process.pid);

    releaseLock(dir);
  });

  test('releaseLock is safe on non-existent directory', () => {
    const dir = tempLockDir();
    // Should not throw
    expect(() => releaseLock(dir)).not.toThrow();
  });
});
