# autopilot 모니터링 위젯 설계

**작성일**: 2026-06-03
**상태**: 설계 승인 — 구현 계획 대기
**관련 메모리**: autopilot-status-pr126, autopilot-workflow-no-filesystem, autopilot-deploy-orchestrator-placement

## 배경

gons-autopilot(주간 자율 업그레이드 시스템)은 PR #126/#128로 코드 구현 + 운영 prebaseline까지 끝났으나 `mode=shadow` + `AUTOPILOT_DEPLOY=off` 기본값이라 아직 한 번도 사이클을 돌지 않았다. 대시보드에서 **사이클 이력**과 **다음 후보(backlog)**를 볼 위젯이 필요하다.

### 핵심 제약 (조사 완료)

- **이력 0건**: autopilot이 아직 실행 안 됨 → empty state가 앞으로 수 주간 기본 상태.
- **데이터 소스 부재**: `autopilot-log.json`/`backlog.json` 미저장, DB 테이블 없음, `autopilot-notify` 라우트는 web-push만 하고 저장 안 함.
- **Workflow FS 제약** (메모리 autopilot-workflow-no-filesystem): `scripts/autopilot/cycle.workflow.js`는 Workflow 도구라 파일시스템·DB 접근 불가. 결과를 **반환만** 한다. 영속화는 *호출자*(주간 `/schedule` 에이전트)가 해야 한다.
- **writer ≠ reader**: 사이클을 돌리는 건 주간 원격 에이전트(또는 cron), 읽는 건 대시보드 RSC. 스토어는 **양쪽 모두 닿아야** 한다 — app 컨테이너 FS의 JSON 파일은 원격 에이전트가 못 닿아 탈락.

### 데이터의 세 갈래

| 갈래 | 출처 | 영속화 |
|------|------|--------|
| 상태/준비도 (mode, deploy on/off, 다음 사이클) | env / 최신 DB row | 불필요 (항상 파생) |
| 사이클 이력/결과 (선정·PR·머지) | DB | 필요 |
| 다음 후보(backlog) · 토론(debate) | Workflow 반환값에만 존재 | **필요** (호출자가 저장) |

## 결정 사항 (브레인스토밍)

1. **1차 목적**: 상태 + 이력 블렌드 — 지금은 상태가 주력, 이력은 쌓이는 대로.
2. **데이터 소스**: **DB 테이블** (`autopilot_cycles`). 14개 위젯 전부의 패턴(RSC→entity server fn→Drizzle)과 일치, writer/reader 양쪽 모두 Postgres 도달.
3. **write 경로**: **저장 전용 cron API 라우트** (`POST /api/cron/autopilot-cycle`, Bearer 인증). autopilot-notify와 동일 패턴. 원격 에이전트도 HTTPS로 동일 호출 → LAN 도달 문제 없음.
4. **상태 범위**: 자동 파생 가능한 것만 (mode, deploy, 마지막 실행, 다음 사이클). 운영 준비도 체크리스트(docker socket 권한 등)는 v1 범위 밖.
5. **배치**: 좌측 메인 컬럼, StockAnalysis 아래 (넓은 이력 + 후보 리스트).

## 아키텍처

### FSD 레이어 배치

```
entities/autopilot-cycle/          # 새 엔티티 (server/client barrel 분리 — Gotcha #1)
├── model/types.ts                 # AutopilotCycle, BacklogCandidate, DebateEntry, DebateLog
├── model/schema.ts                # autopilotCycles 테이블 (Drizzle) + Zod 입력 스키마
├── api/getCycles.ts               # server: 최근 N건 이력 조회 (createdAt desc)
├── api/getLatestBacklog.ts        # server: 최신 사이클의 backlogTop3
├── api/recordCycle.ts             # server: upsert (cron 라우트가 호출)
├── server.ts                      # import "server-only" + server fn export
└── client.ts                      # 순수 표현 컴포넌트·타입 re-export

widgets/autopilot/                 # 새 위젯
├── ui/AutopilotCard.tsx           # RSC — 데이터 조합 + 상태/이력/후보 배치
├── ui/AutopilotStatus.tsx         # client — mode/deploy 배지, 다음 사이클 D-day
├── ui/CycleHistoryList.tsx        # client — 이력 row 리스트 + empty state
├── ui/NextCandidates.tsx          # client — backlog TOP3 + empty state
├── ui/AutopilotSkeleton.tsx
└── index.ts

app/api/cron/autopilot-cycle/route.ts   # POST 저장 전용 (Bearer 인증)
```

### 데이터 흐름

```
[쓰기 — 범위 밖, Task 12]
주간 /schedule 에이전트 → cycle.workflow.js 실행 → 반환값(logEntry+debate)
  → POST /api/cron/autopilot-cycle (Bearer) → recordCycle() → autopilot_cycles upsert

[읽기 — 본 작업]
DashboardPage(RSC) → AutopilotCard(RSC)
  → getCycles() / getLatestBacklog() [Drizzle]        ← 이력·후보
  → env(AUTOPILOT_MODE, AUTOPILOT_DEPLOY) + 최신 row.id ← 상태/준비도
```

### entity를 따로 두는 이유

ServerOverview는 `host-catalog` feature를 쓰지만 autopilot 데이터는 순수 read/write라 feature 로직이 없다. entity의 server/client barrel 분리(Gotcha #1)로 cron 라우트(server tree)와 위젯 client 컴포넌트(client tree)가 깔끔히 갈린다.

## 데이터 모델 — `autopilot_cycles`

조회·정렬에 쓰는 필드만 컬럼으로 꺼내고, 풍부한 구조는 JSONB에 둔다.

```typescript
// entities/autopilot-cycle/model/schema.ts
export const autopilotCycles = pgTable("autopilot_cycles", {
  // id = "autopilot-2026-W24" (isoWeek). upsert 멱등 키.
  id: text("id").primaryKey(),
  date: timestamp("date", { withTimezone: true }).notNull(),  // 사이클 실행 시각
  mode: text("mode").notNull(),               // "shadow" | "autonomous"
  candidateCount: integer("candidate_count").notNull(),

  // 선정 결과 (없으면 null — reason으로 사유 표시)
  selectedTitle: text("selected_title"),
  selectedScore: real("selected_score"),
  selectedChangeType: text("selected_change_type"),  // deps|security|refactor|feature|ui|perf
  selectedOwner: text("selected_owner"),             // 전문가 이름

  // PR 결과
  prUrl: text("pr_url"),
  merged: boolean("merged").notNull().default(false),
  needsHuman: boolean("needs_human").notNull().default(false),
  reason: text("reason"),   // "no-candidate-selected" | "implementation-gate-failed" | null

  // 풍부한 구조는 JSONB — 조회 정렬에 안 쓰임
  backlogTop3: jsonb("backlog_top3").$type<BacklogCandidate[]>().notNull().default([]),
  debate: jsonb("debate").$type<DebateLog>(),   // 사람 검수용 토론 전문

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 위젯이 소비하는 타입 (cycle.workflow.js의 debate()/backlogTop3와 1:1)

```typescript
type BacklogCandidate = { title: string; score: number; dedupKey: string };
type DebateEntry = {
  title: string; owner: string; score: number; changeType: string; dedupKey: string;
  crossReview: { challenge: string; severity: "low"|"medium"|"high"; wouldBlock: boolean }[];
  verdicts: { valueScore: number; safetyScore: number; feasibilityScore: number }[];
};
type DebateLog = { selected: DebateEntry | null; backlogTop3: DebateEntry[] };
```

### Zod 입력 스키마

cron 라우트가 POST 본문 검증에 사용. cycle.workflow.js 반환 형태를 그대로 받아 컬럼/JSONB로 매핑. `selected` null / `reason` 있는 케이스를 모두 허용.

### 주의 (메모리 Gotcha 반영)

- **Gotcha #9** (timestamptz `::date` 비-IMMUTABLE): v1은 `id`(=isoWeek)가 PK라 주차별 expression index 불필요. `createdAt desc` 정렬만 쓰므로 회피.
- **마이그레이션**: `pnpm db:generate` → drizzle-kit. 메모리 drizzle-kit-migrate-prod-broken 때문에 운영 적용은 psql 직접 BEGIN/COMMIT 권장 (구현 계획에서 다룸).

## cron 저장 라우트 + write 경로

```typescript
// app/api/cron/autopilot-cycle/route.ts  (autopilot-notify와 동일 패턴)
export async function POST(request: Request) {
  if (!verifyCronBearer(request)) return 401;           // Bearer 인증
  const body = await request.json().catch(() => null);
  const parsed = AutopilotCycleInput.safeParse(body);   // Zod 검증
  if (!parsed.success) return 400;
  await recordCycle(parsed.data);                       // entity server fn → upsert
  return NextResponse.json({ status: "ok", id: parsed.data.id });
}
```

```typescript
// entities/autopilot-cycle/api/recordCycle.ts
export async function recordCycle(input: AutopilotCycleInput) {
  await db.insert(autopilotCycles)
    .values(mapToRow(input))
    .onConflictDoUpdate({ target: autopilotCycles.id, set: mapToRow(input) });
  // id = "autopilot-<isoWeek>" 멱등 — 같은 주 재실행/재시도해도 1 row
}
```

이로써 메모리 autopilot-workflow-no-filesystem의 "호출자가 영속화"가 **DB 경로로 구체화**된다. Workflow는 FS·DB 못 닿지만, 호출자(에이전트)가 HTTPS API 한 번 더 치는 것으로 루프가 닫힌다.

## UI 구성

`AutopilotCard`(RSC)가 데이터를 모아 3개 client 컴포넌트에 넘긴다. **locale-free 포맷**(Gotcha #3) 준수 — 클라이언트 시각 표시는 `HH:MM:SS` / `YYYY-MM-DD`.

### ① AutopilotStatus — 항상 표시 (이력 0건이어도 유용)

```
🤖 Autopilot — 주간 자율 업그레이드          [shadow · 배포 OFF]
다음 사이클 · 6/9 (월)      마지막 실행 · 없음 / 2026-W23
```

- `mode`, `AUTOPILOT_DEPLOY` → env에서 파생 (DB 불필요, 항상 정확)
- 다음 사이클 D-day → "주 1회 월요일" 가정에서 계산 (서버 RSC, KST)
- 마지막 실행 → 최신 row의 `id`(isoWeek) 또는 "없음"

### ② CycleHistoryList — 최근 N건 (기본 8건)

```
2026-W23  Next.js 16.3 업그레이드     score 4.2  [deps]  PR #131 ✓머지
2026-W22  (후보 선정 안 됨)            —          no-candidate-selected
2026-W21  Zod v4 마이그레이션          score 3.9  [deps]  PR #128 ⚠needs-human
```

- empty state: `첫 사이클이 아직 실행되지 않았습니다 · shadow 모드로 대기 중` (점선 박스)
- PR 링크는 `prUrl` 있을 때만 `<a target="_blank" rel="noopener noreferrer">`. merged/needsHuman/reason으로 상태 배지.

### ③ NextCandidates — 최신 사이클의 `backlogTop3`

```
다음 후보 (backlog)
· 의존성 보안 패치               score 3.8
· i18n 메시지 추출 리팩터        score 3.5
· 대시보드 로딩 성능 개선         score 3.1
```

- empty state: `사이클이 토론을 거쳐 후보를 선정하면 여기에 TOP 3가 표시됩니다`
- **교차주 누적 backlog가 아니라 단일 사이클 스냅샷** — 메모리상 교차주 dedup이 미구현이라 최신 사이클의 backlogTop3만 보여주는 게 정확하다.

### page.tsx 배치 (좌측 메인, StockAnalysis 아래)

```tsx
<Suspense fallback={<AutopilotSkeleton />}>
  <AutopilotCard />
</Suspense>
```

## 에러 처리 · 인증/인가

### 에러 처리

- **DB 조회 실패** (`getCycles`/`getLatestBacklog`): 메모리 react-error-boundaries-lint-rule 패턴 준수 (server async에서 try/catch 안 JSX 금지). 빈 배열/null로 폴백 → 위젯이 empty state로 graceful degrade. autopilot은 보조 위젯이라 조회 실패가 페이지·타 위젯에 영향 없음.
- **POST 라우트**: 401(인증 실패) / 400(Zod 검증 실패) / 200(저장). autopilot-notify와 동일하게 명시 status.
- **env 미설정**: `AUTOPILOT_MODE`/`AUTOPILOT_DEPLOY` 없으면 기본값(`shadow`/`off`)으로 파생 — 부팅 throw 안 함. 보조 기능이라 `env.ts` 필수 항목으로 올리지 않는다.

### 인증/인가

- 저장 라우트: `verifyCronBearer` (Bearer 토큰) — autopilot-notify와 동일.
- 위젯 표시: `app/page.tsx`가 이미 `auth()` 로그인 가드. 개인 대시보드라 로그인 사용자=본인 → 추가 가드 없이 노출. (notify의 `ADMIN_EMAILS`는 *발송 대상* 필터이지 대시보드 표시 가드가 아니다.)

## 테스트

메모리 Gotcha #2 — 통합 테스트는 `TEST_DATABASE_URL` 필수.

- `recordCycle` upsert 멱등성 (같은 id 2회 → 1 row, 값 갱신) — DB 통합 테스트
- Zod 스키마: cycle.workflow.js 반환 형태 fixture로 검증 (selected null / reason 있는 케이스 포함)
- 라우트: Bearer 없음→401, 잘못된 body→400, 정상→200
- UI: empty state 렌더, PR 링크 조건부 렌더 (순수 함수 단위)

### 검증 게이트 (메모리 features-barrel-server-client-seam — Gotcha #7)

`pnpm typecheck && pnpm lint` + **`cd apps/dashboard && pnpm build`** 필수. client가 entity barrel을 import할 때 server-only 누수(`tls`/`net`/`perf_hooks` module-not-found)를 build에서만 잡을 수 있다.

## 범위 경계

### 본 작업 (위젯)

- ✅ `autopilot_cycles` 테이블 + 마이그레이션
- ✅ `entities/autopilot-cycle` (server/client barrel)
- ✅ `POST /api/cron/autopilot-cycle` 저장 라우트 + `recordCycle()` (curl 수동 POST로 검증 가능)
- ✅ `widgets/autopilot` + page.tsx 배치
- ✅ 테스트

### 범위 밖 (별도 작업 — 운영 접근 필요)

- ⏳ 주간 `/schedule` 에이전트가 이 라우트를 실제 호출하도록 배선 → 메모리 Task 12·13. 이 라우트의 URL·스키마를 그쪽이 사용.
- ⏳ debate 전문(crossReview/verdicts) 렌더링 상세 UI → JSONB에 저장만 하고 v1 위젯은 backlog 제목+score만 표시. 데이터가 실제로 쌓인 뒤 별도.
- ⏳ 운영 준비도 체크리스트(docker socket 권한, app digest 최신 여부 등) 표시 → 자동 파생 불가, 별도 점검 필요.

## YAGNI 노트

- debate JSONB는 저장하되 v1 UI는 안 그림 (미래 여지만 남김).
- 교차주 누적 backlog 미구현 → 단일 사이클 스냅샷으로 충분.
- `autopilot_cycles`에 주차별 index 불필요 (PK가 isoWeek).
