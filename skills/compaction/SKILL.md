---
name: engram-compaction
description: Memory compaction - session start에 pending 요약 노드가 있으면 LLM으로 키워드 밀도 높은 요약 생성. "세션 시작", "session start" 시 자동 감지.
---

## Purpose

engram의 LLM 요약 단계. stop-hook에서 기계적으로 생성한 monthly 노드 중
`needs-summarization` 상태인 것을 LLM으로 키워드 밀도 높은 요약으로 변환한다.

## When to Run

세션 시작 시 자동 감지. 대부분의 세션에서는 pending 노드가 없으므로 스킵된다.

## Protocol

1. **Check pending**: Run `engram check-pending` via Bash tool
2. **No output** → 종료 (pending 없음)
3. **PENDING output** → 각 pending 노드에 대해 백그라운드 subagent 디스패치:

### Subagent Instructions

For each `PENDING:{project}:{path}` line:

a. Read the monthly node at `~/.claude/compaction/{project}/{path}`
b. Use `qmd search` with key topics from the node to find related sessions:
   ```
   qmd search "{topic keywords}" --collection {project} --limit 10
   ```
c. Generate a keyword-dense summary (optimized for BM25 search):
   - Focus on: what was done, key decisions, tools/technologies used
   - Include: specific names, identifiers, error messages, file paths
   - Exclude: conversational filler, tool output details
   - Maximum 300 lines
d. Update the monthly node: replace content, set `status: summarized`
e. Regenerate ROOT.md: `engram compact {project} --root-only`

### Constraints

- Process maximum 2 monthly nodes per session start
- Use Haiku model for subagents (cost efficiency)
- All work in background subagent — do not pollute main context
- If engram CLI is not available, skip silently
