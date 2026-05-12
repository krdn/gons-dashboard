# Hybrid MCP/API 도메인 아키텍처 — 원칙 + Calendar 파일럿

- **작성일**: 2026-05-12
- **상태**: Draft (사용자 리뷰 대기)
- **범위**: 아키텍처 원칙 + Calendar placeholder 위젯 1개 파일럿
- **다음 단계**: 사용자 리뷰 → `writing-plans` 스킬로 구현 계획

---

## 1. 동기 (Why)

`gons-dashboard`는 현재 4개의 도메인 위젯(email-digest, important-emails, server-overview, host-dashboard)을 가진 Next.js 단일 앱이다. 우측 사이드바에는 Calendar / Tasks placeholder가 비어 있고, `TODOS.md`에는 v0.2 후보 도메인이 다수 누적되어 있다.

이 spec은 두 가지 동시 흐름을 정리한다:

1. **외부 도메인 채우기** — Google Calendar 같은 외부 서비스를 끌어와 빈 영역을 채운다.
2. **내부 도메인 노출** — 기존·신규 도메인을 MCP 서버 / API로 외부 LLM 클라이언트(Claude Code 등)가 소비할 수 있게 한다.

위 둘이 분리된 패턴 두 개로 가면 도메인이 늘어날수록 결정 비용이 누적된다. 이 spec은 둘을 **하나의 Hybrid 패턴**으로 정립하고, 그 패턴을 **Calendar 도메인 1개로 처음 검증**한다. 검증 후 나머지 도메인은 후속 spec으로 동일 패턴을 따른다.

## 2. 의도적 비범위 (Out of scope)

이 spec은 다음을 다루지 않는다 — 동일 패턴으로 후속 spec에서 처리한다:

- 기존 4개 도메인(email-digest, important-emails, server-overview, host-dashboard)의 MCP 추출 마이그레이션
- Tasks placeholder 채우기 (Todoist/Notion 등)
- HMAC short-lived mediator 토큰 (TODOS.md #1) — v1은 정적 bearer, v2에 HMAC 도입
- `calendar.getEventDetail`, `calendar.findFreeSlot` 등 추가 MCP 도구
- ISR/캐싱 전략 정교화 — v1은 RSC `force-dynamic`만

## 3. 아키텍처 원칙

이 spec이 정립하는 Hybrid 원칙의 한 줄 요약:

> 각 도메인은 자기 단위의 "MCP 서버 패키지"를 가지고, 그 패키지가 도메인 데이터에 닿는 단일 통로다. Next.js 대시보드와 Claude/CLI는 둘 다 이 MCP 서버의 동등한 소비자다. 대시보드는 OAuth refresh token 같은 사용자 자격을 단독으로 보관·갱신하고, MCP 서버에는 짧은 access token만 발급한다.

구체 규칙 4가지:

### 3.1. 도메인-패키지 1:1 원칙

한 도메인(Calendar, Tasks, Email-Digest …)당 하나의 `packages/mcp-<domain>` 패키지. 그 안에 MCP tool 정의, 도메인 정규화, 외부 API 어댑터가 모두 들어간다.

### 3.2. 자격 위임 원칙 (Token Mediator)

refresh token은 대시보드만 본다. MCP 서버는 외부 API 호출 직전마다 대시보드의 내부 엔드포인트(`/api/mcp/credentials/<provider>`)에서 수명 짧은 access token을 받아 사용한다. 이 통로는 자체 인증(MCP↔대시보드 간 bearer)으로 보호한다.

### 3.3. 동등 소비자 원칙

대시보드 위젯이 도메인 데이터를 그릴 때도, Claude가 도구를 호출할 때도, 같은 MCP tool 함수를 거친다. 위젯은 도메인 로직을 직접 import하지 않는다.

| 모드 | 진입점 | tool 코드 | 토큰 통로 |
|---|---|---|---|
| In-process (대시보드 RSC) | `import { tools } from "@gons/mcp-<domain>"` | 동일 | 같은 프로세스 내부에서 mediator 호출 |
| Stdio (Claude Code) | `gons-mcp-<domain>` 바이너리 | 동일 | HTTPS로 mediator 호출 |

### 3.4. 공유는 shared-* 패키지로만

`packages/shared-google`, `packages/shared-mcp-runtime` 등 공통 코드는 별도 shared 패키지로 분리. 한 MCP 서버가 다른 MCP 서버의 내부를 직접 import하지 않는다.

```
apps/dashboard  ──▶ @gons/mcp-calendar  ──▶ @gons/shared-mcp-runtime
                                        └─▶ @gons/shared-google
                ──▶ @gons/shared-google         (mediator 라우트에서도 사용)
```

ESLint `eslint-plugin-boundaries`로 경계 검사. `packages/mcp-*`가 `apps/dashboard`를 import하면 실패. 한 `mcp-*`가 다른 `mcp-*`를 import해도 실패.

## 4. 시스템 다이어그램

```
                ┌─────────────────────────────────────────────┐
                │             User's machine                   │
                │                                              │
                │  ┌─────────────┐         ┌────────────────┐ │
                │  │ Claude Code │ ──stdio─▶ packages/       │ │
                │  └─────────────┘         │ mcp-calendar    │ │
                │                          │ (자식 프로세스)  │ │
                │                          └───────┬────────┘ │
                │                                  │           │
                └──────────────────────────────────┼───────────┘
                                                   │ HTTPS
                                                   ▼
   ┌────────────────────────────────────────────────────────────────┐
   │                gons.krdn.kr (Next.js apps/dashboard)            │
   │                                                                 │
   │  ┌────────────┐    ┌──────────────────────────────┐            │
   │  │  Calendar  │───▶│ /api/mcp/credentials/google  │            │
   │  │   Widget   │    │  → 5분 access_token 발급      │            │
   │  └─────┬──────┘    └──────────┬───────────────────┘            │
   │        │                       │                                │
   │        │ (서버 RSC가 MCP        │                                │
   │        │  in-process로 호출)    ▼                                │
   │        │              ┌─────────────────┐                       │
   │        └─────────────▶│ mcp-calendar의  │ ──▶ Google Calendar  │
   │                       │ tool functions  │     API               │
   │                       └─────────────────┘                       │
   │                                                                 │
   │  NextAuth + Drizzle: accounts.refresh_token (pgcrypto)          │
   └─────────────────────────────────────────────────────────────────┘
```

## 5. 패키지 레이아웃

레포를 pnpm workspaces로 전환한다.

```
gons-dashboard/                    (repo root, pnpm workspace)
├── pnpm-workspace.yaml            (신규)
├── package.json                   (워크스페이스 root — devDeps만)
├── tsconfig.base.json             (신규 — 공통 compilerOptions)
│
├── apps/
│   └── dashboard/                 (현 src/, public/, drizzle/, scripts/, tests/ 이전)
│       ├── package.json           (name: "@gons/dashboard")
│       ├── next.config.ts         (transpilePackages: ["@gons/mcp-calendar", "@gons/shared-google", "@gons/shared-mcp-runtime"])
│       ├── tsconfig.json          (extends ../../tsconfig.base.json)
│       └── src/                   (현 FSD 구조 그대로)
│
└── packages/
    ├── shared-google/             (Google API 클라이언트 wrapper, 토큰 갱신, retry/error 분류)
    │   ├── package.json           (name: "@gons/shared-google")
    │   └── src/
    │       ├── access-token.ts    (mediator 호출 — fetcher 패턴)
    │       ├── calendar-client.ts (Google Calendar API thin wrapper)
    │       └── errors.ts
    │
    ├── shared-mcp-runtime/        (MCP tool 정의 헬퍼, Zod ↔ JSONSchema, in-process 어댑터)
    │   ├── package.json           (name: "@gons/shared-mcp-runtime")
    │   └── src/
    │       ├── define-tool.ts     (Zod 입력/출력 + 핸들러 → MCP tool 객체)
    │       ├── stdio-server.ts    (자식 프로세스용 bootstrap — @modelcontextprotocol/sdk wrap)
    │       └── inprocess.ts       (RSC가 tool을 직접 호출하는 진입점)
    │
    └── mcp-calendar/              (파일럿)
        ├── package.json           (name: "@gons/mcp-calendar", "bin": { "gons-mcp-calendar": "dist/cli.js" })
        ├── tsconfig.json
        └── src/
            ├── tools/
            │   └── get-upcoming-events.ts
            ├── domain/
            │   └── normalize-event.ts        (Google → CalendarEvent 변환)
            ├── index.ts                       (toolset export — in-process용)
            └── cli.ts                          (stdio 진입점)
```

## 6. 단계적 마이그레이션

5단계로 쪼개 PR 단위가 작도록 유지.

1. **단계 0 (별도 PR)** — 현재 코드를 `apps/dashboard/`로 무동작 이동. `pnpm-workspace.yaml` + `tsconfig.base.json` 생성. 빌드·테스트·배포가 그대로 동작하는지만 확인.
2. **단계 1** — `packages/shared-google` + `packages/shared-mcp-runtime` 빈 패키지로 초기화. 코어 유틸 작성 + 단위 테스트.
3. **단계 2** — `packages/mcp-calendar` 패키지 + `getUpcomingEvents` tool 구현 + 단위 테스트.
4. **단계 3** — `apps/dashboard`에 `/api/mcp/credentials/google` mediator 라우트 + `CalendarCard` 위젯 추가. 위젯이 in-process로 mcp-calendar tool 호출.
5. **단계 4** — `packages/mcp-calendar/dist/cli.js` 빌드, Claude Code에 등록, stdio 핸드셰이크 검증.

## 7. MCP 도구 계약 — `calendar.getUpcomingEvents`

**용도**: 다음 N시간 안의 일정 조회.

**입력 스키마 (Zod)**:

```ts
const Input = z.object({
  withinHours: z.number().int().min(1).max(168).default(24),
  limit: z.number().int().min(1).max(50).default(10),
  calendarId: z.string().default("primary"),
});
```

**출력 스키마**:

```ts
const Event = z.object({
  id: z.string(),
  title: z.string(),
  startAt: z.string().datetime(),         // ISO 8601 UTC
  endAt: z.string().datetime(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  attendees: z.array(z.object({
    email: z.string(),
    responseStatus: z.enum(["accepted", "declined", "tentative", "needsAction"]).nullable(),
  })),
  meetingUrl: z.string().url().nullable(),
  htmlLink: z.string().url(),
});
const Output = z.object({
  events: z.array(Event),                  // startAt ASC 정렬 보장
  fetchedAt: z.string().datetime(),
});
```

**핵심 결정**:

- 시간은 항상 UTC ISO. KST 변환은 위젯이 담당 (Gotcha #3 — locale 의존 hydration mismatch 회피).
- 반복 일정은 Google API의 `singleEvents=true`로 펼쳐서 반환. recurrence 원본 노출 안 함.
- `attendees`의 `responseStatus`를 함께 노출 (Claude의 깊은 질의 활용).
- `fetchedAt`을 포함해 위젯이 "방금 / 5분 전" 같은 시각화 가능.

## 8. 토큰 Mediator — `/api/mcp/credentials/google`

`apps/dashboard/src/app/api/mcp/credentials/google/route.ts`

**입력**: `Authorization: Bearer <MCP_DASHBOARD_TOKEN>`

**처리**:

1. Bearer 검증 → 실패 시 401.
2. body/query에서 `userEmail` 수신. v1 단일 사용자 환경: `ADMIN_EMAILS[0]`로 fallback.
3. Drizzle로 `accounts` 테이블에서 pgcrypto 복호화 → refresh_token.
4. Google OAuth token endpoint에 refresh → access token + expires_in.
5. 응답: `{ accessToken, expiresAt }`. refresh token은 절대 노출 안 함.

**보안 가드**:

- 응답은 항상 `Cache-Control: no-store`.
- 정적 bearer는 v1만. v2에 HMAC + nonce + 60초 TTL (TODOS.md #1 패턴).
- bearer는 `shared/config/env.ts`의 Zod 스키마로 검증해 누락 시 부팅 실패.

**에러 분류**:

| Google 응답 | mediator 응답 | tool throw | 위젯 표시 |
|---|---|---|---|
| `invalid_grant` (refresh 만료) | 410 Gone | `OAuthExpiredError` | "다시 로그인" 버튼 (`signIn("google")`) |
| 429 | 1회 backoff 재시도, 그래도 실패면 503 | `TransientError` | "잠시 후 다시 시도됩니다" |
| 5xx / 네트워크 | 1회 재시도, 실패 시 503 | `TransientError` | 동일 |

`oauth_state = 'reauth_required'` 마킹은 mediator가 410을 반환할 때 동기적으로 수행.

## 9. 위젯 디자인

### 위치

`apps/dashboard/src/app/page.tsx`의 우측 사이드바 placeholder 자리 (현재 `<aside aria-label="향후 위젯 자리">`).

### 정상 상태

```
┌─ Calendar ─────────────────────────┐
│ 오늘                                │
│ 14:00 — 15:00  ●                    │
│ 디자인 리뷰                         │
│ Google Meet · 3명                   │
│                                    │
│ 17:30 — 18:00                       │
│ 1:1 with PM                         │
│                                    │
│ 내일                                │
│ 10:00 — 11:00                       │
│ 분기 OKR 정리                      │
│                                    │
│ Google 캘린더에서 열기 →           │
└────────────────────────────────────┘
```

규칙:

- "오늘" / "내일" 헤더(KST 기준). 24h 안에 모두 없으면 빈 상태로 진입.
- 시간 표기는 locale-free `HH:MM` (Gotcha #3).
- Meet/Zoom 링크 있으면 "Google Meet · N명" 표시.
- 이벤트 클릭 시 `htmlLink`를 새 탭으로 열기.
- 진행 중 이벤트는 `●` 도트(`var(--color-accent)`) + `aria-label="진행 중"`.

### 빈 상태

```
다음 24시간 동안 일정이 없습니다.

⌬ "쉼 없는 일상은 일상이 아니라 중단이다." — 한병철

Google 캘린더에서 열기 →
```

(email-digest의 빈 상태 패턴 재사용. 동일 인용구 풀 공유. TODOS.md #4 회전 로직 도입 시 함께 적용.)

### 에러 상태

- **재인증 필요**: "Google 캘린더 접근 권한이 만료되었어요. [다시 로그인]"
- **일시적 오류**: "잠시 캘린더를 불러오지 못했어요. 잠시 후 다시 시도됩니다."

### 데이터 신선도

- RSC `force-dynamic` (대시보드 전체 규약).
- 클라이언트 폴링 없음.
- ISR/캐싱은 v0.2.

### 접근성

- 카드 root `<section aria-labelledby="calendar-heading">`.
- 시간은 `<time dateTime="2026-05-12T14:00:00+09:00">14:00</time>`.
- 색 단일 의존 금지(도트 외에 텍스트 라벨 함께).

## 10. 테스트 전략

80% 이상 커버리지. `pnpm -r test --coverage`로 게이트.

| 계층 | 무엇 | 위치 |
|---|---|---|
| shared-google | `getAccessToken()` HTTP 호출, 401/410/5xx 분류 | `packages/shared-google/src/access-token.test.ts` |
| shared-google | `calendarClient.listUpcoming()` query 정확성, 에러 분류 | `packages/shared-google/src/calendar-client.test.ts` |
| mcp-calendar | `getUpcomingEvents` Zod 검증, 정규화, 정렬, 반복 일정 펼침 | `packages/mcp-calendar/src/tools/get-upcoming-events.test.ts` |
| dashboard | `/api/mcp/credentials/google`: 401/410/200, `Cache-Control: no-store` | `apps/dashboard/tests/integration/mcp-credentials.test.ts` |
| dashboard | `<CalendarCard>` 3개 상태 렌더링 | `apps/dashboard/tests/widgets/calendar-card.test.tsx` |
| mcp-calendar | stdio CLI: tools/list, tools/call 핸드셰이크 | `packages/mcp-calendar/tests/cli.test.ts` |

**의도적 제외**: 실제 Google API e2e 호출 — 운영 의존이라 dogfooding으로 대체.

**기존 테스트 가드 유지**: `tests/setup.ts`의 prod DB 차단 패턴(Gotcha #2)을 `apps/dashboard` 이전 후에도 유지.

## 11. 환경 변수

`.env.example` 및 `shared/config/env.ts` Zod 스키마에 추가:

| 변수 | 용도 | 위치 |
|---|---|---|
| `MCP_DASHBOARD_TOKEN` | Mediator bearer (정적, v1) | apps/dashboard + 사용자 머신 양쪽 |
| `MCP_DASHBOARD_URL` | MCP가 호출할 dashboard URL | 사용자 머신만 (기본값 `https://gons.krdn.kr`) |

미설정 시 부팅 실패(고의).

## 12. Claude Code MCP 등록

사용자 머신의 Claude Code 설정:

```json
{
  "mcpServers": {
    "gons-calendar": {
      "command": "node",
      "args": ["/path/to/gons-dashboard/packages/mcp-calendar/dist/cli.js"],
      "env": {
        "MCP_DASHBOARD_URL": "https://gons.krdn.kr",
        "MCP_DASHBOARD_TOKEN": "<secret>"
      }
    }
  }
}
```

v1엔 npm 게시 안 함. 로컬 빌드 + 절대 경로 등록. 등록 절차는 `docs/RUNBOOK.md`에 추가.

## 13. CI / 배포

- 워크스페이스 전환에 따라 `pnpm install`이 모든 패키지를 설치.
- GitHub Actions: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, `pnpm --filter @gons/dashboard build`로 갱신.
- Docker image는 `apps/dashboard`만 빌드. MCP 패키지는 사용자 머신용이라 배포 대상 아님.
- 운영 배포 흐름은 변경 없음 — 기존 ghcr 푸시 → 192.168.0.5 compose pull/up.

## 14. 운영 문서 갱신

- `docs/RUNBOOK.md`: MCP 토큰 회전 절차, mediator 라우트 장애 대응(Calendar 위젯만 격리 실패).
- `CLAUDE.md`: "MCP 도구 호출 정책" 섹션 추가 — 위젯이 `@gons/mcp-calendar`를 in-process로 어떻게 호출하는지의 규약.
- `TODOS.md`: 이번 spec에서 의도적으로 미룬 항목 추가 (`getEventDetail`, HMAC mediator, Tasks MCP, 기존 도메인 마이그레이션).

## 15. "완료" 정의 (Definition of Done)

- [ ] `apps/dashboard`로 코드 이전 후 빌드·테스트·배포가 그대로 동작
- [ ] `pnpm -r test` 통과 + 신규 코드 80%+ 커버리지
- [ ] `pnpm -r typecheck` 통과
- [ ] `pnpm -r lint` 통과 (`eslint-plugin-boundaries` 패키지 경계 규칙 포함)
- [ ] 로컬에서 `node packages/mcp-calendar/dist/cli.js`를 Claude Code에 등록 → `tools/list`에서 `getUpcomingEvents` 노출
- [ ] 운영 배포 후 `https://gons.krdn.kr` 우측 사이드바에 Calendar 카드가 실제 이벤트로 렌더링
- [ ] Mediator 라우트가 `Cache-Control: no-store` 응답
- [ ] OAuth 만료 시 위젯에 재로그인 배너, Claude에는 명시적 `OAuthExpiredError` 메시지
- [ ] `docs/RUNBOOK.md`에 MCP 토큰 회전 절차 기재
- [ ] `CLAUDE.md`에 MCP 도구 호출 정책 섹션 추가
- [ ] `TODOS.md`에 후속 마이그레이션 항목 기재

## 16. 후속 spec 예고

이 spec이 검증되면 동일 패턴으로:

1. **Tasks placeholder** — Todoist/Notion MCP 어댑터 (`packages/mcp-tasks`).
2. **email-digest 추출** — `widgets/email-digest`의 도메인 로직을 `packages/mcp-email`로 이전. 기존 4개 위젯 중 가장 먼저 추출하는 게 가치 큼(LLM이 답장 우선순위를 추천 가능).
3. **server-overview MCP** — Docker host 조회 도구. 감사 로그·재시작 권한 분리는 별도 ADR 필요.
4. **HMAC mediator (v2)** — TODOS.md #1과 함께. 외부 webhook 도입 타이밍과 정렬.
