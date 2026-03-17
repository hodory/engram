---
name: recall
description: Load context from past sessions. Temporal queries (yesterday, last week) scan native JSONL files. Topic queries use QMD MCP (lex+vec) or CLI fallback. "recall graph" generates interactive session-file relationship visualization. Every recall ends with "One Thing" - the single highest-leverage next action. Use when user says "recall", "what did we work on", "load context about", "remember when we", "yesterday", "what was I doing", "last week", "session history", "recall graph".
argument-hint: [yesterday|today|last week|this week|TOPIC|graph DATE_EXPR]
allowed-tools: Bash(python3:*), Bash(qmd:*), Bash(pip3:*), mcp__plugin_qmd_qmd__query, mcp__plugin_qmd_qmd__get, mcp__plugin_qmd_qmd__multi_get
---

# Recall Skill

Three modes: temporal (date-based session timeline), topic (QMD search across collections), and graph (interactive visualization of session-file relationships). Every recall ends with the **One Thing** - a concrete, highest-leverage next action synthesized from the results.

## What It Does

- **Temporal queries** ("yesterday", "last week", "what was I doing"): Scans native Claude Code JSONL files by date (KST timezone). Shows a table of sessions with time, message count, and first message. Expand any session for conversation details.
- **Topic queries** ("authentication", "Ghost query"): Searches across QMD collections using MCP (lex+vec) or CLI fallback. Deduplicates and presents top results.
- **Graph queries** ("graph yesterday", "graph last week"): Generates an interactive HTML graph showing sessions as nodes connected to files they touched. Sessions colored by day, files colored by folder.
- **One Thing synthesis**: After presenting results, synthesizes the single most impactful next action based on momentum, blockers, and completion proximity.

## Usage

```
/recall yesterday
/recall last week
/recall 2026-03-14
/recall Ghost query optimization
/recall authentication work
/recall graph yesterday
/recall graph last week
/recall graph last 3 days
```

## Workflow

See `workflows/recall.md` for routing logic and step-by-step process.
