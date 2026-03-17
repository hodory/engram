/**
 * Project name resolution module for engram.
 *
 * Resolves raw Claude Code project directory names (e.g.,
 * "-Users-user-workspace-my-project") into short project names
 * (e.g., "my-project") and provides helpers for locating session
 * directories, memory files, and compaction output paths.
 */

import { join } from "path";
import { homedir } from "os";
import { readdirSync } from "fs";

const CLAUDE_DIR = join(homedir(), ".claude");
const DEFAULT_SESSIONS_DIR = join(CLAUDE_DIR, "sessions-md");

/**
 * Resolve a raw Claude Code project directory name into a short project name.
 *
 * Strategies (tried in order):
 *   1. Workspace project -- extract segment after "-workspace-"
 *   2. Worktree -- extract parent project from before "--claude-worktrees-"
 *   3. Direct match against sessions-md directory candidates
 *   4. Fallback to the raw name unchanged
 *
 * @param {string} projectDir  Raw project dir name
 * @param {string} [sessionsDir]  Override for sessions-md path (testing)
 * @returns {string} Short project name
 */
export function resolveProject(projectDir, sessionsDir = DEFAULT_SESSIONS_DIR) {
  // Strategy 2 first: strip worktree suffix so strategies 1 & 3 work on the base name.
  const worktreeMarker = "--claude-worktrees-";
  const baseDir = projectDir.includes(worktreeMarker)
    ? projectDir.slice(0, projectDir.indexOf(worktreeMarker))
    : projectDir;

  // Strategy 1: workspace project -- grab everything after the last "-workspace-"
  const workspaceMarker = "-workspace-";
  const workspaceIdx = baseDir.lastIndexOf(workspaceMarker);
  if (workspaceIdx !== -1) {
    return baseDir.slice(workspaceIdx + workspaceMarker.length);
  }

  // Strategy 3: scan sessions-md for a directory that matches baseDir
  const candidates = listSessionCandidates(sessionsDir);
  if (candidates.includes(baseDir)) {
    return baseDir;
  }

  // Strategy 4: fallback -- return the raw name as-is
  return projectDir;
}

/**
 * Find all sessions-md directories that belong to a given short project name.
 *
 * This includes the main project directory as well as any worktree directories
 * whose name starts with `{projectShortName}--claude-worktrees-`.
 *
 * @param {string} projectShortName  Short project name (e.g., "my-project")
 * @param {string} [sessionsDir]  Override for sessions-md path (testing)
 * @returns {string[]} Matching directory names (not full paths)
 */
export function findSessionDirs(projectShortName, sessionsDir = DEFAULT_SESSIONS_DIR) {
  const candidates = listSessionCandidates(sessionsDir);
  const worktreePrefix = `${projectShortName}--claude-worktrees-`;

  return candidates.filter(
    (name) => name === projectShortName || name.startsWith(worktreePrefix),
  );
}

/**
 * Return the path to MEMORY.md for a given raw project directory.
 *
 * @param {string} projectDir  Raw project dir name
 * @returns {string} Absolute path to MEMORY.md
 */
export function getMemoryPath(projectDir) {
  return join(CLAUDE_DIR, "projects", projectDir, "memory", "MEMORY.md");
}

/**
 * Return the compaction output directory for a short project name.
 *
 * @param {string} projectShortName  Short project name
 * @returns {string} Absolute path to compaction directory
 */
export function getCompactionDir(projectShortName) {
  return join(CLAUDE_DIR, "compaction", projectShortName);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * List immediate child directory names inside `sessionsDir`.
 * Returns an empty array when the directory does not exist.
 *
 * @param {string} sessionsDir
 * @returns {string[]}
 */
function listSessionCandidates(sessionsDir) {
  try {
    return readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
