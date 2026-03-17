# engram

Claude Code를 위한 QMD 기반 메모리 압축 도구.

JSONL 세션 로그에서 **ROOT.md**(항상 로드되는 토픽 인덱스) + **월별 요약**을 생성하여, *"에이전트가 존재하는지 모르는 지식을 검색할 수 없는"* 근본적인 문제를 해결합니다.

[hipocampus](https://github.com/kevin-hs-sohn/hipocampus)에서 영감을 받아 QMD 환경에 최적화했습니다.

[English](README.md)

## 작동 방식

```
~/.claude/projects/{project}/*.jsonl   (Claude Code 네이티브 세션 로그)
     ↓  engram compact
~/.claude/compaction/{project}/
  ├── monthly/2026-03.md    (키워드 밀도 높은 요약)
  ├── monthly/2026-02.md
  └── ROOT.md               (토픽 인덱스, ~80줄)
          ↓
     MEMORY.md              (자동 주입, Claude Code가 항상 로드)
```

**ROOT.md**는 에이전트에게 모든 세션에 어떤 토픽이 존재하는지 알려주어, 맹목적인 탐색 대신 정확한 QMD 검색을 가능하게 합니다.

## 사전 요구사항

- [Bun](https://bun.sh) >= 1.0
- [QMD](https://github.com/tobi/qmd) (선택 — BM25 + 벡터 검색 활성화)

## 설치

```bash
git clone https://github.com/hodory/engram.git ~/workspace/engram
cd ~/workspace/engram

# 프로젝트 초기화
bun cli/main.mjs init --project <프로젝트명>
```

`init`이 수행하는 작업:
1. `~/.claude/compaction/{project}/` 디렉토리 생성
2. MEMORY.md에 ROOT 마커 삽입
3. **`~/.claude/settings.json`에 SessionEnd hook 자동 설정**
4. QMD 컬렉션 등록 (QMD 설치 시)
5. compaction 및 recall 스킬 설치
6. 기존 세션에 대한 초기 compaction 실행

Python 불필요, venv 불필요 — Bun만 있으면 됩니다.

## 사용법

```bash
# compaction 실행 (보통 SessionEnd hook이 자동 호출)
bun cli/main.mjs compact <project-dir>

# 전체 재빌드 (모든 세션 재처리)
bun cli/main.mjs compact <project-dir> --full

# ROOT.md만 재생성
bun cli/main.mjs compact <project-dir> --root-only

# LLM 요약 대기 상태 확인
bun cli/main.mjs check-pending

# compaction 상태 확인
bun cli/main.mjs status [project-name]
```

## Recall (세션 회상)

Claude Code에서 과거 세션의 컨텍스트를 로드합니다:

```bash
# 시간 기반 — 날짜별 세션 목록
bun skills/recall/scripts/recall-day.mjs list yesterday
bun skills/recall/scripts/recall-day.mjs list "last week"
bun skills/recall/scripts/recall-day.mjs list 2026-03-17

# 세션 상세 보기
bun skills/recall/scripts/recall-day.mjs expand <session-id>

# 그래프 — 세션-파일 관계 인터랙티브 시각화
bun skills/recall/scripts/session-graph.mjs "last week" --min-files 3
```

## 아키텍처

```
3단계 압축:
  JSONL (Claude Code 네이티브) → 월별 요약 → ROOT.md

QMD가 모든 검색 담당:
  ROOT.md → "무엇이 존재하는가?" → qmd query → 정확한 결과

트리 탐색 불필요 — QMD의 하이브리드 검색
(BM25 + vector + reranker)이 수동 탐색을 대체.
```

### 구성요소

| 구성요소 | 파일 | 트리거 |
|---------|------|--------|
| 기계적 압축 | `cli/compact.mjs` | SessionEnd hook (세션 종료 시) |
| LLM 요약 | `skills/compaction/SKILL.md` | 세션 시작 (대기 상태 감지 시) |
| 시간 기반 recall | `skills/recall/scripts/recall-day.mjs` | `/recall` 스킬 |
| 세션 그래프 | `skills/recall/scripts/session-graph.mjs` | `/recall graph` 스킬 |
| 프로젝트 초기화 | `cli/init.mjs` | `engram init` (1회) |

### 상태 생명주기

```
tentative → (새 세션 추가) → tentative
tentative → (세션 수 > 30) → needs-summarization
needs-summarization → (LLM 요약 완료) → summarized
summarized → (새 세션 추가) → tentative
tentative|summarized → (월 종료 + 7일) → fixed (불변)
```

## ROOT.md 예시

```markdown
### Active Context
- 2026-03-17: fix-deprecated v2 설계, 패턴 확장
- 2026-03-16: wiki-to-md 스킬, chrome-cdp 연동
- 2026-03-12: Ghost 성능 분석

### Historical Summary
- 2026-03: fix-deprecated, skills, ghost-performance
- 2026-02: admin-frontend, ghost docs, test framework

### Topics Index
ghost-performance | fix-deprecated | skills | chrome-cdp | wiki-to-md | qmd-setup
```

## 라이선스

MIT
