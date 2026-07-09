# Claude Code 설정 전체 감사 리포트

- **날짜**: 2026-06-18
- **범위**: 글로벌(`~/.claude/`, `~/.claude.json`) + 프로젝트(`gons-dashboard`)
- **모드**: 진단 후 사용자 승인 항목 적용 완료 (2026-06-18).
- **검증 방식**: 직접 실행(`claude mcp list`, `ToolSearch`, settings 파일 읽기, git log, 파일 실재 확인). 추측 금지.
- **백업**: `~/.claude/_audit-backup-20260618/` (settings.json, 두 CLAUDE.md, claude.json, 관련 rules)

## ✅ 적용 완료 요약 (사용자 승인 후)

| 항목 | 처리 | 검증 |
|------|------|------|
| C-1 프로세스 강도 충돌 | `~/.claude/CLAUDE.md` 상단 §0 단일 권위 규칙 추가 (Simplicity 기본 + 조건부 중량 프로세스) | grep 확인 |
| R-2 Ruflo 블록 (글로벌) | `~/.claude/CLAUDE.md`의 4줄 "Ruflo Integration" 제거 | 잔존 0 |
| **R-2 home CLAUDE.md (최대 광맥)** | **`/home/gon/CLAUDE.md` 175줄 통째 제거** (전부 Ruflo, 매 세션 로드되던 죽은 설정) | 부재 확인 |
| R-3 claude-flow env | settings.json `CLAUDE_FLOW_V3_ENABLED`/`CLAUDE_FLOW_HOOKS_ENABLED` 제거 | 0개 |
| R-3 claude-flow 권한 | settings.json `npx @claude-flow*`/`npx claude-flow*`/`node .claude/*` 제거 | 0개 |
| R-4 ruflo 플러그인 | settings.json 5개 `true`→`false` 비활성화 | true 0개 |
| ruflo MCP 서버 | `~/.claude.json`의 `ruflo` mcpServer 제거 (redis 보존) | redis만 남음 |
| C-2 attribution | `korean-response.md` 커밋 템플릿 Co-Authored-By 2곳 제거 | 잔존 0 |
| **Q-2 rtk 훅** | settings.json PreToolUse Bash 훅(`rtk hook claude`) 제거 → `hooks:{}` | ls 정상화 확인 |

### 적용 안 함 (사용자 결정)
- **Q-1 ECC 언어별 rules**: 그대로 유지 (autoUpdate 플러그인 산출물 + SUSPECTED).
- **S-1/S-2 모델·thinking stale**: ECC 플러그인 산출물(`rules/ecc/common/performance.md`)이라 편집 시 덮어쓰임 → 미적용. CLAUDE.md/메모리 쪽 모델 ID는 실동작(proxy 문자열 분기) 영향 없어 보류.

### 철회 (조사 중 오류 자정)
- **D-1/D-2**: rtk가 `ls`를 거짓 "(empty)"로 만들어 statusline.sh·graphify를 dead로 오판 → `find`/`cat` 재검증 후 철회 (둘 다 실재).
- **메모리 경로 일반화**: `~/.claude/projects/-home-gon/memory/MEMORY.md` 실재 확인 후 원복 (정보 손실 방지).

---

---

## 0. 증거 강도 버킷 정의

| 버킷 | 의미 | 권장 강도 |
|------|------|----------|
| 🔴 **PROVEN-DEAD** | 존재하지 않는 파일/도구/경로를 참조 | 즉시 제거/수정 권장 |
| 🟠 **CONFLICT** | 레이어 간 명백한 모순 (양쪽 원문 확인됨) | 우선순위 정리 권장 |
| 🟡 **STALE** | 모델 ID·날짜 등 시간이 지나 틀림 | 갱신 권장 |
| 🔵 **SUSPECTED** | 미사용 의심되나 읽기만으로 미증명 | **삭제 권장 안 함, 질문** |

> ⚠️ **글로벌(`~/.claude/`) 변경은 모든 프로젝트에 영향** — blast radius가 프로젝트 설정과 다릅니다. 글로벌 항목엔 [G] 표시.

---

## 1. 🔴 PROVEN-DEAD — 존재하지 않는 것을 가리키는 참조

> **이 섹션은 없음.** 최초 조사에서 D-1(statusline.sh 부재), D-2(graphify SKILL.md 부재)를
> PROVEN-DEAD로 판정했으나, **`find`/`cat` 재검증 결과 둘 다 거짓 양성**이었다.
> 이 환경의 `ls -la <dir>`이 비어있지 않은 디렉토리에도 "(empty)"를 반환하는 버그가 있어,
> 그에 의존한 판정이 모두 무효였다. (메모리 파일 수 "1개"도 같은 버그 — 실제 48개.)
>
> **재검증 사실 (find/cat 근거)**:
> - `~/.claude/hooks/statusline.sh` **실재** (README.md, hooks.json, post-commit, pre-commit 동반) → statusLine 설정 정상. **변경 불필요.**
> - `~/.claude/skills/graphify/SKILL.md` **실재** (skills 디렉토리에 112개 스킬) → CLAUDE.md 경로 안내 정확. **변경 불필요.**
> - 메모리 개별 파일 **48개** → §6대로 건강.
>
> **교훈**: 이 환경에서 디렉토리 존재/부재 판정은 `ls`가 아니라 `find`/`cat`으로 해야 함.

---

## 2. 🟠 CONFLICT — 레이어 간 모순 (사용자가 명시한 핵심 목표)

### C-1 [G] ⭐ 프로세스 강도 정면 충돌 (가장 중요)
매 작업마다 정반대로 당기는 지침들이 공존합니다.

| 쪽 | 출처 | 지침 |
|----|------|------|
| **간결/판단** | `~/.claude/CLAUDE.md` | "Simplicity First", "Minimum code", "trivial엔 판단" |
| **간결/판단** | `gons-dashboard/CLAUDE.md` | "Do what has been asked; nothing more, nothing less" |
| **↔ 충돌 ↔** | | |
| **항상 중량 프로세스** | `rules/ecc/common/development-workflow.md` | "MANDATORY: planner agent → TDD → 80% coverage → code-reviewer" |
| **항상 중량 프로세스** | `rules/ecc/common/testing.md` | "MANDATORY workflow: 테스트 먼저, 80% 최소" |
| **항상 병렬** | `/home/gon/CLAUDE.md`, `rules/ecc/common/agents.md` | "ALWAYS use parallel Task", "ALWAYS swarm for 3+ files" |
| **항상 brainstorming/TDD** | superpowers `using-superpowers` | "ALWAYS TDD", "모든 창작 전 brainstorming" |

- **증거**: 위 모든 파일 원문 확인됨. superpowers는 SessionStart로 강제 주입됨.
- **영향**: 작은 작업에도 brainstorming·planner·TDD를 강제당하거나, 반대로 무시할 근거가 동시에 존재 → 일관성 없음. (단 superpowers는 "user instructions 최우선"이라 명시하므로 CLAUDE.md가 이기긴 함)
- **권장**: **단일 우선순위 문장을 한 곳(`~/.claude/CLAUDE.md` 최상단)에 명시**. 예: "기본은 Simplicity. planner/TDD/brainstorming은 (a) 다중 파일 기능 (b) 버그 재현 가능 시에만. trivial 작업은 즉시 실행." — 그리고 ECC development-workflow.md의 "MANDATORY"를 "권장(조건부)"로 톤 조정.
- **[ ] 승인** (충돌 인정 + 단일 규칙 도입):

### C-2 [G] attribution 모순 (3-way)
| 쪽 | 출처 | 내용 |
|----|------|------|
| disabled | `rules/ecc/common/git-workflow.md` | "Attribution disabled globally via ~/.claude/settings.json" |
| 템플릿에 포함 | `rules/korean-response.md` | 커밋 템플릿에 `Co-Authored-By: Claude` |
| 세션 강제 | 이 세션 지시 | "Co-Authored-By: Claude Opus 4.8 (1M context)" |

- **증거**: `settings.json`엔 attribution 비활성 키가 **실제로 없음**(git-workflow.md 주장 거짓). 최근 30개 커밋 중 **6개만** Co-Authored-By 포함 → 실제 동작은 혼재.
- **권장**: 한 가지로 통일. (Co-Authored-By를 쓸지 말지 결정 → 안 쓸 거면 korean-response.md 템플릿에서 제거, git-workflow.md의 거짓 문구 수정.)
- **[ ] 승인**:

### C-3 [G] Ruflo CLAUDE.md vs behavioral CLAUDE.md 톤 충돌
- `/home/gon/CLAUDE.md`(Ruflo): "swarm/SendMessage/15 agents/hierarchical-mesh" 중심
- `~/.claude/CLAUDE.md`(behavioral): "Simplicity/Surgical changes" 중심
- **증거**: 둘 다 글로벌이지만 `/home/gon/CLAUDE.md`는 **이 프로젝트엔 로드 안 됨**(상위 디렉토리). `/home/gon` 직하위 작업에서만 로드.
- **권장**: §3(Ruflo dead 처리)과 묶어서 처리.
- **[ ] 승인**:

---

## 3. 🔴+🟠 Ruflo / claude-flow — 최대 광맥 (거의 죽은 시스템)

가장 큰 정리 기회. **설정은 방대하나 이 환경에 연결 안 됨.**

### R-1 claude-flow MCP 도구 미연결 (확정)
- **증거**:
  - `ToolSearch("swarm_init", "memory_store", "hooks_route", "agent_spawn")` → **"No matching deferred tools found"**
  - `claude mcp list` → 연결된 MCP에 ruflo/claude-flow **없음** (PlayMCP/Slack/Gmail/Calendar/Drive/Zapier/playwright/chrome-devtools만)
  - `~/.claude.json`: `mcpServers`는 `/home/gon` 프로젝트에만 `ruflo` 등록 → 현재 프로젝트엔 미적용
- **결론**: `swarm_init`·`memory_store`·`hooks_route`·`agent_spawn` 등 **CLAUDE.md가 권하는 MCP 도구가 이 세션에 하나도 없음**.

### R-2 [G] 두 CLAUDE.md의 Ruflo 지시문 = 죽은 안내
- **위치**: `~/.claude/CLAUDE.md`의 "Ruflo Integration" 블록 + `/home/gon/CLAUDE.md` **전체 175줄**(swarm, routing, memory CLI, `npx @claude-flow/cli` 명령들)
- **증거**: R-1. 실제 메모리 로그상 모든 작업은 평범한 Edit/Bash/Agent/advisor/PR 기반 — swarm/memory_store 사용 흔적 0.
- **권장**:
  - `/home/gon/CLAUDE.md`(Ruflo 전용)는 사실상 미사용 → **보관 또는 축소**. (현 프로젝트엔 영향 없으나 `/home/gon` 직하위 작업 시 죽은 지시문)
  - `~/.claude/CLAUDE.md`의 "Ruflo Integration" 블록 제거 검토.
- **[ ] 승인** (Ruflo 지시문 정리):

### R-3 [G] settings.json의 claude-flow env / 권한 stale
- **위치**: `~/.claude/settings.json`
  - `env`: `CLAUDE_FLOW_V3_ENABLED:"true"`, `CLAUDE_FLOW_HOOKS_ENABLED:"true"`
  - `permissions.allow`: `Bash(npx @claude-flow*)`, `Bash(npx claude-flow*)`, `Bash(node .claude/*)`
- **증거**: R-1로 시스템 미연결.
- **권장**: 두 env 키 제거 + claude-flow 관련 권한 3개 제거(미사용).
- **주의**: `~/.claude-flow` 디렉토리(2026-05-14)는 데이터일 수 있으니 삭제 전 내용 확인.
- **[ ] 승인**:

### R-4 [G] 5개 ruflo 플러그인 활성 여부
- **위치**: `settings.json.enabledPlugins` — `ruflo-agentdb/core/swarm/autopilot/federation` 5개 `true`
- **증거**: 스킬/에이전트 목록엔 등장(플러그인 로드는 됨)하나, 핵심 MCP 도구(swarm_init 등)는 미연결(R-1).
- **버킷**: 🔵 **SUSPECTED** — 플러그인이 스킬만 제공하고 MCP는 별도일 수 있음. 자동 비활성 권장 안 함.
- **질문**: ruflo 스킬(`ruflo-swarm:swarm` 등)을 실제로 쓰시나요? 안 쓰면 5개 플러그인 비활성으로 스킬 목록·컨텍스트 대폭 슬림화 가능.
- **[ ] 답변 필요**:

---

## 4. 🟡 STALE — 시간이 지나 틀린 값

### S-1 [G] 모델 ID/설명 구식
| 위치 | 현재 기재 | 실제 |
|------|----------|------|
| `rules/ecc/common/performance.md` | "Opus 4.5 = 최고 추론, Sonnet 4.6, Haiku 4.5" | Opus **4.8** 환경 |
| `~/.claude/CLAUDE.md` (Ruflo 3-tier) | (claude-flow 라우팅 표) | 미연결 |
| 프로젝트 `CLAUDE.md` AI 정책 | `claude-opus-4-7` 라우팅 | proxy는 모델 문자열 분기 — 4-8 추가 가능 |
- **권장**: performance.md 모델 표 갱신(Opus 4.8 반영). 프로젝트 CLAUDE.md는 proxy 라우팅 문자열이라 실동작 영향은 적으나 4-7→4-8 명기 검토.
- **[ ] 승인**:

### S-2 [G] performance.md의 thinking 토큰 안내 구식
- **위치**: `rules/ecc/common/performance.md` — "31,999 tokens 예약, Option+T 토글"
- **증거**: `settings.json`에 `alwaysThinkingEnabled:false`, `effortLevel:"xhigh"` — 별개 메커니즘.
- **권장**: effortLevel 기반 현행 설명으로 갱신.
- **[ ] 승인**:

---

## 5. 🔵 SUSPECTED — 미사용 의심 (삭제 권장 안 함, 질문)

### Q-1 [G] ECC 언어별 rules 11종 (5438줄 중 대부분)
- **위치**: `~/.claude/rules/ecc/{cpp,csharp,dart,golang,java,kotlin,perl,php,python,rust,swift}/*.md` (언어당 5파일 × 11 = 55파일)
- **증거**: 이 프로젝트는 **TypeScript 단일**. 대부분 파일에 **조건부 로드용 frontmatter 없음**(곧바로 `#` 헤딩 시작).
- **불확실**: `~/.claude/CLAUDE.md`는 "`~/.claude/rules/**/*.md` 자동 로드"라 명시 → 매 세션 5438줄 전부 로드되는지, harness가 필터하는지 **읽기만으로는 미증명**. (실측하려면 별도 확인 필요)
- **질문**: 다른 프로젝트에서 cpp/rust/swift 등을 쓰시나요? 안 쓰는 언어 rules는 제거하면 컨텍스트 절감.
- **[ ] 답변 필요**:

### Q-2 [G] PreToolUse 훅 `rtk hook claude` 오버헤드
- **위치**: `settings.json.hooks.PreToolUse` — 매 Bash 호출마다 `rtk hook claude` 실행
- **증거**: `rtk` 실재함(`~/.local/bin/rtk`) — 깨진 건 아님.
- **질문**: 이 훅이 의도된 거라면 유지. 매 Bash마다 도는 게 부담되면 검토. (무엇을 하는 훅인지 사용자만 앎)
- **[ ] 답변 필요**:

### Q-3 [G] 네임스페이스 중복 에이전트/스킬
- **예**: `architect` / `ecc:architect` / `ruflo-swarm:architect`, `code-reviewer` / `ecc:code-reviewer` / `feature-dev:code-reviewer`
- **증거**: 서로 다른 플러그인이 깐 동명 항목.
- **버킷**: 의도적일 수 있어 자동 정리 금지.
- **질문**: 셋 중 실제로 쓰는 건 보통 하나일 것. 안 쓰는 플러그인 비활성으로 정리 가능.
- **[ ] 답변 필요**:

### Q-4 다수 플러그인 marketplace 활성
- **위치**: `settings.json.enabledPlugins` 28개 중 상당수 (understand-anything, watch, federation 등)
- **질문**: 실사용 플러그인만 남기면 스킬 목록·로드 시간·컨텍스트 절감. 어떤 걸 쓰시나요?
- **[ ] 답변 필요**:

---

## 6. ✅ 건강한 항목 (변경 불필요)

- **프로젝트 `gons-dashboard/CLAUDE.md`** (344줄): 잘 관리됨. Gotcha 10개·환경변수표·배포 절차 모두 살아있는 자산. **유지.**
- **메모리** (`MEMORY.md` 46줄 + 48개 개별 파일): 활발히 갱신 중. 인덱스-본문 분리 규약 준수. **유지.**
- **statusLine / graphify 경로**: 재검증 결과 둘 다 실재(§1 참조). **유지.**
- **연결된 MCP** (PlayMCP/Slack/Gmail/Calendar/Drive/Zapier/playwright/chrome-devtools): 전부 ✔ Connected. **유지.**
- **settings.local.json 권한**: 광범위하나 read-heavy + 본인 환경 맞춤. **유지.**

---

## 7. 권장 처리 순서 (승인 시)

1. **stale 갱신** (무위험): S-1, S-2 (모델/thinking 안내)
2. **Ruflo 정리** (최대 효과): R-2, R-3 — 단 `~/.claude-flow` 내용 먼저 확인
3. **충돌 단일화**: C-1(프로세스 강도), C-2(attribution)
4. **질문 응답 후 결정**: R-4, Q-1~Q-4 (플러그인/rules 슬림화)

(※ 최초 §1의 D-1/D-2는 `ls` 버그로 인한 거짓 양성으로 철회됨 — 처리 대상 아님.)

---

## 8. 사용자에게 필요한 결정 (요약)

- **R-4 / Q-4**: ruflo 5개 + 기타 플러그인 — 실사용하는 것만 남길까요?
- **Q-1**: ECC 언어별 rules(cpp~swift) — 안 쓰는 언어 제거할까요?
- **Q-2**: `rtk hook claude` PreToolUse 훅 — 의도된 것인가요?
- **C-1**: 프로세스 강도 단일 규칙 — Simplicity 기본 + 조건부 중량 프로세스로 통일할까요?
