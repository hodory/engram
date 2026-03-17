#!/usr/bin/env bash
# engram stop-hook — run memory compaction on Claude Code session end
#
# Converts CWD to sessions-md directory name and runs engram compact.
# Install: add SessionEnd hook to ~/.claude/settings.json

# Drain stdin (hook context JSON)
cat > /dev/null 2>&1 || true

PROJECT_DIR="$(pwd | tr '/' '-')"
BUN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
ENGRAM_DIR="${ENGRAM_DIR:-$HOME/workspace/engram}"
ENGRAM_CLI="$ENGRAM_DIR/cli/main.mjs"
LOG="$HOME/.claude/compaction/hook.log"

# Bail if prerequisites missing
[ -f "$ENGRAM_CLI" ] || exit 0
[ -x "$BUN" ] || exit 0

mkdir -p "$(dirname "$LOG")"

# Run compact in background to avoid blocking session exit
(
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] compact $PROJECT_DIR" >> "$LOG"
  "$BUN" "$ENGRAM_CLI" compact "$PROJECT_DIR" >> "$LOG" 2>&1
) &
