import { describe, expect, test } from "bun:test";
import { join } from "path";
import { homedir } from "os";

import {
  resolveProject,
  findSessionDirs,
  getMemoryPath,
  getCompactionDir,
} from "../lib/resolve.mjs";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "sessions-md");

// ---------------------------------------------------------------------------
// resolveProject
// ---------------------------------------------------------------------------

describe("resolveProject", () => {
  test("Strategy 1: workspace project extracts after -workspace-", () => {
    const result = resolveProject(
      "-Users-user-workspace-my-project",
      FIXTURES_DIR,
    );
    expect(result).toBe("my-project");
  });

  test("Strategy 1: deeper workspace path still extracts last segment", () => {
    const result = resolveProject(
      "-Users-user-workspace-some-deep-project",
      FIXTURES_DIR,
    );
    expect(result).toBe("some-deep-project");
  });

  test("Strategy 2: worktree project resolves to parent short name", () => {
    const result = resolveProject(
      "-Users-user-workspace-my-project--claude-worktrees-elastic-wu",
      FIXTURES_DIR,
    );
    expect(result).toBe("my-project");
  });

  test("Strategy 3: non-workspace dir matched by sessions-md scan", () => {
    // "-Users-user" is not a workspace path but exists in fixtures
    const result = resolveProject("-Users-user", FIXTURES_DIR);
    expect(result).toBe("-Users-user");
  });

  test("Strategy 4: unknown project falls back to raw name", () => {
    const result = resolveProject(
      "-completely-unknown-path",
      FIXTURES_DIR,
    );
    expect(result).toBe("-completely-unknown-path");
  });

  test("worktree of non-workspace project still strips worktree suffix", () => {
    // The base "-Users-user" exists in fixtures, so Strategy 3 matches
    const result = resolveProject(
      "-Users-user--claude-worktrees-fix-branch",
      FIXTURES_DIR,
    );
    expect(result).toBe("-Users-user");
  });

  test("worktree of unknown project falls back to full raw name", () => {
    const result = resolveProject(
      "-unknown-base--claude-worktrees-branch",
      FIXTURES_DIR,
    );
    // baseDir "-unknown-base" does not match workspace or sessions-md,
    // so fallback returns the original raw name
    expect(result).toBe("-unknown-base--claude-worktrees-branch");
  });

  test("uses default sessionsDir when omitted", () => {
    // Just verify it does not throw; the result depends on the real filesystem
    const result = resolveProject("-Users-user-workspace-my-project");
    expect(typeof result).toBe("string");
    expect(result).toBe("my-project");
  });
});

// ---------------------------------------------------------------------------
// findSessionDirs
// ---------------------------------------------------------------------------

describe("findSessionDirs", () => {
  test("finds main project directory", () => {
    const dirs = findSessionDirs("my-project", FIXTURES_DIR);
    expect(dirs).toContain("my-project");
  });

  test("finds worktree directories alongside main", () => {
    const dirs = findSessionDirs("my-project", FIXTURES_DIR);
    expect(dirs).toContain("my-project--claude-worktrees-elastic-wu");
    expect(dirs.length).toBe(2);
  });

  test("returns empty array for unknown project", () => {
    const dirs = findSessionDirs("nonexistent-project", FIXTURES_DIR);
    expect(dirs).toEqual([]);
  });

  test("does not include unrelated directories", () => {
    const dirs = findSessionDirs("my-project", FIXTURES_DIR);
    expect(dirs).not.toContain("-Users-user");
  });
});

// ---------------------------------------------------------------------------
// getMemoryPath
// ---------------------------------------------------------------------------

describe("getMemoryPath", () => {
  test("constructs correct path for workspace project", () => {
    const result = getMemoryPath("-Users-user-workspace-my-project");
    const expected = join(
      homedir(),
      ".claude",
      "projects",
      "-Users-user-workspace-my-project",
      "memory",
      "MEMORY.md",
    );
    expect(result).toBe(expected);
  });

  test("constructs correct path for worktree project", () => {
    const result = getMemoryPath(
      "-Users-user-workspace-my-project--claude-worktrees-elastic-wu",
    );
    const expected = join(
      homedir(),
      ".claude",
      "projects",
      "-Users-user-workspace-my-project--claude-worktrees-elastic-wu",
      "memory",
      "MEMORY.md",
    );
    expect(result).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getCompactionDir
// ---------------------------------------------------------------------------

describe("getCompactionDir", () => {
  test("constructs correct compaction path", () => {
    const result = getCompactionDir("my-project");
    const expected = join(homedir(), ".claude", "compaction", "my-project");
    expect(result).toBe(expected);
  });

  test("handles hyphenated project names", () => {
    const result = getCompactionDir("my-deep-project");
    const expected = join(homedir(), ".claude", "compaction", "my-deep-project");
    expect(result).toBe(expected);
  });
});
