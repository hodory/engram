#!/usr/bin/env bun

const [,, cmd, ...args] = process.argv;

const commands = {
  compact:         () => import('./compact.mjs'),
  'check-pending': () => import('./check-pending.mjs'),
  hook:            () => import('./hook.mjs'),
  init:            () => import('./init.mjs'),
  status:          () => import('./status.mjs'),
  version:         async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    console.log(`engram ${pkg.version}`);
  },
};

if (!cmd || !commands[cmd]) {
  console.error('engram — QMD-powered memory compaction for Claude Code\n');
  console.error('Usage: engram <command> [args]\n');
  console.error('Commands:');
  console.error('  compact <project-dir> [--full] [--root-only]   Run compaction');
  console.error('  check-pending                                  Check for pending summarization');
  console.error('  hook <session-start|session-end>                Hook handlers');
  console.error('  init [--project <name>]                        Initialize project');
  console.error('  status [<project>]                             Show compaction status');
  console.error('  version                                        Show version');
  process.exit(cmd ? 1 : 0);
}

await commands[cmd]();
