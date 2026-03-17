# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is engram

QMD-powered memory compaction for Claude Code. JSONL 세션 로그(`~/.claude/projects/`)를 monthly summaries + ROOT.md(topical index)로 압축하여 MEMORY.md에 자동 주입. QMD hybrid search(BM25 + vector)가 세밀한 검색을 전담하고, ROOT.md는 "무엇이 존재하는지"를 알려주는 역할.

## Commands

```bash
bun test                              # 전체 테스트 (45 unit tests)
bun test tests/extract.test.mjs       # 단일 파일 테스트
bun test --grep "extractTitle"        # 패턴 매칭 테스트

bun cli/main.mjs compact <dir>        # 수동 compaction 실행
bun cli/main.mjs compact <dir> --full # 전체 재빌드
bun cli/main.mjs compact <dir> --root-only  # ROOT.md만 재생성
bun cli/main.mjs check-pending        # needs-summarization 노드 확인
bun cli/main.mjs status [project]     # compaction 상태 출력
bun cli/main.mjs init --project <name> # 프로젝트 초기화
```

## Architecture

```
~/.claude/projects/{raw-dir}/*.jsonl   (Claude Code가 직접 생성)
     ↓  engram compact
~/.claude/compaction/{project}/
  ├── monthly/{YYYY-MM}.md    (keyword-dense summary, YAML frontmatter)
  ├── ROOT.md                 (topical index, ~80줄 제한)
  └── .state.json             (last_run, monthly_nodes status)
          ↓
~/.claude/projects/{raw-dir}/memory/MEMORY.md  (ENGRAM-BEGIN/END 마커 사이 교체)
```

3-level compaction: JSONL → monthly → ROOT. jsonl2md.py 의존성 제거.

### Data Flow (compact 명령)

1. **Lock** — `lib/lock.mjs`로 mkdir atomic lock 획득 (async, PID stale detection)
2. **Scan** — `lib/resolve.mjs`가 프로젝트명 해석 + `~/.claude/projects/` JSONL 파일 탐색
3. **Extract** — `lib/extract.mjs`가 JSONL에서 첫 사용자 메시지로 제목 추출 + 키워드 빈도 분석
4. **Monthly** — `lib/monthly.mjs`가 YAML frontmatter 포함 월별 노드 생성/갱신, status lifecycle 적용
5. **ROOT** — `lib/root-gen.mjs`가 Active Context + Historical Summary + Topics Index 생성 (80줄 제한)
6. **Inject** — `lib/memory-inject.mjs`가 MEMORY.md의 `<!-- ENGRAM-BEGIN -->` / `<!-- ENGRAM-END -->` 마커 사이 교체 (200줄 총량 제한)
7. **QMD** — collection 등록 + `qmd update` (동기) + `qmd embed` (백그라운드)
8. **State** — `.state.json` 갱신 후 lock 해제

### Key Design Decisions

- **QMD 필수**: tree traversal 없음. QMD가 모든 검색 담당
- **Bun 런타임**: QMD가 Bun 의존, 동일 런타임으로 통일
- **Claude Code 전용**: 다른 플랫폼 미지원
- **MEMORY.md 인라인**: ROOT.md를 MEMORY.md의 마커 섹션에 삽입 (200줄 한도 내 truncation)
- **QMD 오케스트레이션 통합**: stop-hook의 qmd update/embed/collection 등록을 compact가 흡수
- **claude-mem과 분리**: claude-mem은 observation 기록, engram은 압축/인덱싱 (관심사 분리)

### Status Lifecycle

```
tentative → (새 세션 추가) → tentative
tentative → (세션 수 > 30 + 월 종료 7일+) → needs-summarization
needs-summarization → (LLM 요약, skills/compaction/SKILL.md) → summarized
summarized → (새 세션 추가) → tentative
tentative|summarized → (월 종료 + 7일) → fixed (불변)
```

## Testing

- 테스트 프레임워크: `bun:test` (describe/test/expect)
- fixture 디렉토리: `tests/fixtures/sessions-md/` (gitignored, 로컬에서 생성 필요)
- `lib/lock.mjs`의 `acquireLock`는 **async** 함수 (Promise 반환) — 반드시 `await` 필요
- `lib/resolve.mjs`는 테스트용 `sessionsDir` 파라미터를 받아 fixture 디렉토리로 오버라이드 가능

## Important Paths

| Path | Purpose |
|------|---------|
| `~/.claude/projects/{raw-dir}/*.jsonl` | Raw JSONL session logs (Claude Code 직접 생성) |
| `~/.claude/compaction/{project}/` | Compaction 출력 (monthly/, ROOT.md, .state.json) |
| `~/.claude/projects/{raw-dir}/memory/MEMORY.md` | ROOT 주입 대상 |
| `scripts/stop-hook.sh` | SessionEnd hook — 세션 종료 시 engram compact 자동 호출 |
| `skills/compaction/SKILL.md` | LLM 요약 skill (needs-summarization 처리) |
| `skills/recall/` | 세션 recall skill (temporal/topic/graph) |
| `~/.claude/skills/engram-recall/` | recall skill 설치 위치 (.venv 포함) |
