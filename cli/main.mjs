#!/usr/bin/env bun

const [,, cmd, ...args] = process.argv;

const commands = {
  compact:         () => import('./compact.mjs'),
  'check-pending': () => import('./check-pending.mjs'),
  init:            () => import('./init.mjs'),
  status:          () => import('./status.mjs'),
};

if (!cmd || !commands[cmd]) {
  console.error('engram — QMD-powered memory compaction for Claude Code\n');
  console.error('Usage: engram <command> [args]\n');
  console.error('Commands:');
  console.error('  compact <project-dir> [--full] [--root-only]   Run compaction');
  console.error('  check-pending                                  Check for pending summarization');
  console.error('  init [--project <name>]                        Initialize project');
  console.error('  status [<project>]                             Show compaction status');
  process.exit(cmd ? 1 : 0);
}

await commands[cmd]();
