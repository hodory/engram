# engram

QMD-powered memory compaction for Claude Code.

Generates **ROOT.md** (always-loaded topical index) + **monthly summaries** from JSONL session logs, solving the fundamental problem: *"agents can't search for knowledge they don't know exists."*

Inspired by [hipocampus](https://github.com/kevin-hs-sohn/hipocampus), simplified for QMD-first environments.

[한국어](README.ko.md)

## How It Works

```
~/.claude/projects/{project}/*.jsonl   (Claude Code native session logs)
     ↓  engram compact
~/.claude/compaction/{project}/
  ├── monthly/2026-03.md    (keyword-dense summary)
  ├── monthly/2026-02.md
  └── ROOT.md               (topical index, ~80 lines)
          ↓
     MEMORY.md              (auto-injected, always loaded by Claude Code)
```

**ROOT.md** tells the agent what topics exist across all sessions, enabling targeted QMD searches instead of blind exploration.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [QMD](https://github.com/tobi/qmd) (optional — enables BM25 + vector search)

## Installation

```bash
git clone https://github.com/hodory/engram.git ~/workspace/engram
cd ~/workspace/engram

# Initialize for your project
bun cli/main.mjs init --project <project-name>
```

`init` will:
1. Create `~/.claude/compaction/{project}/` directories
2. Insert ROOT markers into your MEMORY.md
3. **Auto-configure SessionEnd hook** in `~/.claude/settings.json`
4. Register a QMD collection (if QMD installed)
5. Install compaction and recall skills
6. Run initial compaction on all existing sessions

No Python, no venv, no extra dependencies — just Bun.

## Usage

```bash
# Run compaction (normally called by SessionEnd hook automatically)
bun cli/main.mjs compact <project-dir>

# Full rebuild (re-process all sessions)
bun cli/main.mjs compact <project-dir> --full

# Regenerate ROOT.md only
bun cli/main.mjs compact <project-dir> --root-only

# Check if LLM summarization is pending
bun cli/main.mjs check-pending

# View compaction status
bun cli/main.mjs status [project-name]
```

## Recall

Load context from past sessions directly in Claude Code:

```bash
# Temporal — list sessions by date
bun skills/recall/scripts/recall-day.mjs list yesterday
bun skills/recall/scripts/recall-day.mjs list "last week"
bun skills/recall/scripts/recall-day.mjs list 2026-03-17

# Expand a session
bun skills/recall/scripts/recall-day.mjs expand <session-id>

# Graph — interactive session-file relationship visualization
bun skills/recall/scripts/session-graph.mjs "last week" --min-files 3
```

## Architecture

```
3-level compaction:
  JSONL (Claude Code native) → Monthly summaries → ROOT.md

QMD handles all search:
  ROOT.md → "what exists?" → qmd query → specific results

No tree traversal needed — QMD's hybrid search
(BM25 + vector + reranker) replaces manual navigation.
```

### Components

| Component | File | Trigger |
|-----------|------|---------|
| Mechanical compaction | `cli/compact.mjs` | SessionEnd hook (every session end) |
| LLM summarization | `skills/compaction/SKILL.md` | Session start (when pending) |
| Temporal recall | `skills/recall/scripts/recall-day.mjs` | `/recall` skill |
| Session graph | `skills/recall/scripts/session-graph.mjs` | `/recall graph` skill |
| Project initializer | `cli/init.mjs` | `engram init` (once) |

### Status Lifecycle

```
tentative → (new sessions added) → tentative
tentative → (session count > 30) → needs-summarization
needs-summarization → (LLM summary done) → summarized
summarized → (new sessions) → tentative
tentative|summarized → (month ended + 7 days) → fixed (immutable)
```

## ROOT.md Example

```markdown
### Active Context
- 2026-03-17: fix-deprecated v2 design, pattern expansion
- 2026-03-16: wiki-to-md skill, chrome-cdp integration
- 2026-03-12: Ghost performance analysis

### Historical Summary
- 2026-03: fix-deprecated, skills, ghost-performance
- 2026-02: admin-frontend, ghost docs, test framework

### Topics Index
ghost-performance | fix-deprecated | skills | chrome-cdp | wiki-to-md | qmd-setup
```

## License

MIT
