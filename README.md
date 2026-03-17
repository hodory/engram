# engram

QMD-powered memory compaction for Claude Code.

Generates **ROOT.md** (always-loaded topical index) + **monthly summaries** from session logs, solving the fundamental problem: *"agents can't search for knowledge they don't know exists."*

Inspired by [hipocampus](https://github.com/kevin-hs-sohn/hipocampus), simplified for QMD-first environments.

## How It Works

```
sessions-md/ (raw session logs)
     ↓  engram compact
compaction/{project}/
  ├── monthly/2026-03.md    (keyword-dense summary)
  ├── monthly/2026-02.md
  └── ROOT.md               (topical index, ~80 lines)
          ↓
     MEMORY.md              (auto-injected, always loaded by Claude Code)
```

**ROOT.md** tells the agent what topics exist across all sessions, enabling targeted QMD searches instead of blind exploration.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [QMD](https://github.com/tobi/qmd) (`bun add -g @tobilu/qmd`)
- Claude Code with `sessions-md/` pipeline (via `jsonl2md.py`)

## Installation

```bash
# Clone and link
git clone <this-repo> ~/workspace/engram
cd ~/workspace/engram
bun link

# Initialize for your project
engram init --project <project-name>
```

`init` will:
1. Create `~/.claude/compaction/{project}/` directories
2. Insert ROOT markers into your MEMORY.md
3. Add engram to your stop-hook.sh
4. Register a QMD collection for compaction data
5. Run initial compaction on all existing sessions
6. Install the compaction skill for LLM summarization

## Usage

```bash
# Run compaction (normally called by stop-hook automatically)
engram compact <project-dir>

# Full rebuild (re-process all sessions)
engram compact <project-name> --full

# Regenerate ROOT.md only
engram compact <project-name> --root-only

# Check if LLM summarization is pending
engram check-pending

# View compaction status
engram status [project-name]
```

## Architecture

```
3-level compaction (vs hipocampus's 5-level):
  Raw (sessions-md/) → Monthly summaries → ROOT.md

QMD handles all search:
  ROOT.md → "what exists?" → qmd query → specific results

No tree traversal needed — QMD's hybrid search
(BM25 + vector + reranker) replaces manual navigation.
```

### Components

| Component | File | Trigger |
|-----------|------|---------|
| Mechanical compaction | `cli/compact.mjs` | stop-hook (every session end) |
| LLM summarization | `skills/compaction/SKILL.md` | session start (when pending) |
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
