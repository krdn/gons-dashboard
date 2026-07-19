# Claude Code 작업 결과물 → 메모 저장 (agent memo ingest) 설계

- 날짜: 2026-07-19
- 상태: 설계 확정 (사용자 승인: A안 + 바로 저장 모델) + Codex 1차 리뷰
  CHANGES_REQUIRED 6건 반영
- 관련: `docs/superpowers/specs/2026-07-13-memo-dynamic-categories` (카테고리 FK),
  `2026-07-12-memo-action-extraction` (액션 추출), CLAUDE.md "MCP 도구 호출 정책"

## 1. 목표

Claude Code 작업 과정에서 나온 산출물 중 **후속 작업이 필요하거나 재사용 가치가
있는 것**을 Gons Dashboard 메모로 저장한다. 두 경로를 지원한다:

1. **수동**: 작업자가 세션에서 요청 ("메모에 저장해줘", `/gon:memo-save`).
2. **자동**: 세션의 LLM이 저장 가치를 판단해 자동 저장 + 사용자 보고.

핵심 통찰: 이 기능은 새 도메인이 아니라 **기존 메모 도메인의 세 번째 입력
소스**다. 저장 이후의 LLM 분류·액션 추출·주간 다이제스트 파이프라인은 기존
것을 그대로 재사용한다.

## 2. 범위 (Phase 1)

| # | 항목 | 내용 |
|---|------|------|
| 1 | DB | `memos_source_check`에 `'agent'` 추가 |
| 2 | API | `POST /api/agent/memo-ingest` — Bearer 인증 ingest 엔드포인트 |
| 3 | UI | `MemoCard`에 agent 출처 뱃지 |
| 4 | 스킬 | `~/.claude/skills/gon:memo-save` — 수동 트리거 + 자동 판단 지침 |

### 비범위 (Phase 2 후보 — 실사용 관찰 후)

- MCP 서버화 (`packages/mcp-memo`) — 타 클라이언트(claude.ai 등) 지원 필요 시.
- Stop hook 완전 자동화 — transcript 스캔. 비용·노이즈 실측 후 (자동 저장의
  "보장" 수단 — Phase 1의 자동 경로는 best-effort, §4.5).
- 제안 인박스 (승인 후 저장) — 자동 저장 노이즈가 실측될 때.
- ingest body의 project/session 메타 필드, 멱등 dedup 키 (재시도 안전화).
- ingest 전용 토큰 분리 — `MCP_DASHBOARD_TOKEN` 결합 위험(§3)이 실측될 때.

## 3. 아키텍처

```
Claude Code 세션
  │  수동: 사용자 요청 / 자동: 스킬의 판단 기준 충족
  ▼
gon:memo-save 스킬 (본문 정리 + curl)
  │  POST https://gons.krdn.kr/api/agent/memo-ingest
  │  Authorization: Bearer <MCP_DASHBOARD_TOKEN>
  ▼
route handler: verifyBearer → Zod 검증 → ADMIN_EMAILS[0] → userId
  │  createMemo({ source: 'agent', ... })
  │  after(): classifyAndPersistMemoCategory + extractAndPersistMemoActions
  │           (createMemoAction과 동일 — best-effort, cron sweep 회수)
  ▼
/memos 목록·위젯에 표시 (agent 뱃지)
```

인증은 기존 `MCP_DASHBOARD_TOKEN`을 재사용한다 — "내 로컬 도구 → 내 대시보드"
동일 신뢰 경계이므로 토큰을 늘리지 않는다 (회전 관리 부담 최소화).
사용자 매핑은 mediator (`/api/mcp/credentials/google`)와 동일하게
`ADMIN_EMAILS[0]` → `users` 조회 (v1 단일 사용자).

**토큰 재사용의 결합 위험 (명시 수용)**: 이 토큰은 Google credential mediator
(`/api/mcp/credentials/google`)도 열어준다 — `ingest.env`가 유출되면 메모
쓰기뿐 아니라 **Gmail/Calendar access token 발급까지 노출**된다. 완화:
(a) `ingest.env`는 mode 600 + 로컬 데스크톱 한정, (b) 유출 의심 시 즉시 회전 —
`MCP_DASHBOARD_TOKEN`은 운영 `.env` + `~/.claude.json`의 MCP 등록 env +
`ingest.env` **3곳 동시 교체** (RUNBOOK 시크릿 회전 절차에 추가).
전용 토큰 분리는 결합 위험이 실측될 때의 Phase 2 후보 (env 추가는 운영
compose environment 누락 함정을 동반하므로 v1에서는 늘리지 않는다).

## 4. 상세 설계

### 4.1 DB 마이그레이션

```sql
ALTER TABLE memos DROP CONSTRAINT memos_source_check;
ALTER TABLE memos ADD CONSTRAINT memos_source_check
  CHECK (source IN ('voice', 'text', 'agent'));
```

- drizzle 스키마 (`shared/lib/db/schema/memo.ts`)의 CHECK도 동일하게 갱신,
  `pnpm db:generate`로 다음 순번 마이그레이션 생성.
- **운영 적용**: psql `BEGIN/COMMIT` 수동 선적용 (drizzle tracking 미인식 —
  CLAUDE.md Quick Start).
- **배포 순서는 필수**: `운영 DDL → 이미지 배포 → 스킬 배치`. 새 CHECK + 구
  앱은 호환이지만, **구 CHECK + 새 API는 첫 agent insert가 CHECK 위반으로
  실패**한다 — DDL이 반드시 먼저다.
- **fixture drift 가드**: `'voice'`/`'text'` CHECK를 참조하는 테스트 fixture
  전수 grep (DB CHECK fixture drift 전례). `source` 분기 지점 전수 grep —
  확인된 3곳은 모두 voice/그외 2-way ternary라 agent가 "텍스트"로 오표시된다.
  §4.4에서 3-way로 전환한다:
  - `entities/memo/ui/MemoCard.tsx` (표시 뱃지 ternary + voice 하이라이트)
  - `widgets/memo/ui/RecentMemos.tsx:25` (🎙/✍ 아이콘 ternary)
  - `widgets/memo-insights/lib/aggregate.ts` (else-분기가 agent를 textCount에 합산)

### 4.2 타입

`entities/memo/model/types.ts`:

```ts
export type MemoSource = "voice" | "text" | "agent";
```

`createMemoAction`의 입력 타입은 `MemoSource` 대신 **`Exclude<MemoSource,
"agent">`로 좁힌다** — 이 액션의 런타임 검증(`voice`/`text`만 허용)과 타입을
일치시켜, UI 폼 경로로 agent 소스가 흘러드는 것을 컴파일 타임에 차단한다.

### 4.3 API — `POST /api/agent/memo-ingest`

`app/api/agent/memo-ingest/route.ts` (신규):

- **인증**: `verifyBearer(req, env.MCP_DASHBOARD_TOKEN)` 실패 → 401
  (timing-safe, `Cache-Control: no-store` — mediator 라우트와 동일 정책).
- **body (Zod, trim-후-검증)**:
  ```ts
  {
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(20_000),
  }
  ```
  - **trim 후 길이 검증** — `createMemoAction`이 저장 전 trim하는 것과 동일
    규칙. 공백-only body는 400. 저장값도 trim된 값이다.
  - `content` 길이 상한은 `createMemoAction`의 `MAX_MEMO_LEN`(20,000) 미러 —
    상수를 공유 위치로 옮기지 않고 값만 미러 (surgical change).
  - **malformed JSON**(`req.json()` throw)도 catch해 400으로 응답.
  - `rawContent` = `cleanedContent` = `content` (text 소스와 동일 규칙 —
    agent 본문은 이미 정리본).
  - `title` 미지정 시 `deriveTitle(content)` (기존 함수 재사용).
- **user 매핑**: `ADMIN_EMAILS[0]` → `users` 조회. 미설정 → 500, 사용자 행
  미존재 → 404 (mediator와 동일 응답 정책).
- **저장**: `createMemo({ userId, source: "agent", title, rawContent, cleanedContent })`.
  예외는 try/catch로 잡아 **명시적 500 JSON 응답**으로 변환 (스택은 서버 로그).
- **후처리**: `after(() => Promise.allSettled([classify, extractActions]))` +
  `revalidatePath("/memos")` — `createMemoAction`의 성공 분기와 동일.
- **응답 계약**: 200 `{ id }` / 400 (malformed JSON·Zod 실패) / 401 / 404
  (admin 사용자 행 없음) / 500 (ADMIN_EMAILS 미설정·DB 실패).
- **rate limiting 없음 (명시 결정)**: 단일 사용자 + Bearer 필수 + 개인 인프라.
  논리적 상한은 스킬의 세션당 자동 저장 상한이 담당.

### 4.4 UI — source 3-way 전환

기존 2-way ternary(voice/그외)를 그대로 두고 뱃지만 추가하면 agent 메모에
"✍ 텍스트"와 "에이전트"가 동시 표시된다 — **ternary 자체를 3-way로 교체**한다:

1. `MemoCard.tsx`: `{isVoice ? "🎙 음성" : "✍ 텍스트"}` → source별
   `🎙 음성 / ✍ 텍스트 / 🤖 에이전트` 3-way. voice 하이라이트 분기
   (`=== "voice"`)는 agent에 영향 없음 — 그대로 둔다.
2. `RecentMemos.tsx:25`: 아이콘 ternary를 동일하게 3-way (`🤖`).
3. `memo-insights/lib/aggregate.ts`: else-분기가 agent를 `textCount`에
   합산하는 것을 수정 — `agentCount` 필드를 `CategoryDistribution`에 추가하고
   소스 분포 UI에 항목을 추가한다 (agent를 text로 오집계하지 않는 것이 목적).

기존 스타일 토큰 재사용, 신규 컴포넌트 없음. 목록 필터 추가는 하지 않는다
(카테고리 필터가 이미 있음).

### 4.5 Claude Code 스킬 — `gon:memo-save`

위치: `~/.claude/skills/gon:memo-save/SKILL.md` (레포 밖 — 스킬 카탈로그
snapshot이 자동 수집). 설계 요지:

- **트리거는 frontmatter `description`이 담당** — SKILL 본문은 스킬이 선택된
  뒤에야 읽히므로, 본문 지침만으로는 자동 실행이 일어나지 않는다.
  description에 두 트리거를 모두 명시한다: (1) 수동 — `/gon:memo-save`,
  "메모에 저장해줘", "대시보드 메모로"; (2) 자동 — "작업을 마무리·정리하는
  시점에 후속 작업이나 재사용 가치가 있는 산출물이 남았다고 판단되면 호출".
- **자동 저장은 best-effort** — Stop hook 없이 모델의 트리거 판단에 의존하므로
  누락될 수 있음을 명시한다 (보장 자동화는 Phase 2의 Stop hook 실험).
- **자동 판단 기준** (호출 시 평가):
  - 저장: (a) 이번 세션에서 도출됐으나 지금 실행하지 않는 후속 작업,
    (b) 재사용 가치가 있는 아이디어·패턴·결정, (c) 사용자 명시 요청.
  - 제외: 이미 GitHub Issue·TODOS.md·메모리에 기록된 것, 일회성 디버깅 노트,
    **시크릿·자격증명이 포함된 내용 (절대 금지)**.
- **상한 계수 방식**: 자동 경로는 "작업 마무리 시 1회 호출해 후보를 모아
  **최대 2건 배치 저장**" — 호출 단위 상한이라 반복 호출로도 세지 않는다.
  초과 후보는 저장 대신 사용자에게 제안. 이 상한은 **UX 노이즈 상한이지 보안
  통제가 아니다** — API 자체는 Bearer만 있으면 무제한 호출 가능 (§4.3의
  rate limiting 생략 결정과 함께 읽을 것).
- **보고 의무**: 자동 저장 시 무엇을 왜 저장했는지 세션에서 즉시 보고.
- **본문 형식**: 제목 + 정리된 본문 + 말미에 출처 한 줄
  (`— 출처: <프로젝트명> Claude Code 세션, YYYY-MM-DD`). 메타는 본문에 포함 —
  스키마 확장 없음.
- **전송 (shell 보간 금지)**: 본문을 shell 문자열에 직접 삽입하지 않는다 —
  Write 툴로 JSON 파일을 만들거나 `jq -n --arg`로 직렬화한 뒤
  `curl -sS --fail-with-body --max-time 15 --data @<file>`로 전송. 성공 판정은
  HTTP 200 + 응답 body의 `{ id }` 존재 확인까지.
- **접속 정보**: `~/.config/gons-dashboard/ingest.env` (mode 600,
  `MEMO_INGEST_URL` + `MEMO_INGEST_TOKEN`)에서 source. 스킬 문서에는 변수명만 —
  시크릿 평문 금지.
- **실패 처리 (자동 재시도 없음)**: POST는 비멱등 — 저장 후 응답만 유실된
  경우 재시도가 중복 메모를 만든다. 실패 시 재시도하지 않고 **본문 전문을
  세션에 출력해 유실을 방지**하고 사용자에게 보고, 재시도는 사용자 지시로만.
  멱등 키는 Phase 2 후보.

## 5. 에러 처리 요약

| 지점 | 정책 |
|------|------|
| Bearer 불일치/누락 | 401, no-store |
| malformed JSON / body 검증 실패 (공백-only 포함) | 400 |
| admin 사용자 행 없음 | 404 |
| ADMIN_EMAILS 미설정 / createMemo 예외 | 500 (try/catch로 명시 변환) |
| 스킬 측 전송 실패 | **자동 재시도 없음** — 본문 전문을 세션에 출력 + 사용자 보고 (비멱등 중복 방지) |
| 분류·액션 추출 실패 | best-effort (allSettled) — 기존 cron sweep이 회수 |

## 6. 테스트 계획

1. **route 통합 테스트** (`tests/` 기존 패턴): 401(토큰 없음/불일치),
   400(빈 content·공백-only·20k 초과·malformed JSON), 404(admin 사용자 행
   없음), 500(DB 실패 — createMemo mock reject), 200(+DB row `source='agent'`,
   title 파생·trim 저장값, 후처리 `after` 예약 확인).
2. **UI 3-way**: MemoCard agent 뱃지 렌더 + voice/text 회귀,
   RecentMemos 아이콘 3-way, aggregate `agentCount` 분리 집계
   (agent가 textCount에 합산되지 않음).
3. **fixture 전수 grep**: source CHECK 관련 fixture drift 확인.
4. **스킬 수용 테스트** (수동 체크리스트): JSON 특수문자(따옴표·개행) 본문
   왕복, 토큰 누락 시 명확한 실패 보고, 전송 실패 시 본문 세션 출력,
   자동 경로 1회 호출 최대 2건 상한.
5. **수동 스모크**: dev 서버 대상 curl → /memos에서 뱃지·자동 분류 확인.

## 7. 배포 체크리스트

순서 필수 — `DDL → 이미지 → 스킬` (구 CHECK + 새 API 조합 방지, §4.1):

1. 운영 DDL psql 선적용 (BEGIN/COMMIT).
2. PR → CI → 이미지 배포 (기존 4단계 검증 패턴).
3. 신규 env 없음 (`MCP_DASHBOARD_TOKEN` 재사용). 스킬 쪽
   `~/.config/gons-dashboard/ingest.env` 생성 (mode 600).
4. 스킬 파일 배치 후 실 세션에서 수동/자동 경로 각 1회 검증.
5. RUNBOOK 시크릿 회전 절차에 `MCP_DASHBOARD_TOKEN` 3곳 동시 교체 항목 추가
   (§3 결합 위험).
