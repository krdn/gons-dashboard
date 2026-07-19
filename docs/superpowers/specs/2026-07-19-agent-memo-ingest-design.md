# Claude Code 작업 결과물 → 메모 저장 (agent memo ingest) 설계

- 날짜: 2026-07-19
- 상태: 설계 확정 (사용자 승인: A안 + 바로 저장 모델)
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
- Stop hook 완전 자동화 — transcript 스캔. 비용·노이즈 실측 후.
- 제안 인박스 (승인 후 저장) — 자동 저장 노이즈가 실측될 때.
- ingest body의 project/session 메타 필드, 멱등 dedup 키.

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
  CLAUDE.md Quick Start). additive 변경이라 기존 행 영향 없음 — DDL 선적용과
  이미지 배포 순서는 자유.
- **fixture drift 가드**: `'voice'`/`'text'` CHECK를 참조하는 테스트 fixture
  전수 grep (DB CHECK fixture drift 전례). `source` 분기 지점도 전수 grep —
  현재 확인된 곳: `MemoCard.tsx` 2곳 (`isVoice` 하이라이트·표시 분기),
  분기들은 `=== "voice"` 형태라 `'agent'` 추가로 오동작하지 않음을 확인한다.

### 4.2 타입

`entities/memo/model/types.ts`:

```ts
export type MemoSource = "voice" | "text" | "agent";
```

### 4.3 API — `POST /api/agent/memo-ingest`

`app/api/agent/memo-ingest/route.ts` (신규):

- **인증**: `verifyBearer(req, env.MCP_DASHBOARD_TOKEN)` 실패 → 401
  (timing-safe, `Cache-Control: no-store` — mediator 라우트와 동일 정책).
- **body (Zod)**:
  ```ts
  { title?: string(1..200), content: string(1..20000) }
  ```
  - `content` 길이 상한은 `createMemoAction`의 `MAX_MEMO_LEN`(20,000) 미러 —
    상수를 공유 위치로 옮기지 않고 값만 미러 (surgical change).
  - `rawContent` = `cleanedContent` = `content` (text 소스와 동일 규칙 —
    agent 본문은 이미 정리본).
  - `title` 미지정 시 `deriveTitle(content)` (기존 함수 재사용).
- **user 매핑**: `ADMIN_EMAILS[0]` → `users` 조회. 미설정/미존재 → 500/404
  (mediator와 동일 응답 정책).
- **저장**: `createMemo({ userId, source: "agent", title, rawContent, cleanedContent })`.
- **후처리**: `after(() => Promise.allSettled([classify, extractActions]))` +
  `revalidatePath("/memos")` — `createMemoAction`의 성공 분기와 동일.
- **응답**: 200 `{ id }` / 400 (Zod 실패) / 401 / 500.
- **rate limiting 없음 (명시 결정)**: 단일 사용자 + Bearer 필수 + 개인 인프라.
  논리적 상한은 스킬의 세션당 자동 저장 상한이 담당.

### 4.4 UI — agent 뱃지

`entities/memo/ui/MemoCard.tsx`: 기존 `isVoice` 표시 분기 옆에 `source ===
"agent"`일 때 소형 뱃지 (라벨 "에이전트"). 기존 스타일 토큰 재사용, 신규
컴포넌트 없음. 목록 필터 추가는 하지 않는다 (카테고리 필터가 이미 있음).

### 4.5 Claude Code 스킬 — `gon:memo-save`

위치: `~/.claude/skills/gon:memo-save/SKILL.md` (레포 밖 — 스킬 카탈로그
snapshot이 자동 수집). 설계 요지:

- **수동 트리거**: `/gon:memo-save [내용]`, "메모에 저장해줘", "대시보드 메모로".
- **자동 판단 기준** (작업 마무리 시점에 평가):
  - 저장: (a) 이번 세션에서 도출됐으나 지금 실행하지 않는 후속 작업,
    (b) 재사용 가치가 있는 아이디어·패턴·결정, (c) 사용자 명시 요청.
  - 제외: 이미 GitHub Issue·TODOS.md·메모리에 기록된 것, 일회성 디버깅 노트,
    **시크릿·자격증명이 포함된 내용 (절대 금지)**.
- **상한**: 자동 저장은 세션당 최대 2건. 초과분은 저장 대신 사용자에게 제안.
- **보고 의무**: 자동 저장 시 무엇을 왜 저장했는지 세션에서 즉시 보고.
- **본문 형식**: 제목 + 정리된 본문 + 말미에 출처 한 줄
  (`— 출처: <프로젝트명> Claude Code 세션, YYYY-MM-DD`). 메타는 본문에 포함 —
  스키마 확장 없음.
- **전송**: `curl -sf -X POST` + Bearer. 접속 정보는
  `~/.config/gons-dashboard/ingest.env` (mode 600, `MEMO_INGEST_URL` +
  `MEMO_INGEST_TOKEN`=MCP_DASHBOARD_TOKEN 값)에서 source. 스킬 문서에는
  변수명만 — 시크릿 평문 금지.
- **실패 처리**: 1회 재시도 후 실패 시 본문을 세션에 출력해 유실 방지.

## 5. 에러 처리 요약

| 지점 | 정책 |
|------|------|
| Bearer 불일치/누락 | 401, no-store |
| body 검증 실패 | 400 |
| createMemo 실패 | 500 — 스킬이 1회 재시도 후 사용자 보고 |
| 분류·액션 추출 실패 | best-effort (allSettled) — 기존 cron sweep이 회수 |

## 6. 테스트 계획

1. **route 통합 테스트** (`tests/` 기존 패턴): 401(토큰 없음/불일치),
   400(빈 content, 20k 초과), 200(+DB row `source='agent'`, title 파생 확인).
2. **MemoCard**: agent 뱃지 렌더 + voice/text 비표시 회귀.
3. **fixture 전수 grep**: source CHECK 관련 fixture drift 확인.
4. **수동 스모크**: dev 서버 대상 curl → /memos에서 뱃지·자동 분류 확인.

## 7. 배포 체크리스트

1. 운영 DDL psql 선적용 (BEGIN/COMMIT) — additive라 순서 자유.
2. PR → CI → 이미지 배포 (기존 4단계 검증 패턴).
3. 신규 env 없음 (`MCP_DASHBOARD_TOKEN` 재사용). 스킬 쪽
   `~/.config/gons-dashboard/ingest.env` 생성 (mode 600).
4. 스킬 파일 배치 후 실 세션에서 수동/자동 경로 각 1회 검증.
