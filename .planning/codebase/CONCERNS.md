# Codebase Concerns

**Analysis Date:** 2026-05-11

> 이 문서는 후속 `/improve-codebase-architecture` 단계의 입력. 각 항목은 영향도(HIGH/MED/LOW),
> 관련 파일 경로, 현재 안전장치(있다면), 권장 개선 방향 순서로 작성된다.
> HIGH = 정확성/보안 리스크, MED = 유지보수 마찰, LOW = 스타일/관성.

---

## 1. Known Gotchas (CLAUDE.md 기반)

### G1. Entities/features barrel 이 server-only 모듈을 끌어옴 — **HIGH**

- **현상**: `src/entities/container/index.ts`, `src/entities/project/index.ts`, `src/features/container-list/index.ts`,
  `src/features/container-actions/index.ts` 등 barrel 은 server-only API (`listContainers`,
  `upsertProjectFromContainer`, `_runAction` 등 → `node:child_process` / `server-only`) 와
  client UI 컴포넌트를 같은 파일에서 export 한다.
- **트리거 파일**:
  - `src/entities/container/index.ts:1-10` — `listContainers`, `inspectContainer` (server) +
    `ContainerStatusBadge`, `ContainerRow` (client-safe UI) 혼재
  - `src/entities/project/index.ts:1-14` — `getProjects`, `upsertProjectFromContainer` (server) +
    `ProjectCard` 혼재
  - `src/features/container-list/index.ts` (사용처에서 deep import 가 필요) — `groupByProject` (pure) +
    `StandaloneSection`/`ProjectGroupSection` (server-only import 포함)
- **현재 안전장치**:
  - `src/widgets/host-dashboard/ui/HostDashboard.tsx:14-23` 의 길고 명시적인 주석 —
    "barrel 전체를 끌어오므로 깊은 경로 import 강제" 가이드를 남겨두고 `@/features/container-list/ui/ProjectGroupSection`
    형태로 직접 import.
  - CLAUDE.md Gotcha §1 — 같은 실수를 반복하지 않도록 명문화.
- **잔존 위험**: 가이드는 *관습* 일 뿐 lint/build-time 검증이 없다. 새 client 컴포넌트가 barrel 을
  쓰면 prod build 가 깨질 때까지 알 수 없음. (ESLint `eslint-plugin-boundaries` 는 layer 만 보고,
  같은 슬라이스 내 `index.ts` vs deep path 는 검사 X.)
- **권장**: 두 갈래 중 하나.
  1. barrel 을 server-only 와 client-safe 두 entry 로 쪼갠다 (`index.ts` + `index.client.ts`),
     또는
  2. 슬라이스 자체를 `entities/container/server` / `entities/container/ui` 로 분할하고 barrel 을
     얇게 유지한다.
  3. 최소 변경으로는 `"use client"` 파일 안에서의 `@/entities/*` 또는 `@/features/*` 루트 import 를
     금지하는 ESLint custom rule 또는 `no-restricted-imports` 패턴 추가.

### G2. 통합 테스트의 prod DB 가드 — **HIGH** (이미 사고 발생 이력)

- **파일**: `tests/setup.ts:14-35`
- **현상**: `DATABASE_URL` 이 `192.168.0.5` 또는 `gons.krdn.kr` 패턴을 매칭하면 throw.
  `TEST_DATABASE_URL` 이 명시되면 override.
- **현재 안전장치**: 두 단계 정규식 차단 (`/\b192\.168\.0\.5(?::|\/|$)/`, `/\bgons\.krdn\.kr\b/i`)
  + Vitest setup 에서 즉시 fail.
- **잔존 위험**:
  - 패턴 목록이 *허용 리스트* 아닌 *차단 리스트* — 새 prod 호스트가 추가되어도 가드가 자동 확장되지 않음
    (예: staging 도메인이 새로 생기면 사고 재발 가능).
  - guard 는 `tests/setup.ts` 만 보호. `pnpm db:seed:*` 나 `pnpm db:cleanup-projects` 같은 script
    경로는 동일 가드가 없음 (`src/scripts/seed-hosts.ts`, `src/scripts/cleanup-projects.ts`).
- **권장**: 차단 리스트를 allow-list (`TEST_DATABASE_URL` 또는 `localhost` / `127.0.0.1` /
  `:5999` 만 허용) 로 뒤집고, `src/scripts/` 진입점에서도 동일 헬퍼 재사용.

### G3. Locale 의존 포맷팅으로 인한 hydration mismatch — **MED**

- **문서 위치**: CLAUDE.md Gotcha §3
- **현재 안전장치**: 클라이언트에서는 locale-free `HH:MM:SS` 사용 권고. 서버 RSC 안에서만
  `toLocaleString("ko-KR")` 사용.
- **현재 사용처 (서버 OK)**: `src/features/gmail-sync/lib/classifyThreadsLoop.ts:140-151` —
  `formatKst` 가 `Intl.DateTimeFormat("ko-KR")` 호출. 이 함수는 LLM input string 생성용이므로
  hydration 에는 영향 없음. 위험은 미래에 같은 패턴이 `"use client"` 트리에 복붙되는 경우.
- **권장**: `shared/lib/format/` 에 단일 helper (`formatTimeLocaleFree(date): string`) 를 두고
  클라이언트 컴포넌트가 사용하도록 강제. ESLint `no-restricted-syntax` 로 `"use client"` 파일에서
  `.toLocaleString` / `Intl.DateTimeFormat` 사용 차단도 검토 가치 있음.

### G4. Compose project 자동 등록 — **MED**

- **파일**: `src/entities/project/api/upsertProjectFromContainer.ts:19-34`,
  `src/entities/project/config/knownComposeProjects.ts:1-37`
- **현상**: 처음 보는 compose 라벨이 즉시 `projects` 테이블에 INSERT.
  `knownComposeProjects` 는 더 이상 *gate* 가 아니라 seed-meta hint + cleanup pinned set.
- **현재 안전장치**: `onConflictDoUpdate` 는 `updatedAt` 만 갱신 → seed 가 채운 한글 메타를
  자동 등록이 덮어쓰지 않음.
- **잔존 위험**:
  - 잘못된 compose 라벨(예: 일회용 ad-hoc `docker compose -p test123 up`)도 영구 row 가 됨.
    `cleanup-projects` 스크립트 (`src/scripts/cleanup-projects.ts`) 가 회수 메커니즘이지만 수동.
  - displayName 이 compose key 그대로 들어가서 한글 메타가 없는 신규 row 는 시각적으로 못생김
    (운영 화면 noise).
- **권장**: 자동 INSERT 직후 staleness 가 일정 시간 (예: 24h) 지속되면 자동 hide 또는 daily
  cleanup cron 도입. 또는 `cleanup-projects` 를 cron 컨테이너에 dry-run-then-apply 로 추가.

### G5. Drizzle hidden-thrash (서버 상세 페이지) — **MED**

- **파일**: `src/app/servers/[hostName]/page.tsx:65-90`,
  `src/features/host-catalog/api/getHostsWithSummary.ts:22-58`
- **현상**: display 용 (`getProjects` — hidden=false) 과 dedup 용 (`getProjectComposeKeys` —
  hidden 포함) 을 분리하지 않으면 hidden project 가 매 요청마다 unknown 으로 분류돼
  `onConflictDoUpdate` 가 트리거되는 thrash 발생.
- **현재 안전장치**: 두 함수 모두 동일 패턴으로 작성. page 안의 주석(line 5-10)이 이 정책을 명시.
  `getProjectComposeKeys` 라는 별도 read API 가 hidden-aware dedup 의 단일 진입점.
- **잔존 위험**: 위 두 콜사이트가 *같은 패턴* 을 손으로 반복한다. 새 페이지(예: 호스트 비교 뷰)가
  추가될 때 한쪽만 까먹으면 thrash 재현.
- **권장**: dedup + auto-register 로직을 entities/project 레이어로 끌어올린 단일 함수
  (`syncMissingProjects(hostId, hostName, observedComposeKeys): Promise<Project[]>`) 로 추출.
  현재 두 콜사이트가 ~25 라인씩 거의 동일 코드를 반복하고 있음 (§3 참조).

---

## 2. FSD Boundary Risks

### B1. `features → features` 직접 import — **LOW** (의도적 예외)

- **eslint.config.mjs:38** — `{ from: "features", allow: ["features", ...] }` 로 의도적 허용.
- **실제 사용처 (단 1건)**:
  - `src/features/host-catalog/api/getHostsWithSummary.ts:10` →
    `import { groupByProject, type ProjectGroup } from "@/features/container-list"`
- **현재 안전장치**: eslint config 주석에 "groupByProject 는 사이드이펙트 없는 pure fn" 임을 명시.
- **잔존 위험**: 현재는 명백한 1건이지만 lint 가 풀려 있어 가시성 낮은 신규 결합이 추가될 수 있음.
- **권장**: `groupByProject` 를 `entities/container/lib/` 또는 `shared/lib/grouping/` 으로 끌어내려
  features → features 허용 자체를 제거하는 것이 정통 FSD. 단, 이 함수가 `Project` (entities/project)
  와 `ContainerSummary` (entities/container) 두 엔티티를 모두 참조하므로 entities 안에 둘 수 없고
  shared 로 가야 함 (shared 가 entities 타입을 import 못 하므로 타입을 generic 으로 만들거나 type-only 의존
  반대 흐름을 설계해야 함). 단기적으로는 현 상태 유지가 안전.

### B2. `entities/*` barrel 을 `"use client"` 트리에서 import 하는 경우 — **MED**

- 현재 검색 결과:
  - `src/widgets/email-digest/ui/ReplyCard.tsx:18` — `import type { ReplyNeededItem } from "@/entities/email"`
    (file is `"use client"`)
  - `src/widgets/important-emails/ui/ImportantEmailRow.tsx:14` — `import type { ImportantEmailItem } from "@/entities/email"`
    (file is `"use client"`)
  - `src/widgets/important-emails/ui/CategoryBadge.tsx:4` — `import type { Category, ImportantImportance } from "@/entities/email"`
    (CategoryBadge 의 client 여부는 확인 필요, 부모 ImportantEmailRow 가 client)
  - `src/features/container-actions/ui/ActionButtons.tsx:6` — `import type { ContainerState } from "@/entities/container"`
    (file is `"use client"`)
- **현 상황**: `import type` 만 사용 → TypeScript erased import. 보통은 Turbopack 도 erase 하지만,
  CLAUDE.md Gotcha §1 에 따르면 "import type 만 해도 Turbopack 이 barrel 전체를 client 번들로 끌어와
  빌드 실패한다" 라고 명시되어 있다. 실제로는 일부 케이스에서만 발생하는 듯하며 현재 빌드는 통과 중.
- **잔존 위험**: TS/Turbopack 버전 업그레이드 시 erase 동작이 바뀌면 위 4-5개 파일이 모두 빌드 깨질 수 있음.
- **권장**: 위 4파일을 deep import 로 정리.
  - `import type { ReplyNeededItem } from "@/entities/email/api/getReplyNeeded"`
  - `import type { ImportantEmailItem } from "@/entities/email/api/getImportantEmails"`
  - `import type { Category, ImportantImportance } from "@/entities/email/model/types"`
  - `import type { ContainerState } from "@/entities/container/model/types"`

### B3. Cross-layer 일관성 — **LOW**

- ESLint `boundaries/element-types` rule 이 layer 위반을 빌드타임에 차단. 위반 사례 없음 (스캔 결과).
- `app`, `widgets`, `features`, `entities`, `shared` 의 의존 방향은 깨끗.

---

## 3. Code Duplication / Patterns Ripe for Extraction

### D1. Server Action 인증/세션 가드 중복 — **MED**

- 같은 5-10 라인 패턴이 8군데:
  - `src/features/email-analysis/api/markAsRead.ts:19-23`
  - `src/features/email-analysis/api/markAsReplied.ts:18-20, 39-41`
  - `src/features/email-analysis/api/dismissThread.ts:12-13`
  - `src/features/email-analysis/api/archiveThread.ts:17-21`
  - `src/features/container-actions/api/_runAction.ts:50-52` (이쪽은 admin 체크까지 묶음)
- **두 가지 다른 실패 처리**:
  - email-analysis 일부: `return { ok: false, reason: "unauthorized" }`
  - email-analysis 일부(dismissThread, markAsReplied): `throw new Error("Unauthorized")`
  - container-actions: `return { ok: false, code: "UNAUTHORIZED" }`
  → 같은 의미인데 호출 측 UX 가 다름 (throw 는 Next.js error.tsx 가 받음, return 은 form action result).
- **권장**: `shared/lib/auth/requireSession()` (return discriminated `{ok:true, userId, email}` |
  `{ok:false, reason:"unauthorized"}`) 헬퍼로 통일. 단, action 의 return 타입이 도메인마다
  다르므로 헬퍼는 raw session 만 반환하고 분기는 각 action 이 유지하는 것이 현실적.

### D2. Gmail 4xx/InvalidGrant 핸들 패턴 중복 — **MED**

- `getValidAccessToken` 호출 + `InvalidGrantError` 분기가 4-5군데에 거의 동일하게 반복:
  - `src/features/email-analysis/api/markAsRead.ts:45-53`
  - `src/features/email-analysis/api/archiveThread.ts:40-48`
  - `src/features/gmail-sync/api/syncInbox.ts:46-56`
- **현재 안전장치**: `getValidAccessToken` 내부에서 `users.oauth_state='reauth_required'` 를 set.
  호출자는 ActionResult 만 만들면 됨.
- **권장**: `shared/lib/auth/gmail-token.ts` 에 `getGmailTokenOrResult(userId): Promise<{ok:true, token} | {ok:false, reason:'reauth-required'|'auth-error'}>`
  같은 wrapper 를 추가하면 콜사이트가 3줄로 줄어듦.

### D3. `revalidatePath` 경로 하드코딩 — **LOW**

- 5군데에서 `"/"`, `"/dashboard"`, `` `/servers/${host.name}` `` 가 문자열로 흩어짐
  (`src/features/email-analysis/api/*.ts`, `src/features/container-actions/api/_runAction.ts:118`).
- **이슈**: `/` vs `/dashboard` 가 같은 페이지를 가리키는지 불일치
  (`markAsRead`/`archiveThread` 는 `/dashboard`, `markAsReplied`/`dismissThread` 는 `/`).
  현재 `src/app/page.tsx` 는 루트에 있고 `/dashboard` 경로는 존재하지 않을 가능성 — revalidatePath
  가 *no-op* 으로 silently 실패 중일 수 있음 (Next.js 는 unknown path 에 에러 안 냄).
- **권장**: 경로 상수를 `shared/config/routes.ts` 에 모으고 모든 action 이 같은 상수 사용.
  실존 검증 (예: `/dashboard` 라우트가 실제로 있는지) 필수.

### D4. Docker upsert + dedup 패턴 중복 — **MED**

- §1 G5 와 같은 코드가 두 군데:
  - `src/app/servers/[hostName]/page.tsx:65-90` (25 lines)
  - `src/features/host-catalog/api/getHostsWithSummary.ts:24-58` (~30 lines)
  거의 동일한 `Promise.all([listContainers, getProjects, getProjectComposeKeys])` → set diff →
  `upsertProjectFromContainer` 패턴.
- **권장**: §1 G5 의 권장과 동일 — `syncMissingProjects` helper 로 추출.

### D5. Cron route boilerplate — **LOW**

- `src/app/api/cron/poll-gmail/route.ts:17-19`, `src/app/api/cron/morning-digest/route.ts:18-20` 는
  `verifyCronBearer` + activeUsers 쿼리가 동일.
- **권장**: 콜사이트가 2개뿐이라 추출 가치 낮음. 만약 3번째 cron 이 추가되면 그때 추출.

### D6. `console.warn` + `// TODO(logger):` 6군데 — **MED**

- 동일 TODO 코멘트가 그대로 복붙됨:
  - `src/shared/lib/llm/classify-important.ts:111`
  - `src/entities/email/api/classifyImportant.ts:73`
  - `src/features/gmail-sync/api/reclassifyRecent.ts:92`
  - `src/features/gmail-sync/api/syncInbox.ts:242`
  - `src/features/email-analysis/api/markAsRead.ts:37`
  - `src/features/email-analysis/api/archiveThread.ts:32`
- **현재 안전장치**: `shared/lib/log.ts` 가 아직 없다는 명시적 TODO.
- **권장**: `shared/lib/log.ts` 를 도입 (최소 pino 또는 자체 `logger.warn/info/error` wrapper) →
  6 콜사이트 일괄 치환. 구조화 로그가 cron 결과 분석에 즉시 도움.

---

## 4. Server-Only Code Leak Risk

- `src/scripts/_dryrun-oauth-scope.ts`, `src/scripts/seed-hosts.ts`, `src/scripts/seed-projects.ts`,
  `src/scripts/cleanup-projects.ts` 는 `dotenv/config` 로 직접 booting → `pnpm db:seed:*` 만 사용,
  client tree 와 분리. 안전.
- `node:child_process` 진입점은 `src/shared/lib/docker/runDocker.ts:1-3` 만. 모두 `"server-only"`
  declaration. 호출자도 `"server-only"` 또는 RSC. 안전.
- `node:crypto` 사용처: `src/shared/lib/auth/cron.ts:7` — `verifyCronBearer` 만, `"server-only"`.
- **실제 위험은 §1 G1 / §2 B2** 만. 코드 자체의 leak 경로는 막혀 있음.

---

## 5. Test Coverage Gaps

`pnpm test` (vitest) 가 커버 중인 영역과 누락 영역을 features/entities 단위로 비교.

### 커버 중

| 영역 | 테스트 파일 |
|------|-------------|
| `entities/email/lib/deterministic-classifier` | `tests/deterministic-classifier.test.ts` |
| `entities/email/api/classifyImportant` | `tests/classify-important-thread.test.ts`, `tests/important-classify-cycle.test.ts` |
| `entities/email/api/getImportantEmails` | `tests/get-important-emails.test.ts` |
| `entities/email/lib/unsubscribe-filter` | `tests/unsubscribe-filter.test.ts` |
| `entities/host/api` | `tests/host-api.test.ts` |
| `entities/project/api` | `tests/project-api.test.ts`, `tests/upsert-project-from-container.test.ts`, `tests/known-compose-projects.test.ts` |
| `entities/container` (parse/list/inspect) | `tests/docker-*.test.ts` (5개) |
| `features/container-actions` | `tests/container-actions.test.ts`, `tests/container-actions-admin.test.ts` |
| `features/container-list` | `tests/container-list-group-by-project.test.ts` |
| `features/email-analysis` (markAsRead/Archive 등) | `tests/important-actions.test.ts` |
| `features/gmail-sync/api/reclassifyRecent` | `tests/reclassify-recent.test.ts` |
| `shared/lib/llm/classify-important` | `tests/llm-classify-important.test.ts` |
| `shared/lib/url` | `tests/safe-external-url.test.ts` |
| Cron TZ | `tests/cron-tz.test.ts` |
| Scripts | `tests/cleanup-projects.test.ts` |

### 누락 — **MED**

| 영역 | 누락 함수/모듈 | 권장 우선순위 |
|------|----------------|---------------|
| `features/gmail-sync/api/syncInbox` | 분기 3종(ok-incremental / ok-full-rescan / reauth-required) 통합 테스트 없음. cron 핵심인데 미커버. | **HIGH** |
| `features/gmail-sync/lib/full-rescan` | 첫 sync / history stale fallback | **MED** |
| `features/gmail-sync/lib/classifyThreadsLoop` | reclassifyRecent 경유 indirect 만 커버 — direct test 없음 | **MED** |
| `entities/email/api/classifyThread` | deterministic-only 분기는 covered, LLM fallback / `user-replied` 보호 경로 미커버 | **MED** |
| `entities/email/api/getReplyNeeded` | SQL fragment (7-day window, KST midnight) 회귀 없음 | **MED** |
| `shared/api/gmail/*` (auth/history/messages/modify) | 직접 unit test 없음 (재시도 backoff, classifyGmailError 분기 등) | **MED** |
| `shared/lib/auth/cron.ts` | `verifyCronBearer` (timing-safe 비교) 단위 테스트 없음 | **LOW** |
| `shared/lib/push` | sendPush expired/error 분기 없음 | **MED** |
| Widgets / RSC 통합 | Email digest / Important emails widget snapshot 없음 (RSC 라 vitest 환경에선 어렵지만 e2e 가치 있음) | **LOW** |

### 권장

1. `syncInbox` 통합 테스트 우선 추가 — 회귀 빈도/영향 가장 큼.
2. Gmail API 클라이언트(`shared/api/gmail/*`) 의 retry/backoff 와 에러 분류 테스트 추가.
3. 향후 E2E (Playwright) 도입 시 servers/[hostName] 페이지의 키보드 단축키 + 자동 새로고침 + dedup
   정책 회귀 테스트.

---

## 6. Bus-Factor / Complexity Hotspots

### H1. `src/widgets/host-dashboard/ui/HostDashboard.tsx` (553 lines) — **HIGH**

- 단일 client component 가 다음을 모두 책임:
  - 검색 query + state filter + 정렬 정책 (`issues-first`)
  - 자동 새로고침 30 초 interval
  - 키보드 단축키 (Escape / `/` / `r` / `?`)
  - 도움말 패널 토글
  - 통계 집계 (`totalRunning`, `totalContainers`, `totalIssues`)
  - `renderActions` callback 으로 `ActionButtons` 주입
  - `ControlBar` 와 `FilterChip` 같은 sub-component 4-5종 in-file
  - `HelpPanel` 마크업 in-file
- **권장 분할**:
  - `useHostDashboardFilters` (`useState` + `useMemo` + `sortAndFilter`) — pure hook,
    `tests/widgets/use-host-dashboard-filters.test.ts` 로 단위 테스트 가능.
  - `useKeyboardShortcuts({...})` — 재사용 hook.
  - `useAutoRefresh(intervalMs)` — 재사용 hook.
  - `ControlBar`, `FilterChip`, `HelpPanel` 을 sibling `.tsx` 로 추출.
- 추출 후 본체는 ~150 라인 이하로 축소 가능 + 헬퍼 hook 들은 unit testable.

### H2. `src/features/gmail-sync/api/syncInbox.ts` (261 lines) — **MED**

- 5단계 (token → user → first sync / incremental → fetch+upsert → classify) 모두 single file.
- 분기 3종이 같은 함수 본체에 직선적으로 흘러 있음 — 분기 로직 단위 테스트가 어렵다 (§5 누락).
- **권장**: 3 sub-function (`firstSync`, `incrementalSync`, `recoverFromStale`) 으로 분리 후
  `syncInbox` 는 dispatcher 역할만. 각 sub-function 은 단위 테스트 가능.

### H3. `src/shared/lib/db/schema.ts` (243 lines) — **LOW**

- 도메인이 7개 (users/accounts/sessions, email_threads, reply_needed, important_emails, hosts,
  projects, audit_logs, push_subscriptions, verification_tokens) — 모두 한 파일.
- **현재 안전장치**: 도메인 헤더 주석으로 구획. drizzle-kit 이 단일 schema entry 를 기대.
- **권장**: drizzle-kit `schema: ['./src/shared/lib/db/schema/*.ts']` 로 분할 가능. 단, 우선순위 낮음
  — 현재 크기에서 가독성 손상은 미미. 500 라인 넘기 전엔 그대로 유지.

### H4. `src/scripts/seed-projects.ts` (209 lines) — **LOW**

- 데이터 테이블 (project list) 가 코드 안에 인라인. 운영 메타와 함께 자라남.
- **권장**: 데이터를 `seed-projects.json` 또는 YAML 로 외부화. 코드는 reader + idempotent upsert.

---

## 7. Documentation Drift

### Doc1. `dark:*` Tailwind 클래스가 라이트 모드 락인과 모순 — **MED**

- **CLAUDE.md 단언** (기술 스택 §): "**라이트 모드 고정** (`@variant dark (&:where(.dark, .dark *))` 로
  미디어쿼리 dark variant 차단)"
- **`src/app/globals.css:3-7`**: 위 주석 그대로 — `.dark` 클래스를 *어디에도 붙이지 않음*.
- **실제 코드**: 12 파일에 `dark:*` 유틸리티가 55군데 남아 있음 — 모두 dead code (절대 발화 안 함).
  - `src/app/servers/[hostName]/error.tsx`
  - `src/entities/host/ui/HostBadge.tsx`
  - `src/entities/container/ui/ContainerRow.tsx`
  - `src/entities/container/ui/ContainerStatusBadge.tsx`
  - `src/entities/project/ui/ProjectCard.tsx`
  - `src/widgets/server-overview/ui/{ServerOverviewError,ServerOverviewCard,ServerOverviewSkeleton}.tsx`
  - `src/features/container-actions/ui/{AuditLogPanel,ActionButtons}.tsx`
  - `src/features/container-list/ui/{StandaloneSection,ProjectGroupSection}.tsx`
- **권장**: 1회성 cleanup script 또는 codemod 로 `dark:[^"\s]+\s?` 패턴 제거. 향후 dark 도입 시
  토큰 기반으로 재설계 (CSS custom property + `.dark` class).

### Doc2. `revalidatePath("/dashboard")` 가 존재하지 않는 경로일 가능성 — **MED**

- **`src/app/page.tsx`** 는 `/` 경로의 RSC (line 1-117 확인). `src/app/dashboard/` 디렉터리는 없음
  (find 결과). `markAsRead`, `archiveThread` 가 `revalidatePath("/dashboard")` 호출 (§3 D3) —
  실제로는 noop. 사용자가 "읽음" 클릭 후 위젯이 새로고침되지 않을 수 있음.
- **권장**: 즉시 `"/"` 로 통일하거나, 진짜 `/dashboard` 라우트를 만든 뒤 통일. UX 회귀 가능성 있어
  우선순위 MED.

### Doc3. CLAUDE.md "Compose project 자동 등록" — **LOW**

- CLAUDE.md Gotcha §4 와 `knownComposeProjects.ts:1-15` 주석이 일치 — drift 없음. 그러나 신규
  기여자가 이 두 곳을 모두 봐야 정책 파악 가능. 단일 문서로 통합 권장.

### Doc4. `Sprint 2`, `eng review CRITICAL #N` 같은 stale reference — **LOW**

- `src/shared/lib/db/schema.ts:33` "Sprint 2 — Gmail polling 상태",
  `src/features/gmail-sync/api/syncInbox.ts:1` "eng review CRITICAL #8" 등 과거 sprint/리뷰
  넘버링이 그대로 코멘트로 남아 있음. 현재 sprint/리뷰 차수와 매핑 안 됨.
- **권장**: docs/superpowers/specs/ 의 spec ID 와 cross-reference 또는 단순 제거.

---

## 8. Migration Debt

drizzle 마이그레이션 6개 (`0000` ~ `0005`).

### M1. `0003_curvy_jubilee.sql` — index 재설계 — **LOW**

```sql
DROP INDEX "audit_logs_recent_idx";
DROP INDEX "audit_logs_container_idx";
CREATE INDEX "audit_logs_host_recent_idx" ON "audit_logs" ("host_id","created_at" DESC NULLS LAST);
```

- `0002` 에서 만들었던 두 index 를 `0003` 에서 *교체*. (host_id, created_at) 복합으로 통합.
- **이슈**: 단일 호스트가 아니라 multi-host 가 되면 `audit_logs_recent_idx` (host_id 무관 시간순) 가
  다시 필요할 수 있음 (admin 전체 로그 조회). 현재는 host 별 조회만 있으므로 OK.
- **권장**: 멀티 호스트 admin 대시보드 추가 시 index 재검토.

### M2. `0004` (hosts.ip) / `0005` (projects.url) — incremental column 추가 — **LOW**

- 둘 다 `text` nullable 컬럼. 점진적 진화, 정상.
- 단, `hosts.ip` 가 무엇에 쓰이는지 schema/seed 외엔 명시 안 됨. seed 외 read site 가 있는지 확인 필요
  (`grep -rn "hosts.ip\|\.ip\b" src/` 권장).

### M3. 누적 schema 결정 — **LOW**

- 6개 migration 모두 forward-only. 빈 rollback 정책 (down 없음) — drizzle-kit 기본.
- production DB 에서 마이그레이션 history 가 잘 적용됐는지는 `drizzle/meta/_journal.json` 으로 추적 중.
- **권장**: 운영 DB 에 `drizzle.__drizzle_migrations` 테이블 상태와 `_journal.json` 의 동기화를 정기 확인
  (RUNBOOK 에 명시).

### M4. snake_case 와 camelCase 혼용 — **LOW** (Auth.js 강제)

- `accounts` 테이블의 컬럼 키만 snake_case (`refresh_token`, `access_token`, …) — Auth.js
  drizzle-adapter `DefaultPostgresAccountsTable` 타입 강제. 다른 테이블은 camelCase.
- **현재 안전장치**: `schema.ts:41-44` 주석으로 명시.
- 변경 불가 — 외부 라이브러리 계약. 문서화만 유지.

---

## 우선순위 요약 (개선 작업 순서)

### HIGH (즉시 또는 다음 sprint)

1. **§5 누락 테스트 — `syncInbox` 통합 테스트 추가** (cron 핵심, 회귀 시 영향 큼)
2. **§1 G1 + §2 B2 — Client 트리의 `@/entities/*` barrel import 4건을 deep import 로 정리** +
   lint 규칙 추가 (Turbopack 업그레이드 회귀 방어)
3. **§1 G2 — prod DB 가드를 allow-list 로 전환 + scripts/ 도 보호** (이미 사고 이력 있음)

### MED (한두 sprint 내)

4. **§6 H1 — HostDashboard.tsx 분할** (553 라인 → 150 + 헬퍼 hook 3-4개)
5. **§3 D6 — `shared/lib/log.ts` 도입 후 6개 TODO 일괄 치환**
6. **§3 D1 + D2 — `requireSession()` / `getGmailTokenOrResult()` 헬퍼** (8 + 4 콜사이트 정리)
7. **§3 D4 + §1 G5 — `syncMissingProjects` helper 추출** (servers/[hostName]/page.tsx 와
   getHostsWithSummary 의 25-30 라인 중복 제거)
8. **§7 Doc1 — `dark:*` dead utility 일괄 제거** (55개)
9. **§7 Doc2 — `revalidatePath("/dashboard")` 경로 검증/통일**
10. **§5 — Gmail API 클라이언트 단위 테스트 보강**

### LOW (여유 있을 때)

11. **§2 B1 — `groupByProject` 를 shared 로 끌어내려 features→features 허용 제거**
12. **§6 H3 — `schema.ts` 도메인별 파일 분할** (>500 라인 도달 전엔 보류)
13. **§7 Doc4 — stale sprint/review 코멘트 정리**

---

*Concerns audit: 2026-05-11*
