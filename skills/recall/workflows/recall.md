# Recall Workflow

Load context from past sessions — temporal queries use native JSONL files, topic queries use QMD MCP/CLI, graph queries generate interactive visualization.

## Step 1: Classify Query

Parse the user's input after `/recall` and classify:

- **Graph** — starts with "graph": "graph last week", "graph yesterday"
  → Go to Step 2C
- **Temporal** — mentions time: "yesterday", "today", "last week", "this week", a date, "what was I doing", "session history"
  → Go to Step 2A
- **Topic** — mentions a subject: "Ghost query", "authentication", "performance"
  → Go to Step 2B
- **Both** — temporal + topic: "what did I do with Ghost yesterday"
  → Go to Step 2A first, then scan results for the topic

## Step 2A: Temporal Recall (JSONL Timeline)

Run the recall-day script:

```bash
~/.claude/skills/engram-recall/.venv/bin/python3 ~/.claude/skills/engram-recall/scripts/recall-day.py list DATE_EXPR
```

Replace `DATE_EXPR` with the parsed date expression. Supported (all dates in KST):
- `yesterday`, `today`
- `YYYY-MM-DD`
- `last monday` .. `last sunday`
- `this week`, `last week`
- `N days ago`, `last N days`

Options:
- `--min-msgs N` — filter noise (default: 3)
- `--all-projects` — scan all projects, not just current

Present the table to the user. If they pick a session to expand:

```bash
~/.claude/skills/engram-recall/.venv/bin/python3 ~/.claude/skills/engram-recall/scripts/recall-day.py expand SESSION_ID
```

This shows the conversation flow (user messages, assistant first lines, tool calls).

## Step 2B: Topic Recall (QMD MCP preferred, CLI fallback)

### Primary: QMD MCP (lex + vec)

Use the `mcp__plugin_qmd_qmd__query` tool with combined search:

```json
{
  "searches": [
    { "type": "lex", "query": "KEYWORD_TERMS" },
    { "type": "vec", "query": "NATURAL_LANGUAGE_QUESTION" }
  ],
  "collections": ["my-project"],
  "limit": 10
}
```

**Strategy:**
- Extract 2-5 keywords for the `lex` query
- Rephrase as a natural question for the `vec` query
- Add `intent` if the query is ambiguous
- Search multiple collections if relevant (my-project, my-project-docs, etc.)

For top 3 results, fetch full documents with `mcp__plugin_qmd_qmd__get`.

### Fallback: QMD CLI (BM25)

If MCP is unavailable, use CLI with query expansion:

**Step 2B.1: Expand query into 3-4 keyword variants.**
Think: what other words describe this?

**Step 2B.2: Run variants in parallel:**
```bash
qmd search "VARIANT_1" -c my-project -n 5
qmd search "VARIANT_2" -c my-project -n 5
qmd search "VARIANT_3" -c my-project -n 5
```

**Step 2B.3: Deduplicate** by document path, keep highest score. Present top 5 unique results.

## Step 2C: Graph Visualization

Strip "graph" prefix from query to get the date expression. Run:

```bash
~/.claude/skills/engram-recall/.venv/bin/python3 ~/.claude/skills/engram-recall/scripts/session-graph.py DATE_EXPR
```

Options:
- `--min-files N` — only show sessions touching N+ files (default: 2, use 5+ for cleaner graphs)
- `--min-msgs N` — filter noise (default: 3)
- `--all-projects` — scan all projects
- `-o PATH` — custom output path (default: /tmp/session-graph.html)
- `--no-open` — don't auto-open browser

Tell the user the node/edge counts and what to look for (clusters, shared files).

## Step 3: Fetch Full Documents (Topic path only)

For the top 3 most relevant results, get the full document:
- MCP: `mcp__plugin_qmd_qmd__get` with the document path
- CLI: `qmd get "path/to/file.md" -l 50`

## Step 4: Present Structured Summary

**For temporal queries:** Present the session table and offer to expand any session.

**For topic queries:** Organize by relevance:
- What was worked on related to this topic
- Key dates and decisions
- Current status or next steps

**For graph queries:** Describe clusters, shared files, and patterns.

Keep concise — it's context loading, not a full report.

## Step 5: Synthesize "One Thing"

After presenting recall results, synthesize the single highest-leverage next action.

**How to pick the One Thing:**
1. Look at what has momentum — sessions with recent activity, things mid-flow
2. Look at what's blocked — removing a blocker unlocks downstream work
3. Look at what's closest to done — finishing > starting
4. Weigh urgency signals: deadlines, "blocked" status, time-sensitive content

**Format:** Bold line at the end of results:

> **One Thing: [specific, concrete action]**

**Good examples:**
- **One Thing: Ghost review count 쿼리 인덱스 추가 — 87.6% 병목의 근본 원인이고 EXISTS 변환 준비 완료**
- **One Thing: session-graph에서 발견된 공유 파일 3개의 리팩토링 — 4개 세션이 모두 건드린 핫스팟**

**Bad examples (too generic):**
- "계속 작업하세요"
- "이전 작업을 이어가세요"

If results don't have enough signal, skip it and ask "어떤 작업을 이어가시겠습니까?" instead.

## Fallback: No Results Found

```
결과 없음: "QUERY". 다음을 시도하세요:
- 다른 검색어 / 날짜 범위
- --min-msgs 1 (짧은 세션 포함)
- --all-projects (다른 프로젝트도 포함)
```
