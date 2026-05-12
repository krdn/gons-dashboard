# Calendar MCP 파일럿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec(`docs/superpowers/specs/2026-05-12-hybrid-mcp-api-domains-design.md`)의 단계 1~4 — `packages/shared-google` + `packages/shared-mcp-runtime` + `packages/mcp-calendar` 신설, 대시보드의 token mediator 라우트 + Calendar 위젯, Claude Code 등록까지. Hybrid 패턴을 처음으로 살아 있는 도메인 1개로 검증.

**Architecture:** 두 shared 패키지(Google API client, MCP runtime helper)와 한 도메인 패키지(`mcp-calendar`)를 신설. 도메인 패키지의 tool 함수는 in-process(대시보드 RSC에서 직접 import)와 stdio(Claude Code 자식 프로세스) 두 진입점에서 동일하게 호출. OAuth refresh token은 대시보드 `accounts` 테이블에 그대로 남고, MCP는 대시보드의 `/api/mcp/credentials/google` mediator 라우트에서 5분 access token만 받는다.

**Tech Stack:** TypeScript 5, Zod 3, `@modelcontextprotocol/sdk` (신규 의존성), Next.js 16 RSC, Vitest 4, Drizzle ORM, NextAuth v5

**Prerequisites:** plan-A(`docs/superpowers/plans/2026-05-12-workspace-migration.md`) 머지 + 운영 배포 완료. `apps/dashboard/`로 코드가 이전된 상태여야 함.

---

## File Structure

```
gons-dashboard/
├── apps/dashboard/
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   └── mcp/
│   │   │   │       └── credentials/
│   │   │   │           └── google/
│   │   │   │               └── route.ts        (신규 — mediator)
│   │   │   └── page.tsx                         (수정 — CalendarCard 삽입)
│   │   ├── shared/
│   │   │   ├── config/env.ts                    (수정 — MCP_DASHBOARD_TOKEN 추가)
│   │   │   └── lib/auth/index.ts                (수정 — calendar.readonly scope 추가)
│   │   └── widgets/
│   │       └── calendar/                        (신규 — 위젯 슬라이스)
│   │           ├── index.ts
│   │           ├── ui/
│   │           │   ├── CalendarCard.tsx
│   │           │   ├── CalendarCard.test.tsx
│   │           │   ├── CalendarSkeleton.tsx
│   │           │   └── format.ts                 (locale-free HH:MM)
│   │           └── lib/
│   │               └── groupByDay.ts             (today/tomorrow 분류 + 테스트)
│   ├── tests/
│   │   └── integration/
│   │       └── mcp-credentials.test.ts          (신규)
│   └── .env.example                              (수정 — MCP_DASHBOARD_TOKEN)
│
└── packages/
    ├── shared-google/                            (신규 패키지)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   └── src/
    │       ├── index.ts
    │       ├── errors.ts                          (OAuthExpiredError, TransientError)
    │       ├── access-token.ts                    (mediator 호출 fetcher)
    │       ├── access-token.test.ts
    │       ├── calendar-client.ts                 (Google Calendar API thin wrap)
    │       └── calendar-client.test.ts
    │
    ├── shared-mcp-runtime/                       (신규 패키지)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   └── src/
    │       ├── index.ts
    │       ├── define-tool.ts                     (Zod ↔ MCP tool 객체)
    │       ├── define-tool.test.ts
    │       └── stdio-server.ts                    (MCP SDK wrap)
    │
    └── mcp-calendar/                              (신규 패키지)
        ├── package.json                            (bin: gons-mcp-calendar)
        ├── tsconfig.json
        ├── vitest.config.ts
        ├── tsup.config.ts                          (cli 번들링)
        └── src/
            ├── index.ts                            (toolset export — in-process용)
            ├── cli.ts                              (stdio 진입점)
            ├── domain/
            │   ├── event.ts                        (Zod Event 스키마)
            │   └── normalize-event.ts
            └── tools/
                ├── get-upcoming-events.ts
                └── get-upcoming-events.test.ts
```

**의존성 그래프**:
- `@gons/mcp-calendar` → `@gons/shared-mcp-runtime`, `@gons/shared-google`, `zod`
- `@gons/shared-google` → `zod` (only)
- `@gons/shared-mcp-runtime` → `@modelcontextprotocol/sdk`, `zod`
- `@gons/dashboard` → `@gons/mcp-calendar`, `@gons/shared-google`(in mediator)

---

## Task 1: 신규 의존성 추가 + 환경 변수 스키마 확장

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `apps/dashboard/src/shared/config/env.ts`
- Modify: `apps/dashboard/.env.example`

- [ ] **Step 1: env.ts에 MCP_DASHBOARD_TOKEN 추가**

Find in `apps/dashboard/src/shared/config/env.ts` the section right before `// 타임존`. Add:

```ts
  // MCP mediator bearer — packages/mcp-* → /api/mcp/credentials/* 호출 인증.
  // v1은 정적 bearer. v2에서 HMAC short-lived로 전환 (TODOS #1 / spec §8).
  MCP_DASHBOARD_TOKEN: z.string().min(32, "openssl rand -hex 32 로 생성"),
```

- [ ] **Step 2: .env.example에 항목 추가**

Append to `apps/dashboard/.env.example`:

```
# ===== MCP mediator bearer =====
# openssl rand -hex 32 로 생성.
# 같은 값을 사용자 머신의 Claude Code MCP env에도 등록한다.
MCP_DASHBOARD_TOKEN=
```

- [ ] **Step 3: typecheck 통과 확인**

Run:
```bash
pnpm typecheck
```

Expected: `MCP_DASHBOARD_TOKEN` 누락 에러는 부팅 시점에만 발생 — typecheck는 통과.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/shared/config/env.ts apps/dashboard/.env.example
git commit -m "$(cat <<'EOF'
feat(env): MCP mediator bearer 환경 변수 추가

MCP_DASHBOARD_TOKEN — packages/mcp-* 가 /api/mcp/credentials/* 호출 시
사용할 정적 bearer. v1은 정적, v2에서 HMAC short-lived로 전환 예정
(TODOS #1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: NextAuth에 Calendar scope 추가

**Files:**
- Modify: `apps/dashboard/src/shared/lib/auth/index.ts`

`gmail.readonly`/`gmail.modify` scope만 있는 기존 OAuth에 `calendar.readonly`를 추가해야 Google Calendar API가 호출된다.

- [ ] **Step 1: scope 배열에 calendar.readonly 추가**

In `apps/dashboard/src/shared/lib/auth/index.ts`, the `scope` array (안에 `gmail.readonly`, `gmail.modify`가 있는 곳)에 추가:

```ts
          scope: [
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/calendar.readonly",
          ].join(" "),
```

- [ ] **Step 2: 사용자에게 재로그인 필요 안내 (plan 본문 메모)**

scope 추가 후 사용자는 한 번 재로그인해야 새 scope가 grant됨. plan 본문에 사용자 게이트로 기록 — 자동화 X. plan 실행 도중 step 9의 Calendar 위젯 검증 전에 사용자가 https://gons.krdn.kr에서 로그아웃 → 다시 로그인 필요.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/shared/lib/auth/index.ts
git commit -m "$(cat <<'EOF'
feat(auth): Google OAuth scope에 calendar.readonly 추가

Calendar MCP 파일럿 — Google Calendar API 호출 권한 부여. 기존 사용자는
재로그인 시 새 scope에 동의해야 함.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: packages/shared-google 초기 골격

**Files:**
- Create: `packages/shared-google/package.json`
- Create: `packages/shared-google/tsconfig.json`
- Create: `packages/shared-google/vitest.config.ts`
- Create: `packages/shared-google/src/index.ts` (빈 barrel)

- [ ] **Step 1: package.json 작성**

Create `packages/shared-google/package.json`:

```json
{
  "name": "@gons/shared-google",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "eslint": "^9",
    "typescript": "^5",
    "vitest": "^4.1.5"
  }
}
```

(`main`을 `src/index.ts`로 두고 `transpilePackages`에 의존 — 별도 빌드 단계 생략. workspace 내부 소비라 안전.)

- [ ] **Step 2: tsconfig.json 작성**

Create `packages/shared-google/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: vitest.config.ts 작성**

Create `packages/shared-google/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: 빈 barrel**

Create `packages/shared-google/src/index.ts`:

```ts
// 다음 task부터 채워짐
export {};
```

- [ ] **Step 5: pnpm install로 워크스페이스 인식**

Run:
```bash
pnpm install
pnpm --filter @gons/shared-google typecheck
```

Expected: 두 명령 모두 통과.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared-google pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(packages): shared-google 패키지 골격 추가

Google API 클라이언트 + 토큰 retrieval을 담을 워크스페이스 패키지의
빈 골격. 다음 커밋부터 내용 채움.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: shared-google — 에러 타입 정의 (TDD)

**Files:**
- Create: `packages/shared-google/src/errors.ts`

Gmail 패턴(`apps/dashboard/src/shared/api/gmail/errors.ts`)을 차용하되 Calendar 도메인용으로 축약.

- [ ] **Step 1: 에러 타입 작성**

Create `packages/shared-google/src/errors.ts`:

```ts
// shared-google — 도메인별 mcp-* 패키지가 분기할 수 있도록 에러를 분류.
//
// OAuthExpiredError: mediator가 410 — refresh token 자체가 무효.
//   호출자는 사용자에게 재로그인 안내 (위젯 배너, Claude 에러 메시지).
// TransientError: 429/5xx/네트워크 — 재시도 가능.
//   shared-google 내부에서 1회 backoff 재시도 후에도 실패 시 throw.

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export class OAuthExpiredError extends GoogleApiError {
  constructor(message = "Google OAuth refresh token이 만료되었습니다") {
    super(message, 410);
    this.name = "OAuthExpiredError";
  }
}

export class TransientError extends GoogleApiError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "TransientError";
  }
}
```

- [ ] **Step 2: index.ts에서 re-export**

Replace `packages/shared-google/src/index.ts`:

```ts
export { GoogleApiError, OAuthExpiredError, TransientError } from "./errors";
```

- [ ] **Step 3: typecheck**

Run:
```bash
pnpm --filter @gons/shared-google typecheck
```

Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add packages/shared-google/src
git commit -m "$(cat <<'EOF'
feat(shared-google): 에러 타입 — OAuthExpiredError, TransientError

도메인별 mcp-* 패키지가 동일한 에러 클래스로 분기할 수 있도록 공통화.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: shared-google — access-token fetcher (TDD)

**Files:**
- Create: `packages/shared-google/src/access-token.test.ts`
- Create: `packages/shared-google/src/access-token.ts`

mediator를 호출해 access token을 받아오는 함수. 401(인증 실패), 410(refresh 만료), 200(정상)을 분류. 호출자가 fetch impl과 mediator URL을 주입할 수 있게 dependency injection.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `packages/shared-google/src/access-token.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchAccessToken } from "./access-token";
import { OAuthExpiredError, TransientError, GoogleApiError } from "./errors";

const mediatorUrl = "https://gons.krdn.kr/api/mcp/credentials/google";
const bearer = "test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("fetchAccessToken", () => {
  it("returns access token on 200", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "ya29.test",
          expiresAt: "2026-05-12T10:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await fetchAccessToken({
      mediatorUrl,
      bearer,
      fetcher,
    });
    expect(result.accessToken).toBe("ya29.test");
    expect(fetcher).toHaveBeenCalledWith(
      mediatorUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${bearer}`,
        }),
      }),
    );
  });

  it("throws OAuthExpiredError on 410", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("Gone", { status: 410 }),
    );
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      OAuthExpiredError,
    );
  });

  it("throws GoogleApiError on 401", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      GoogleApiError,
    );
  });

  it("throws TransientError on 503", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("Service unavailable", { status: 503 }),
    );
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      TransientError,
    );
  });

  it("throws TransientError on network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      TransientError,
    );
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run:
```bash
pnpm --filter @gons/shared-google test
```

Expected: FAIL — `fetchAccessToken` 미정의.

- [ ] **Step 3: 구현 작성**

Create `packages/shared-google/src/access-token.ts`:

```ts
import { z } from "zod";
import { GoogleApiError, OAuthExpiredError, TransientError } from "./errors";

const ResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export interface FetchAccessTokenOptions {
  mediatorUrl: string;
  bearer: string;
  /** Inject for tests; defaults to global fetch. */
  fetcher?: typeof fetch;
}

export interface AccessTokenResult {
  accessToken: string;
  expiresAt: string;
}

export async function fetchAccessToken(
  opts: FetchAccessTokenOptions,
): Promise<AccessTokenResult> {
  const { mediatorUrl, bearer, fetcher = fetch } = opts;
  let response: Response;
  try {
    response = await fetcher(mediatorUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new TransientError(
      `Mediator unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }

  if (response.status === 410) {
    throw new OAuthExpiredError();
  }
  if (response.status === 401 || response.status === 403) {
    throw new GoogleApiError(
      `Mediator auth failed (${response.status})`,
      response.status,
    );
  }
  if (response.status >= 500 || response.status === 429) {
    throw new TransientError(
      `Mediator transient failure (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new GoogleApiError(
      `Mediator unexpected ${response.status}`,
      response.status,
    );
  }

  const body = await response.json();
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new GoogleApiError(
      `Mediator response shape invalid: ${parsed.error.message}`,
      500,
    );
  }
  return parsed.data;
}
```

- [ ] **Step 4: index.ts에서 re-export**

Update `packages/shared-google/src/index.ts`:

```ts
export { GoogleApiError, OAuthExpiredError, TransientError } from "./errors";
export { fetchAccessToken } from "./access-token";
export type { FetchAccessTokenOptions, AccessTokenResult } from "./access-token";
```

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
pnpm --filter @gons/shared-google test
```

Expected: 5/5 PASS.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared-google/src
git commit -m "$(cat <<'EOF'
feat(shared-google): fetchAccessToken — mediator 호출 fetcher (TDD)

200/410/401/5xx/네트워크 5가지 분기. 401 → GoogleApiError, 410 →
OAuthExpiredError, 5xx/429/네트워크 → TransientError. 정상 응답은 Zod로
검증.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: shared-google — Calendar API client (TDD)

**Files:**
- Create: `packages/shared-google/src/calendar-client.test.ts`
- Create: `packages/shared-google/src/calendar-client.ts`

Google Calendar API의 `events.list` thin wrap. `singleEvents=true`로 반복 일정 펼침, `orderBy=startTime`로 정렬 보장.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `packages/shared-google/src/calendar-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listUpcomingEvents } from "./calendar-client";
import { OAuthExpiredError, TransientError } from "./errors";

const accessToken = "ya29.test";

describe("listUpcomingEvents", () => {
  it("sends singleEvents=true and orderBy=startTime", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await listUpcomingEvents({
      accessToken,
      calendarId: "primary",
      timeMin: "2026-05-12T00:00:00.000Z",
      timeMax: "2026-05-13T00:00:00.000Z",
      maxResults: 5,
      fetcher,
    });
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("orderBy=startTime");
    expect(url).toContain("maxResults=5");
    expect(url).toContain("calendars/primary/events");
  });

  it("URL-encodes timeMin/timeMax", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    await listUpcomingEvents({
      accessToken,
      calendarId: "primary",
      timeMin: "2026-05-12T00:00:00.000Z",
      timeMax: "2026-05-13T00:00:00.000Z",
      maxResults: 5,
      fetcher,
    });
    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toMatch(/timeMin=2026-05-12T00%3A00%3A00\.000Z/);
  });

  it("throws OAuthExpiredError on 401", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(
      listUpcomingEvents({
        accessToken,
        calendarId: "primary",
        timeMin: "2026-05-12T00:00:00.000Z",
        timeMax: "2026-05-13T00:00:00.000Z",
        maxResults: 5,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(OAuthExpiredError);
  });

  it("throws TransientError on 503", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(
      listUpcomingEvents({
        accessToken,
        calendarId: "primary",
        timeMin: "2026-05-12T00:00:00.000Z",
        timeMax: "2026-05-13T00:00:00.000Z",
        maxResults: 5,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("returns raw items array on 200", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { id: "abc", summary: "Test", start: { dateTime: "2026-05-12T05:00:00Z" } },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await listUpcomingEvents({
      accessToken,
      calendarId: "primary",
      timeMin: "2026-05-12T00:00:00.000Z",
      timeMax: "2026-05-13T00:00:00.000Z",
      maxResults: 5,
      fetcher,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("abc");
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run:
```bash
pnpm --filter @gons/shared-google test
```

Expected: 새 테스트 모두 FAIL — `listUpcomingEvents` 미정의.

- [ ] **Step 3: 구현 작성**

Create `packages/shared-google/src/calendar-client.ts`:

```ts
import { OAuthExpiredError, GoogleApiError, TransientError } from "./errors";

// raw Google Calendar API event shape. shared-google은 정규화하지 않는다 —
// 정규화는 mcp-calendar 도메인 패키지의 책임 (event 모양이 도메인 결정이므로).
export interface RawGoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: unknown;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

export interface ListUpcomingEventsOptions {
  accessToken: string;
  calendarId: string;
  timeMin: string;  // ISO 8601
  timeMax: string;  // ISO 8601
  maxResults: number;
  fetcher?: typeof fetch;
}

export interface ListUpcomingEventsResult {
  items: RawGoogleEvent[];
}

export async function listUpcomingEvents(
  opts: ListUpcomingEventsOptions,
): Promise<ListUpcomingEventsResult> {
  const { accessToken, calendarId, timeMin, timeMax, maxResults, fetcher = fetch } = opts;
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new TransientError(
      `Calendar API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new OAuthExpiredError(`Calendar API auth failed (${response.status})`);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new TransientError(
      `Calendar API transient (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new GoogleApiError(
      `Calendar API unexpected ${response.status}`,
      response.status,
    );
  }

  const body = (await response.json()) as { items?: RawGoogleEvent[] };
  return { items: body.items ?? [] };
}
```

- [ ] **Step 4: index.ts re-export 갱신**

Update `packages/shared-google/src/index.ts`:

```ts
export { GoogleApiError, OAuthExpiredError, TransientError } from "./errors";
export { fetchAccessToken } from "./access-token";
export type { FetchAccessTokenOptions, AccessTokenResult } from "./access-token";
export { listUpcomingEvents } from "./calendar-client";
export type {
  ListUpcomingEventsOptions,
  ListUpcomingEventsResult,
  RawGoogleEvent,
} from "./calendar-client";
```

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
pnpm --filter @gons/shared-google test
```

Expected: 모든 테스트 PASS (Task 5의 5개 + Task 6의 5개 = 10).

- [ ] **Step 6: 커밋**

```bash
git add packages/shared-google/src
git commit -m "$(cat <<'EOF'
feat(shared-google): listUpcomingEvents — Calendar API thin wrap (TDD)

singleEvents=true(반복 펼침)+orderBy=startTime(정렬 보장) 강제, 401/5xx/
네트워크는 OAuthExpiredError/TransientError로 분류. raw 응답을 그대로
반환 — 정규화는 도메인 패키지 책임.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: packages/shared-mcp-runtime 초기 골격 + define-tool (TDD)

**Files:**
- Create: `packages/shared-mcp-runtime/package.json`
- Create: `packages/shared-mcp-runtime/tsconfig.json`
- Create: `packages/shared-mcp-runtime/vitest.config.ts`
- Create: `packages/shared-mcp-runtime/src/index.ts`
- Create: `packages/shared-mcp-runtime/src/define-tool.test.ts`
- Create: `packages/shared-mcp-runtime/src/define-tool.ts`

- [ ] **Step 1: 패키지 골격 작성**

Create `packages/shared-mcp-runtime/package.json`:

```json
{
  "name": "@gons/shared-mcp-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./stdio-server": "./src/stdio-server.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "eslint": "^9",
    "typescript": "^5",
    "vitest": "^4.1.5"
  }
}
```

Create `packages/shared-mcp-runtime/tsconfig.json` (same as shared-google: `extends: ../../tsconfig.base.json`, `rootDir: ./src`, `include: src/**/*`).

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

Create `packages/shared-mcp-runtime/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `packages/shared-mcp-runtime/src/define-tool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./define-tool";

describe("defineTool", () => {
  it("returns a tool object with name, description, schema, handler", () => {
    const tool = defineTool({
      name: "calendar.getUpcomingEvents",
      description: "List upcoming events",
      input: z.object({ withinHours: z.number() }),
      output: z.object({ count: z.number() }),
      handler: async ({ withinHours }) => ({ count: withinHours }),
    });
    expect(tool.name).toBe("calendar.getUpcomingEvents");
    expect(tool.description).toBe("List upcoming events");
    expect(typeof tool.handler).toBe("function");
    expect(tool.input).toBeDefined();
    expect(tool.output).toBeDefined();
  });

  it("handler validates input via Zod", async () => {
    const tool = defineTool({
      name: "echo",
      description: "echo",
      input: z.object({ msg: z.string() }),
      output: z.object({ msg: z.string() }),
      handler: async (input) => input,
    });
    await expect(tool.handler({ msg: 123 } as never)).rejects.toThrow();
  });

  it("handler validates output via Zod", async () => {
    const tool = defineTool({
      name: "broken",
      description: "broken",
      input: z.object({}),
      output: z.object({ count: z.number() }),
      handler: async () => ({ count: "not a number" }) as never,
    });
    await expect(tool.handler({})).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run:
```bash
pnpm install
pnpm --filter @gons/shared-mcp-runtime test
```

Expected: FAIL (defineTool 미정의).

- [ ] **Step 4: 구현 작성**

Create `packages/shared-mcp-runtime/src/define-tool.ts`:

```ts
import type { z } from "zod";

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handler: (input: I) => Promise<O>;
}

export interface DefineToolOptions<I, O> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handler: (input: I) => Promise<O>;
}

export function defineTool<I, O>(
  opts: DefineToolOptions<I, O>,
): ToolDefinition<I, O> {
  const handler = async (rawInput: I): Promise<O> => {
    const inputParsed = opts.input.safeParse(rawInput);
    if (!inputParsed.success) {
      throw new Error(`Invalid input for tool ${opts.name}: ${inputParsed.error.message}`);
    }
    const result = await opts.handler(inputParsed.data);
    const outputParsed = opts.output.safeParse(result);
    if (!outputParsed.success) {
      throw new Error(`Invalid output from tool ${opts.name}: ${outputParsed.error.message}`);
    }
    return outputParsed.data;
  };
  return {
    name: opts.name,
    description: opts.description,
    input: opts.input,
    output: opts.output,
    handler,
  };
}
```

- [ ] **Step 5: index.ts에서 re-export**

Create `packages/shared-mcp-runtime/src/index.ts`:

```ts
export { defineTool } from "./define-tool";
export type { ToolDefinition, DefineToolOptions } from "./define-tool";
```

- [ ] **Step 6: 테스트 통과 확인**

Run:
```bash
pnpm --filter @gons/shared-mcp-runtime test
```

Expected: 3/3 PASS.

- [ ] **Step 7: 커밋**

```bash
git add packages/shared-mcp-runtime pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(shared-mcp-runtime): defineTool — Zod 입출력 검증 헬퍼 (TDD)

도구 정의 객체(name, description, input/output schema, handler)와 입출력
양쪽을 Zod로 자동 검증하는 wrapper handler 생성. 입력 또는 출력 형식이
스키마와 어긋나면 throw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: shared-mcp-runtime — stdio-server (no test, smoke만)

**Files:**
- Create: `packages/shared-mcp-runtime/src/stdio-server.ts`

`@modelcontextprotocol/sdk`를 wrap해 ToolDefinition 배열을 stdio MCP server로 띄우는 헬퍼. 이 부분은 SDK 의존성 wrap이라 unit test보다 mcp-calendar 패키지의 cli.test에서 통합으로 검증.

- [ ] **Step 1: 구현 작성**

Create `packages/shared-mcp-runtime/src/stdio-server.ts`:

```ts
// stdio MCP server bootstrap — Claude Code가 자식 프로세스로 spawn하는 진입점.
//
// 입력: ToolDefinition 배열. 출력: stdio MCP 프로토콜로 listen하는 서버 인스턴스.
// 이 모듈은 server-only — SDK가 stdin/stdout을 점유하므로 import 자체에 부수 효과는 없음.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "./zod-to-json-schema";
import type { ToolDefinition } from "./define-tool";

export interface StdioServerOptions {
  name: string;
  version: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Array<ToolDefinition<any, any>>;
}

export async function runStdioServer(opts: StdioServerOptions): Promise<void> {
  const server = new Server(
    { name: opts.name, version: opts.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.input),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = opts.tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const result = await tool.handler(request.params.arguments ?? {});
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 2: zod-to-json-schema 헬퍼 작성**

Create `packages/shared-mcp-runtime/src/zod-to-json-schema.ts`:

```ts
// Minimal Zod → JSON Schema 변환. zod-to-json-schema npm 패키지를 끌어오지 않고
// MCP가 요구하는 최소 형태만 제공한다.
//
// 지원: ZodObject 1단계 (string, number, integer, boolean, optional, default).
// 더 복잡한 스키마(중첩, union, array)가 필요해지면 zod-to-json-schema 패키지로 교체.
import { z } from "zod";

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error("zodToJsonSchema currently supports only ZodObject at top level");
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const unwrapped = unwrap(field);
    properties[key] = primitiveSchema(unwrapped);
    if (!isOptionalOrDefault(field)) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  if (field instanceof z.ZodOptional) return unwrap(field._def.innerType);
  if (field instanceof z.ZodDefault) return unwrap(field._def.innerType);
  return field;
}

function isOptionalOrDefault(field: z.ZodTypeAny): boolean {
  return field instanceof z.ZodOptional || field instanceof z.ZodDefault;
}

function primitiveSchema(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodString) return { type: "string" };
  if (field instanceof z.ZodNumber) {
    return field._def.checks?.some((c: { kind?: string }) => c.kind === "int")
      ? { type: "integer" }
      : { type: "number" };
  }
  if (field instanceof z.ZodBoolean) return { type: "boolean" };
  return { type: "string" }; // 알 수 없는 타입은 일단 string으로 — MCP 서버 자체는 입력 시점에 다시 Zod로 검증하므로 안전망 있음.
}
```

- [ ] **Step 3: index.ts re-export**

Update `packages/shared-mcp-runtime/src/index.ts`:

```ts
export { defineTool } from "./define-tool";
export type { ToolDefinition, DefineToolOptions } from "./define-tool";
export { runStdioServer } from "./stdio-server";
export type { StdioServerOptions } from "./stdio-server";
```

- [ ] **Step 4: typecheck 통과**

Run:
```bash
pnpm --filter @gons/shared-mcp-runtime typecheck
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/shared-mcp-runtime/src
git commit -m "$(cat <<'EOF'
feat(shared-mcp-runtime): runStdioServer — MCP SDK stdio bootstrap

ToolDefinition 배열을 받아 MCP stdio 프로토콜로 listen. listTools는
zodToJsonSchema로 입력 스키마 노출, callTool은 ToolDefinition.handler에
위임 (Zod 검증은 handler 내부에서).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: packages/mcp-calendar 골격 + Event 스키마

**Files:**
- Create: `packages/mcp-calendar/package.json`
- Create: `packages/mcp-calendar/tsconfig.json`
- Create: `packages/mcp-calendar/vitest.config.ts`
- Create: `packages/mcp-calendar/tsup.config.ts`
- Create: `packages/mcp-calendar/src/domain/event.ts`
- Create: `packages/mcp-calendar/src/index.ts`

- [ ] **Step 1: package.json**

Create `packages/mcp-calendar/package.json`:

```json
{
  "name": "@gons/mcp-calendar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "bin": {
    "gons-mcp-calendar": "./dist/cli.js"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src",
    "build": "tsup"
  },
  "dependencies": {
    "@gons/shared-google": "workspace:*",
    "@gons/shared-mcp-runtime": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "eslint": "^9",
    "tsup": "^8.3.5",
    "typescript": "^5",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: tsconfig + vitest 설정**

Create `packages/mcp-calendar/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

Create `packages/mcp-calendar/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Create `packages/mcp-calendar/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  splitting: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@gons/shared-google", "@gons/shared-mcp-runtime"],
});
```

(workspace 패키지를 번들에 포함 — 사용자 머신에서 별도 install 없이 dist/cli.js 단독 실행 가능.)

- [ ] **Step 3: Event 스키마**

Create `packages/mcp-calendar/src/domain/event.ts`:

```ts
import { z } from "zod";

// CalendarEvent — mcp-calendar 도메인의 표준 이벤트 모양.
// 위젯, Claude, 향후 다른 클라이언트가 모두 이 모양을 받는다.
//
// 정책:
// - 시각은 항상 ISO 8601 UTC. 로컬 변환은 소비자(위젯) 책임 (spec Gotcha #3).
// - 반복 일정은 shared-google이 singleEvents=true로 펼친 인스턴스가 들어옴.
// - meetingUrl은 hangoutLink 우선, 없으면 description에서 Zoom/Meet URL 추출.
export const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  attendees: z.array(
    z.object({
      email: z.string(),
      responseStatus: z
        .enum(["accepted", "declined", "tentative", "needsAction"])
        .nullable(),
    }),
  ),
  meetingUrl: z.string().url().nullable(),
  htmlLink: z.string().url(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
```

- [ ] **Step 4: 빈 barrel + typecheck**

Create `packages/mcp-calendar/src/index.ts`:

```ts
export { CalendarEventSchema } from "./domain/event";
export type { CalendarEvent } from "./domain/event";
```

Add `tsup` dep at root:

Run:
```bash
pnpm install
pnpm --filter @gons/mcp-calendar typecheck
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/mcp-calendar pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(mcp-calendar): 패키지 골격 + CalendarEvent Zod 스키마

bin: gons-mcp-calendar, tsup로 CLI 번들링 (shared 패키지 inline). 시각은
항상 UTC ISO, meetingUrl은 hangoutLink + 본문 추출 정책. 다음 커밋부터
normalize + tool 채움.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: mcp-calendar — normalize-event (TDD)

**Files:**
- Create: `packages/mcp-calendar/src/domain/normalize-event.ts`
- Create: `packages/mcp-calendar/src/domain/normalize-event.test.ts`

Google raw event → CalendarEvent 변환.

- [ ] **Step 1: 테스트 작성**

Create `packages/mcp-calendar/src/domain/normalize-event.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeEvent } from "./normalize-event";

describe("normalizeEvent", () => {
  it("normalizes a dateTime event", () => {
    const raw = {
      id: "evt-1",
      summary: "디자인 리뷰",
      start: { dateTime: "2026-05-12T05:00:00Z" },
      end: { dateTime: "2026-05-12T06:00:00Z" },
      location: "Meeting Room A",
      htmlLink: "https://calendar.google.com/calendar/event?eid=abc",
      attendees: [
        { email: "alice@example.com", responseStatus: "accepted" },
        { email: "bob@example.com" },
      ],
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    };
    const ev = normalizeEvent(raw);
    expect(ev.id).toBe("evt-1");
    expect(ev.title).toBe("디자인 리뷰");
    expect(ev.startAt).toBe("2026-05-12T05:00:00.000Z");
    expect(ev.endAt).toBe("2026-05-12T06:00:00.000Z");
    expect(ev.allDay).toBe(false);
    expect(ev.location).toBe("Meeting Room A");
    expect(ev.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(ev.attendees).toEqual([
      { email: "alice@example.com", responseStatus: "accepted" },
      { email: "bob@example.com", responseStatus: null },
    ]);
    expect(ev.htmlLink).toBe("https://calendar.google.com/calendar/event?eid=abc");
  });

  it("marks allDay events with date-only start", () => {
    const raw = {
      id: "evt-2",
      summary: "휴가",
      start: { date: "2026-05-13" },
      end: { date: "2026-05-14" },
      htmlLink: "https://calendar.google.com/calendar/event?eid=xyz",
    };
    const ev = normalizeEvent(raw);
    expect(ev.allDay).toBe(true);
    expect(ev.startAt).toBe("2026-05-13T00:00:00.000Z");
    expect(ev.endAt).toBe("2026-05-14T00:00:00.000Z");
  });

  it("uses '(제목 없음)' when summary is missing", () => {
    const raw = {
      id: "evt-3",
      start: { dateTime: "2026-05-12T05:00:00Z" },
      end: { dateTime: "2026-05-12T06:00:00Z" },
      htmlLink: "https://calendar.google.com/?x",
    };
    const ev = normalizeEvent(raw);
    expect(ev.title).toBe("(제목 없음)");
  });

  it("returns null for missing location/meetingUrl/attendees", () => {
    const raw = {
      id: "evt-4",
      summary: "혼자 작업",
      start: { dateTime: "2026-05-12T05:00:00Z" },
      end: { dateTime: "2026-05-12T06:00:00Z" },
      htmlLink: "https://calendar.google.com/?y",
    };
    const ev = normalizeEvent(raw);
    expect(ev.location).toBeNull();
    expect(ev.meetingUrl).toBeNull();
    expect(ev.attendees).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run:
```bash
pnpm --filter @gons/mcp-calendar test
```

Expected: FAIL — normalize-event 미정의.

- [ ] **Step 3: 구현 작성**

Create `packages/mcp-calendar/src/domain/normalize-event.ts`:

```ts
import type { RawGoogleEvent } from "@gons/shared-google";
import type { CalendarEvent } from "./event";

const ATTENDEE_STATUSES = new Set([
  "accepted",
  "declined",
  "tentative",
  "needsAction",
] as const);

export function normalizeEvent(raw: RawGoogleEvent): CalendarEvent {
  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  const startAt = toIsoUtc(raw.start?.dateTime ?? raw.start?.date);
  const endAt = toIsoUtc(raw.end?.dateTime ?? raw.end?.date);

  return {
    id: raw.id,
    title: raw.summary?.trim() || "(제목 없음)",
    startAt,
    endAt,
    allDay,
    location: raw.location ?? null,
    attendees:
      raw.attendees?.map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus && (ATTENDEE_STATUSES as Set<string>).has(a.responseStatus)
          ? (a.responseStatus as CalendarEvent["attendees"][number]["responseStatus"])
          : null,
      })) ?? [],
    meetingUrl: raw.hangoutLink ?? null,
    htmlLink: raw.htmlLink ?? "",
  };
}

function toIsoUtc(value: string | undefined): string {
  if (!value) {
    // Google API가 dateTime/date 둘 다 빠뜨리는 케이스는 사실상 없음. 안전망 — epoch.
    return "1970-01-01T00:00:00.000Z";
  }
  // date-only ("2026-05-13") 또는 dateTime ("2026-05-12T05:00:00Z") 둘 다 Date 가 파싱.
  return new Date(value).toISOString();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
pnpm --filter @gons/mcp-calendar test
```

Expected: 4/4 PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/mcp-calendar/src
git commit -m "$(cat <<'EOF'
feat(mcp-calendar): normalizeEvent — Google raw → CalendarEvent (TDD)

dateTime/date 모두 ISO UTC로 통일, allDay 감지, 비어 있는 summary는
"(제목 없음)"으로 폴백, attendees responseStatus 허용 값만 통과.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: mcp-calendar — getUpcomingEvents tool (TDD)

**Files:**
- Create: `packages/mcp-calendar/src/tools/get-upcoming-events.test.ts`
- Create: `packages/mcp-calendar/src/tools/get-upcoming-events.ts`
- Modify: `packages/mcp-calendar/src/index.ts`

`listUpcomingEvents`와 `fetchAccessToken`을 합쳐서 단일 tool 함수로 합성. 호출자는 token 발급 방식을 주입(in-process vs stdio).

- [ ] **Step 1: 테스트 작성**

Create `packages/mcp-calendar/src/tools/get-upcoming-events.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeGetUpcomingEventsTool } from "./get-upcoming-events";

describe("getUpcomingEvents tool", () => {
  const baseEvent = {
    id: "e1",
    summary: "Test",
    start: { dateTime: "2026-05-12T05:00:00Z" },
    end: { dateTime: "2026-05-12T06:00:00Z" },
    htmlLink: "https://calendar.google.com/?x",
  };

  it("composes accessToken + calendar API, returns CalendarEvent[]", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("ya29.test");
    const listFn = vi.fn().mockResolvedValue({ items: [baseEvent] });
    const tool = makeGetUpcomingEventsTool({
      getAccessToken,
      listFn,
      now: () => new Date("2026-05-12T00:00:00Z"),
    });
    const result = await tool.handler({ withinHours: 24, limit: 5, calendarId: "primary" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe("e1");
    expect(result.events[0].title).toBe("Test");
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(listFn).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "ya29.test",
        calendarId: "primary",
        maxResults: 5,
      }),
    );
  });

  it("uses now + withinHours for timeMin/timeMax", async () => {
    const listFn = vi.fn().mockResolvedValue({ items: [] });
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn,
      now: () => new Date("2026-05-12T00:00:00Z"),
    });
    await tool.handler({ withinHours: 24, limit: 10, calendarId: "primary" });
    const call = listFn.mock.calls[0][0];
    expect(call.timeMin).toBe("2026-05-12T00:00:00.000Z");
    expect(call.timeMax).toBe("2026-05-13T00:00:00.000Z");
  });

  it("applies defaults (withinHours=24, limit=10, calendarId='primary')", async () => {
    const listFn = vi.fn().mockResolvedValue({ items: [] });
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn,
      now: () => new Date("2026-05-12T00:00:00Z"),
    });
    await tool.handler({} as never);
    const call = listFn.mock.calls[0][0];
    expect(call.maxResults).toBe(10);
    expect(call.calendarId).toBe("primary");
  });

  it("returns fetchedAt as ISO from now()", async () => {
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn: async () => ({ items: [] }),
      now: () => new Date("2026-05-12T07:30:00Z"),
    });
    const result = await tool.handler({ withinHours: 24, limit: 10, calendarId: "primary" });
    expect(result.fetchedAt).toBe("2026-05-12T07:30:00.000Z");
  });

  it("rejects withinHours > 168 (Zod)", async () => {
    const tool = makeGetUpcomingEventsTool({
      getAccessToken: async () => "ya29",
      listFn: async () => ({ items: [] }),
      now: () => new Date(),
    });
    await expect(
      tool.handler({ withinHours: 200, limit: 10, calendarId: "primary" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run:
```bash
pnpm --filter @gons/mcp-calendar test
```

Expected: FAIL — `makeGetUpcomingEventsTool` 미정의.

- [ ] **Step 3: 구현 작성**

Create `packages/mcp-calendar/src/tools/get-upcoming-events.ts`:

```ts
import { z } from "zod";
import { defineTool } from "@gons/shared-mcp-runtime";
import type {
  ListUpcomingEventsOptions,
  ListUpcomingEventsResult,
} from "@gons/shared-google";
import { CalendarEventSchema } from "../domain/event";
import { normalizeEvent } from "../domain/normalize-event";

const InputSchema = z.object({
  withinHours: z.number().int().min(1).max(168).default(24),
  limit: z.number().int().min(1).max(50).default(10),
  calendarId: z.string().default("primary"),
});

const OutputSchema = z.object({
  events: z.array(CalendarEventSchema),
  fetchedAt: z.string().datetime(),
});

export interface MakeGetUpcomingEventsToolDeps {
  /** mediator에서 access token을 받아오는 함수. in-process vs stdio가 주입. */
  getAccessToken: () => Promise<string>;
  /** Google Calendar API 호출. 보통 shared-google의 listUpcomingEvents 그대로. */
  listFn: (opts: ListUpcomingEventsOptions) => Promise<ListUpcomingEventsResult>;
  /** Clock injection — 테스트 편의. 기본은 () => new Date(). */
  now?: () => Date;
}

export function makeGetUpcomingEventsTool(deps: MakeGetUpcomingEventsToolDeps) {
  const now = deps.now ?? (() => new Date());
  return defineTool({
    name: "calendar.getUpcomingEvents",
    description:
      "다음 N시간(기본 24h)의 Google Calendar 일정을 시작 시각 오름차순으로 반환합니다. 반복 일정은 인스턴스로 펼쳐집니다.",
    input: InputSchema,
    output: OutputSchema,
    handler: async (input) => {
      const accessToken = await deps.getAccessToken();
      const nowMs = now().getTime();
      const timeMin = new Date(nowMs).toISOString();
      const timeMax = new Date(nowMs + input.withinHours * 60 * 60 * 1000).toISOString();
      const result = await deps.listFn({
        accessToken,
        calendarId: input.calendarId,
        timeMin,
        timeMax,
        maxResults: input.limit,
      });
      return {
        events: result.items.map(normalizeEvent),
        fetchedAt: new Date(nowMs).toISOString(),
      };
    },
  });
}

export type GetUpcomingEventsTool = ReturnType<typeof makeGetUpcomingEventsTool>;
```

- [ ] **Step 4: index.ts 갱신**

Update `packages/mcp-calendar/src/index.ts`:

```ts
export { CalendarEventSchema } from "./domain/event";
export type { CalendarEvent } from "./domain/event";
export { normalizeEvent } from "./domain/normalize-event";
export { makeGetUpcomingEventsTool } from "./tools/get-upcoming-events";
export type {
  MakeGetUpcomingEventsToolDeps,
  GetUpcomingEventsTool,
} from "./tools/get-upcoming-events";
```

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
pnpm --filter @gons/mcp-calendar test
```

Expected: 4 + 5 = 9 PASS (normalize-event 4 + get-upcoming-events 5).

- [ ] **Step 6: 커밋**

```bash
git add packages/mcp-calendar/src
git commit -m "$(cat <<'EOF'
feat(mcp-calendar): getUpcomingEvents tool (TDD)

accessToken fetcher + Calendar API 호출 + normalize 합성. Zod 입력 검증
(withinHours 1-168, limit 1-50), 출력은 startAt 정렬된 CalendarEvent[]
+ fetchedAt. 의존성 모두 주입(in-process/stdio 양쪽에서 재사용).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: mcp-calendar — cli.ts (stdio 진입점)

**Files:**
- Create: `packages/mcp-calendar/src/cli.ts`

Claude Code가 spawn할 진입점. 환경변수 검증 → tool 생성 → stdio server 실행.

- [ ] **Step 1: 구현 작성**

Create `packages/mcp-calendar/src/cli.ts`:

```ts
// gons-mcp-calendar — Claude Code stdio 진입점.
//
// 환경변수:
//   MCP_DASHBOARD_URL — 예: https://gons.krdn.kr
//   MCP_DASHBOARD_TOKEN — apps/dashboard와 사전 공유된 bearer
//
// 흐름: env 검증 → token fetcher 합성 → getUpcomingEvents tool 정의 → stdio listen.
import { fetchAccessToken, listUpcomingEvents } from "@gons/shared-google";
import { runStdioServer } from "@gons/shared-mcp-runtime";
import { makeGetUpcomingEventsTool } from "./tools/get-upcoming-events";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(`[gons-mcp-calendar] missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const dashboardUrl = requireEnv("MCP_DASHBOARD_URL").replace(/\/$/, "");
  const bearer = requireEnv("MCP_DASHBOARD_TOKEN");
  const mediatorUrl = `${dashboardUrl}/api/mcp/credentials/google`;

  const getAccessToken = async () => {
    const { accessToken } = await fetchAccessToken({ mediatorUrl, bearer });
    return accessToken;
  };

  const getUpcoming = makeGetUpcomingEventsTool({
    getAccessToken,
    listFn: listUpcomingEvents,
  });

  await runStdioServer({
    name: "gons-mcp-calendar",
    version: "0.1.0",
    tools: [getUpcoming],
  });
}

main().catch((err) => {
  console.error("[gons-mcp-calendar] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: tsup build 검증**

Run:
```bash
pnpm --filter @gons/mcp-calendar build
ls packages/mcp-calendar/dist/
```

Expected: `cli.js` 생성, 첫 줄에 `#!/usr/bin/env node` shebang.

- [ ] **Step 3: smoke 실행 (env 누락 시 명시 종료 확인)**

Run:
```bash
node packages/mcp-calendar/dist/cli.js
```

Expected: stderr에 `missing env: MCP_DASHBOARD_URL`, exit 1.

- [ ] **Step 4: 커밋**

```bash
git add packages/mcp-calendar/src/cli.ts
git commit -m "$(cat <<'EOF'
feat(mcp-calendar): cli.ts — stdio 진입점

MCP_DASHBOARD_URL + MCP_DASHBOARD_TOKEN 검증 후 mediator 기반
token fetcher 합성 → getUpcomingEvents tool → stdio listen. tsup으로
shared-* 패키지를 inline 번들링.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: 대시보드 — /api/mcp/credentials/google mediator (TDD)

**Files:**
- Create: `apps/dashboard/tests/integration/mcp-credentials.test.ts`
- Create: `apps/dashboard/src/app/api/mcp/credentials/google/route.ts`

기존 Gmail 패턴(`src/shared/api/gmail/auth.ts`)을 재사용 — `getValidAccessToken(userId)`이 이미 refresh + expires 갱신 + InvalidGrantError throw까지 처리.

- [ ] **Step 1: 통합 테스트 작성 (먼저 라우트가 없으니 404 확인)**

Create `apps/dashboard/tests/integration/mcp-credentials.test.ts`:

```ts
// /api/mcp/credentials/google 라우트 통합 테스트.
//
// 검증:
//   - bearer 누락/오답 → 401
//   - 정상 bearer + Drizzle stub user → 200, accessToken + expiresAt
//   - refresh 만료(InvalidGrantError) → 410
//   - 응답 헤더에 Cache-Control: no-store
//
// DB 통합이라 TEST_DATABASE_URL 필요 (tests/setup.ts allow-list 가드).
//
// getValidAccessToken을 vi.mock으로 stub해 외부 Google 호출은 차단.
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/shared/api/gmail/auth", () => ({
  getValidAccessToken: vi.fn(),
}));

import { GET } from "@/app/api/mcp/credentials/google/route";
import { getValidAccessToken } from "@/shared/api/gmail/auth";
import { InvalidGrantError } from "@/shared/api/gmail/errors";

const mockedGet = vi.mocked(getValidAccessToken);

function makeReq(bearer: string | null): Request {
  const headers = new Headers();
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://gons.krdn.kr/api/mcp/credentials/google", {
    headers,
  });
}

describe("/api/mcp/credentials/google", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    process.env.MCP_DASHBOARD_TOKEN = "test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.ADMIN_EMAILS = "krdn.net@gmail.com";
  });

  it("returns 401 when bearer missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer wrong", async () => {
    const res = await GET(makeReq("wrong"));
    expect(res.status).toBe(401);
  });

  it("returns 410 when refresh token expired", async () => {
    mockedGet.mockRejectedValue(new InvalidGrantError());
    const res = await GET(makeReq("test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(res.status).toBe(410);
  });

  it("returns 200 + accessToken + Cache-Control: no-store", async () => {
    mockedGet.mockResolvedValue({
      accessToken: "ya29.test",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    const res = await GET(makeReq("test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.accessToken).toBe("ya29.test");
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns 503 on transient error from getValidAccessToken", async () => {
    mockedGet.mockRejectedValue(new Error("ECONNRESET"));
    const res = await GET(makeReq("test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run:
```bash
cd /home/gon/projects/gon/gons-dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test apps/dashboard/tests/integration/mcp-credentials.test.ts
```

Expected: FAIL — 라우트 미존재.

- [ ] **Step 3: 라우트 구현**

Create `apps/dashboard/src/app/api/mcp/credentials/google/route.ts`:

```ts
// /api/mcp/credentials/google — MCP 패키지 mediator.
//
// 정책:
//   - Bearer 인증 (env.MCP_DASHBOARD_TOKEN). v1은 정적, v2에 HMAC TTL로 전환.
//   - userEmail 미지정 시 ADMIN_EMAILS[0] 사용 (단일 사용자 환경).
//   - 응답에 Cache-Control: no-store 강제.
//   - InvalidGrantError → 410 Gone (호출자가 사용자 재로그인 트리거).
//   - 기타 에러 → 503 (호출자가 backoff 재시도).
import "server-only";
import { eq } from "drizzle-orm";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { getValidAccessToken } from "@/shared/api/gmail/auth";
import { InvalidGrantError } from "@/shared/api/gmail/errors";

export const dynamic = "force-dynamic";

function unauthorized() {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/);
  if (!match || match[1] !== env.MCP_DASHBOARD_TOKEN) {
    return unauthorized();
  }

  // v1 — 단일 사용자. ADMIN_EMAILS의 첫 이메일을 그대로 사용.
  const adminEmail = env.ADMIN_EMAILS.split(",")[0]?.trim().toLowerCase();
  if (!adminEmail) {
    return new Response("ADMIN_EMAILS 미설정", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);
  if (row.length === 0) {
    return new Response("User not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const { accessToken, expiresAt } = await getValidAccessToken(row[0].id);
    return Response.json(
      {
        accessToken,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      return new Response("OAuth refresh expired", {
        status: 410,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new Response("Transient error", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
```

**메모**: 기존 `getValidAccessToken`은 Gmail용 헬퍼이지만 Google account의 refresh token은 scope에 관계없이 access token으로 교환할 때 동일. Gmail/Calendar scope가 동일 OAuth client에 grant되어 있으므로 같은 함수가 둘 다 발급. 이 점은 spec §8과 정합.

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test apps/dashboard/tests/integration/mcp-credentials.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/app/api/mcp/credentials apps/dashboard/tests/integration/mcp-credentials.test.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/mcp/credentials/google mediator 라우트 (TDD)

Bearer (MCP_DASHBOARD_TOKEN) 인증 → ADMIN_EMAILS[0] user 조회 →
getValidAccessToken 위임 → 5분 access token. 401/410/503/200 + 항상
Cache-Control: no-store. InvalidGrantError를 410으로 매핑해 MCP 측이
사용자 재로그인 트리거 가능.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: 대시보드 — Calendar 위젯 슬라이스 (TDD)

**Files:**
- Create: `apps/dashboard/src/widgets/calendar/index.ts`
- Create: `apps/dashboard/src/widgets/calendar/ui/CalendarCard.tsx`
- Create: `apps/dashboard/src/widgets/calendar/ui/CalendarSkeleton.tsx`
- Create: `apps/dashboard/src/widgets/calendar/ui/format.ts`
- Create: `apps/dashboard/src/widgets/calendar/lib/groupByDay.ts`
- Create: `apps/dashboard/src/widgets/calendar/lib/groupByDay.test.ts`
- Create: `apps/dashboard/src/widgets/calendar/ui/CalendarCard.test.tsx`

FSD widgets 슬라이스 규약을 따른다. lib는 pure 함수, ui는 server component.

- [ ] **Step 1: format.ts (locale-free HH:MM)**

Create `apps/dashboard/src/widgets/calendar/ui/format.ts`:

```ts
// KST 기준 HH:MM 포맷 — locale 의존 없이 결정적으로 (Gotcha #3).
// Date 객체를 받아 +09:00 시각을 직접 계산 (Intl 없이).
const KST_OFFSET_MIN = 9 * 60;

export function formatHHMM(iso: string): string {
  const date = new Date(iso);
  const utcMin = date.getTime() / 1000 / 60;
  const kstMin = Math.floor(utcMin) + KST_OFFSET_MIN;
  const totalMinInDay = ((kstMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(totalMinInDay / 60);
  const m = totalMinInDay % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
```

- [ ] **Step 2: groupByDay 테스트 작성**

Create `apps/dashboard/src/widgets/calendar/lib/groupByDay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupByDay } from "./groupByDay";
import type { CalendarEvent } from "@gons/mcp-calendar";

function event(id: string, startUtc: string): CalendarEvent {
  return {
    id,
    title: `evt-${id}`,
    startAt: startUtc,
    endAt: startUtc,
    allDay: false,
    location: null,
    attendees: [],
    meetingUrl: null,
    htmlLink: "https://calendar.google.com/?x",
  };
}

describe("groupByDay", () => {
  const nowKstMidnight = new Date("2026-05-12T15:00:00Z"); // 2026-05-13 00:00 KST 직전 — 12일 23시 후반

  it("buckets events into today and tomorrow based on KST date", () => {
    const events: CalendarEvent[] = [
      event("a", "2026-05-12T05:00:00Z"), // KST 14:00 today
      event("b", "2026-05-12T20:00:00Z"), // KST 05:00 tomorrow (5/13)
    ];
    const result = groupByDay(events, nowKstMidnight);
    expect(result.today.map((e) => e.id)).toEqual(["a"]);
    expect(result.tomorrow.map((e) => e.id)).toEqual(["b"]);
  });

  it("returns empty buckets when no events", () => {
    const result = groupByDay([], nowKstMidnight);
    expect(result.today).toEqual([]);
    expect(result.tomorrow).toEqual([]);
  });

  it("places events beyond tomorrow into neither bucket", () => {
    const events: CalendarEvent[] = [event("far", "2026-05-15T00:00:00Z")];
    const result = groupByDay(events, nowKstMidnight);
    expect(result.today).toEqual([]);
    expect(result.tomorrow).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run:
```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test apps/dashboard/src/widgets/calendar/lib/groupByDay.test.ts
```

Expected: FAIL.

- [ ] **Step 4: groupByDay 구현**

Create `apps/dashboard/src/widgets/calendar/lib/groupByDay.ts`:

```ts
import type { CalendarEvent } from "@gons/mcp-calendar";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// KST 자정 기준으로 yyyy-mm-dd 추출.
function kstDateKey(iso: string): string {
  const utcMs = new Date(iso).getTime();
  const kst = new Date(utcMs + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = pad2(kst.getUTCMonth() + 1);
  const d = pad2(kst.getUTCDate());
  return `${y}-${m}-${d}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface DayGroups {
  today: CalendarEvent[];
  tomorrow: CalendarEvent[];
}

export function groupByDay(events: CalendarEvent[], now: Date): DayGroups {
  const todayKey = kstDateKey(now.toISOString());
  const tomorrowKey = kstDateKey(new Date(now.getTime() + DAY_MS).toISOString());
  const today: CalendarEvent[] = [];
  const tomorrow: CalendarEvent[] = [];
  for (const ev of events) {
    const key = kstDateKey(ev.startAt);
    if (key === todayKey) today.push(ev);
    else if (key === tomorrowKey) tomorrow.push(ev);
  }
  return { today, tomorrow };
}
```

- [ ] **Step 5: groupByDay 테스트 통과**

Run:
```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard test apps/dashboard/src/widgets/calendar/lib/groupByDay.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 6: CalendarSkeleton 작성**

Create `apps/dashboard/src/widgets/calendar/ui/CalendarSkeleton.tsx`:

```tsx
export function CalendarSkeleton() {
  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className="mb-4 text-base font-semibold text-[var(--color-text-muted)]"
      >
        Calendar
      </h2>
      <div className="flex flex-col gap-3">
        <div className="h-4 w-1/3 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-surface-2)]" />
      </div>
    </section>
  );
}
```

- [ ] **Step 7: CalendarCard (server component) 작성**

Create `apps/dashboard/src/widgets/calendar/ui/CalendarCard.tsx`:

```tsx
import "server-only";
import { env } from "@/shared/config/env";
import {
  makeGetUpcomingEventsTool,
  type CalendarEvent,
} from "@gons/mcp-calendar";
import {
  fetchAccessToken,
  listUpcomingEvents,
  OAuthExpiredError,
} from "@gons/shared-google";
import { groupByDay } from "../lib/groupByDay";
import { formatHHMM } from "./format";

// in-process로 mcp-calendar tool을 호출. 토큰은 같은 프로세스의 mediator
// 라우트를 fetch (https://localhost 자체호출은 피하고 절대 URL 사용).
async function fetchEventsForWidget(): Promise<
  { ok: true; events: CalendarEvent[] } | { ok: false; reason: "reauth" | "transient" }
> {
  const mediatorUrl = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/mcp/credentials/google`;
  const tool = makeGetUpcomingEventsTool({
    getAccessToken: async () => {
      const r = await fetchAccessToken({
        mediatorUrl,
        bearer: env.MCP_DASHBOARD_TOKEN,
      });
      return r.accessToken;
    },
    listFn: listUpcomingEvents,
  });
  try {
    const result = await tool.handler({
      withinHours: 48, // today + tomorrow 범위를 안전하게 커버
      limit: 20,
      calendarId: "primary",
    });
    return { ok: true, events: result.events };
  } catch (err) {
    if (err instanceof OAuthExpiredError) return { ok: false, reason: "reauth" };
    return { ok: false, reason: "transient" };
  }
}

export async function CalendarCard() {
  const result = await fetchEventsForWidget();

  if (!result.ok && result.reason === "reauth") {
    return <ReauthState />;
  }
  if (!result.ok && result.reason === "transient") {
    return <TransientState />;
  }

  const groups = groupByDay(result.events, new Date());
  const hasAny = groups.today.length + groups.tomorrow.length > 0;

  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className="mb-4 text-base font-semibold text-[var(--color-text-muted)]"
      >
        Calendar
      </h2>
      {hasAny ? (
        <div className="flex flex-col gap-5">
          {groups.today.length > 0 && (
            <DayGroup label="오늘" events={groups.today} now={new Date()} />
          )}
          {groups.tomorrow.length > 0 && (
            <DayGroup label="내일" events={groups.tomorrow} now={null} />
          )}
        </div>
      ) : (
        <EmptyState />
      )}
      <p className="mt-5 text-xs">
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-text-muted)] hover:underline"
        >
          Google 캘린더에서 열기 →
        </a>
      </p>
    </section>
  );
}

function DayGroup({
  label,
  events,
  now,
}: {
  label: string;
  events: CalendarEvent[];
  now: Date | null;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">
        {label}
      </h3>
      <ul className="flex flex-col gap-3">
        {events.map((ev) => (
          <EventRow key={ev.id} event={ev} now={now} />
        ))}
      </ul>
    </div>
  );
}

function EventRow({ event, now }: { event: CalendarEvent; now: Date | null }) {
  const start = formatHHMM(event.startAt);
  const end = formatHHMM(event.endAt);
  const inProgress =
    now !== null &&
    new Date(event.startAt).getTime() <= now.getTime() &&
    now.getTime() <= new Date(event.endAt).getTime();
  return (
    <li>
      <a
        href={event.htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border border-transparent px-2 py-1 hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
      >
        <div className="flex items-baseline gap-2 text-xs tabular-nums text-[var(--color-text-muted)]">
          <time dateTime={event.startAt}>{start}</time>
          <span aria-hidden>—</span>
          <time dateTime={event.endAt}>{end}</time>
          {inProgress && (
            <span
              aria-label="진행 중"
              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
            />
          )}
        </div>
        <div className="text-sm font-medium">{event.title}</div>
        {(event.meetingUrl || event.attendees.length > 0) && (
          <div className="text-xs text-[var(--color-text-subtle)]">
            {event.meetingUrl && <>Google Meet</>}
            {event.meetingUrl && event.attendees.length > 0 && <> · </>}
            {event.attendees.length > 0 && <>{event.attendees.length}명</>}
          </div>
        )}
      </a>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-text-muted)]">
        다음 24시간 동안 일정이 없습니다.
      </p>
      <blockquote className="text-xs italic text-[var(--color-text-subtle)]">
        ⌬ &quot;쉼 없는 일상은 일상이 아니라 중단이다.&quot; — 한병철
      </blockquote>
    </div>
  );
}

function ReauthState() {
  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className="mb-2 text-base font-semibold text-[var(--color-text-muted)]"
      >
        Calendar
      </h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        Google 캘린더 접근 권한이 만료되었어요.
      </p>
      <a
        href="/api/auth/signin/google"
        className="mt-3 inline-block text-xs text-[var(--color-accent)] hover:underline"
      >
        다시 로그인 →
      </a>
    </section>
  );
}

function TransientState() {
  return (
    <section
      aria-labelledby="calendar-heading"
      className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-5"
    >
      <h2
        id="calendar-heading"
        className="mb-2 text-base font-semibold text-[var(--color-text-muted)]"
      >
        Calendar
      </h2>
      <p className="text-sm text-[var(--color-text-subtle)]">
        잠시 캘린더를 불러오지 못했어요. 잠시 후 다시 시도됩니다.
      </p>
    </section>
  );
}
```

- [ ] **Step 8: barrel + Next.js transpilePackages 확인**

Create `apps/dashboard/src/widgets/calendar/index.ts`:

```ts
export { CalendarCard } from "./ui/CalendarCard";
export { CalendarSkeleton } from "./ui/CalendarSkeleton";
```

Update `apps/dashboard/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres"],
  transpilePackages: [
    "@gons/shared-google",
    "@gons/shared-mcp-runtime",
    "@gons/mcp-calendar",
  ],
};

export default nextConfig;
```

- [ ] **Step 9: typecheck**

Run:
```bash
pnpm --filter @gons/dashboard typecheck
```

Expected: PASS.

- [ ] **Step 10: 커밋**

```bash
git add apps/dashboard/src/widgets/calendar apps/dashboard/next.config.ts
git commit -m "$(cat <<'EOF'
feat(widgets): CalendarCard — Hybrid 패턴 첫 위젯

in-process로 @gons/mcp-calendar tool 호출 → 정상/빈/재인증/일시오류 4상태
렌더링. groupByDay로 today/tomorrow 분류, locale-free HH:MM 포맷
(Gotcha #3). next.config.ts에 transpilePackages로 workspace 패키지
지정.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: 대시보드 — page.tsx에 CalendarCard 삽입

**Files:**
- Modify: `apps/dashboard/src/app/page.tsx`

placeholder 자리 (`<aside aria-label="향후 위젯 자리">`) 안의 Calendar placeholder를 실제 `<CalendarCard />`로 교체.

- [ ] **Step 1: page.tsx 갱신**

In `apps/dashboard/src/app/page.tsx`:

Find:
```tsx
import {
  ServerOverviewCard,
  ServerOverviewSkeleton,
} from "@/widgets/server-overview";
```

Add line:
```tsx
import { CalendarCard, CalendarSkeleton } from "@/widgets/calendar";
```

Find the aside placeholder block:
```tsx
        <aside aria-label="향후 위젯 자리" className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-[var(--color-text-muted)]">
            곧 추가될 영역
          </h2>
          <div className="rounded-xl border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-5 py-5 text-[var(--color-text-subtle)]">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text-muted)]">
              Calendar
            </h3>
            <p className="m-0 text-xs">
              오늘의 미팅·내일까지 답해야 할 일정이 여기 표시됩니다.
            </p>
          </div>
```

Replace the Calendar placeholder div with a real Suspense-wrapped card. The final aside should look like:

```tsx
        <aside aria-label="우측 위젯" className="flex flex-col gap-4">
          <Suspense fallback={<CalendarSkeleton />}>
            <CalendarCard />
          </Suspense>
          <div className="rounded-xl border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-5 py-5 text-[var(--color-text-subtle)]">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text-muted)]">
              Tasks
            </h3>
            <p className="m-0 text-xs">마감이 임박한 할 일 TOP 3.</p>
          </div>
        </aside>
```

(Tasks placeholder는 그대로 두어 후속 plan 자리 표시.)

- [ ] **Step 2: typecheck + build (placeholder env)**

Run:
```bash
pnpm --filter @gons/dashboard typecheck
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
REDIS_URL=redis://localhost:6379 \
NEXTAUTH_SECRET=a-placeholder-secret-of-at-least-32-characters \
NEXTAUTH_URL=http://localhost:3020 \
GOOGLE_CLIENT_ID=placeholder \
GOOGLE_CLIENT_SECRET=placeholder \
ANTHROPIC_BASE_URL=http://placeholder \
ANTHROPIC_API_KEY=placeholder \
CRON_BEARER_TOKEN=a-placeholder-cron-token-of-at-least-32-characters \
MCP_DASHBOARD_TOKEN=a-placeholder-mcp-token-of-at-least-32-characters \
ALLOWLIST_EMAILS=build@placeholder.local \
ADMIN_EMAILS=build@placeholder.local \
pnpm --filter @gons/dashboard build
```

Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(page): 우측 사이드바에 CalendarCard 삽입

placeholder를 실제 위젯으로 교체. Tasks placeholder는 그대로 두어 후속
plan 자리 표시. Suspense + CalendarSkeleton.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: CI 워크플로 갱신 (env + workspace 빌드)

**Files:**
- Modify: `.github/workflows/ci.yml`

`MCP_DASHBOARD_TOKEN`을 placeholder env에 추가하고, 패키지 빌드를 명시.

- [ ] **Step 1: ci.yml에 MCP_DASHBOARD_TOKEN placeholder 추가**

Find all `env:` blocks in `.github/workflows/ci.yml` that set `DATABASE_URL`, `ALLOWLIST_EMAILS`, etc. Add to each one:

```yaml
          MCP_DASHBOARD_TOKEN: a-placeholder-mcp-token-of-at-least-32-characters
```

- [ ] **Step 2: 패키지 빌드 step 추가 (Docker 빌드 전)**

`pnpm test` step 직후, `pnpm build` step 직전에:

```yaml
      - name: Build MCP packages
        run: pnpm --filter @gons/mcp-calendar build
```

(workspace 빌드는 mcp-calendar의 `dist/cli.js`가 필요한 시점에만 — Docker 이미지는 dashboard만이라 CI sanity check로 충분.)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: MCP_DASHBOARD_TOKEN placeholder + mcp-calendar build step

env 검증을 통과시키기 위해 placeholder bearer 주입. mcp-calendar tsup
빌드가 동작하는지 CI에서 sanity check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: docs 갱신 — RUNBOOK, CLAUDE.md, TODOS.md

**Files:**
- Modify: `docs/RUNBOOK.md`
- Modify: `CLAUDE.md`
- Modify: `TODOS.md`

- [ ] **Step 1: RUNBOOK에 MCP 섹션 추가**

Append to `docs/RUNBOOK.md`:

```markdown
## MCP — Calendar 파일럿

### 토큰 회전 (MCP_DASHBOARD_TOKEN)

```bash
NEW_TOKEN=$(openssl rand -hex 32)
# 1. 운영 .env 갱신 (192.168.0.5의 compose .env)
ssh gon@192.168.0.5 "cd /home/gon/projects/gon/gons-dashboard && \
  sed -i 's/^MCP_DASHBOARD_TOKEN=.*/MCP_DASHBOARD_TOKEN='\"$NEW_TOKEN\"'/' .env && \
  docker --context home-server compose up -d app"

# 2. 사용자 머신의 Claude Code MCP 설정 갱신
#    ~/.config/claude/mcp.json 또는 사용자 설정 UI
```

### Calendar 위젯이 안 보일 때

- 401 (mediator bearer 불일치): app 컨테이너 .env의 MCP_DASHBOARD_TOKEN 확인
- 410 (refresh 만료): 사용자 https://gons.krdn.kr 로그아웃 → 재로그인 (calendar.readonly scope 동의)
- 503 (Google API 일시 오류): 페이지 새로고침 — 자연 복구

### 사용자 머신의 Claude Code 등록

```json
{
  "mcpServers": {
    "gons-calendar": {
      "command": "node",
      "args": ["/home/gon/projects/gon/gons-dashboard/packages/mcp-calendar/dist/cli.js"],
      "env": {
        "MCP_DASHBOARD_URL": "https://gons.krdn.kr",
        "MCP_DASHBOARD_TOKEN": "<위 .env와 동일한 값>"
      }
    }
  }
}
```

빌드는 `pnpm --filter @gons/mcp-calendar build` — Claude Code 재시작 후 `gons-calendar` 도구 사용 가능.
```

- [ ] **Step 2: CLAUDE.md에 MCP 정책 섹션 추가**

In `CLAUDE.md`, after "## AI 호출 정책" section, add:

```markdown
## MCP 도구 호출 정책

`packages/mcp-*` 의 도구 함수는 두 경로로 호출된다:

1. **In-process (대시보드 RSC)**: 위젯이 `import { makeXxxTool } from "@gons/mcp-xxx"` → 토큰은 같은 프로세스의 mediator 라우트(`/api/mcp/credentials/*`)에서 받아옴 (절대 URL — `NEXTAUTH_URL` 베이스).
2. **Stdio (Claude Code)**: `packages/mcp-*/dist/cli.js`가 자식 프로세스로 spawn → `MCP_DASHBOARD_URL` 환경변수로 mediator HTTPS 호출.

OAuth refresh token은 `apps/dashboard`의 `accounts` 테이블에만 존재 (pgcrypto). MCP 패키지는 절대 refresh token을 보지 못한다 — mediator가 발급하는 5분 access token만 사용.

신규 도메인 MCP 추가 시: `packages/mcp-<domain>` + `packages/shared-<provider>` (이미 있으면 재사용) + dashboard에 `/api/mcp/credentials/<provider>` mediator. spec 패턴 — `docs/superpowers/specs/2026-05-12-hybrid-mcp-api-domains-design.md`.
```

- [ ] **Step 3: TODOS.md에 후속 항목 추가**

Append to `TODOS.md`:

```markdown
## MCP — Calendar 파일럿 후속

### 1. getEventDetail tool

- **What**: 단일 이벤트 상세 (description, 전체 attendees) 를 받는 tool
- **Why**: 위젯에서 이벤트 클릭 시 대시보드 내 모달, Claude의 깊은 질의
- **Where to start**: `packages/mcp-calendar/src/tools/get-event-detail.ts`

### 2. HMAC short-lived mediator token (v2)

- **What**: `/api/mcp/credentials/*` 의 정적 bearer를 60초 TTL HMAC로 전환
- **Why**: 정적 bearer 노출 시 Google access token 무한 발급 가능 — 이를 60초로 제한
- **Depends on**: 외부 webhook 도입 시점에 함께 (TODOS #1)
- **Where to start**: `packages/shared-mcp-runtime/src/auth-hmac.ts`

### 3. Tasks placeholder 채우기 (Todoist or Notion MCP)

- **What**: 우측 사이드바의 Tasks 자리를 동일 Hybrid 패턴으로 채움
- **Where to start**: `packages/mcp-tasks` 패키지

### 4. 기존 도메인 → MCP 패키지 추출 마이그레이션

- **What**: email-digest, important-emails, server-overview, host-dashboard를 동일 패턴으로 추출
- **Why**: LLM이 답장 우선순위 추천, 서버 액션 트리거 등 활용 가능
- **Cons**: 위젯 도메인 import → tool import 리팩토링. 단계적 진행.
```

- [ ] **Step 4: 커밋**

```bash
git add docs/RUNBOOK.md CLAUDE.md TODOS.md
git commit -m "$(cat <<'EOF'
docs: MCP Calendar 파일럿 운영·정책·후속 backlog 기록

- RUNBOOK: 토큰 회전, 장애 분기, Claude Code 등록 절차
- CLAUDE.md: MCP 도구 호출 정책 섹션 (in-process vs stdio)
- TODOS: getEventDetail, HMAC mediator, Tasks 채우기, 기존 도메인 추출

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: PR 생성 + 운영 검증 게이트

**Files:** (변경 없음)

- [ ] **Step 1: 전체 검증**

Run:
```bash
pnpm typecheck
pnpm lint
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
pnpm --filter @gons/mcp-calendar build
```

Expected: 모두 PASS.

- [ ] **Step 2: PR 생성**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: Calendar MCP 파일럿 — Hybrid 아키텍처 첫 구현" --body "$(cat <<'EOF'
## Summary

- packages/shared-google: Google API client + 토큰 fetcher + 에러 분류
- packages/shared-mcp-runtime: defineTool + stdio server bootstrap (MCP SDK wrap)
- packages/mcp-calendar: getUpcomingEvents tool + stdio CLI 진입점
- apps/dashboard: /api/mcp/credentials/google mediator, NextAuth calendar.readonly scope, 우측 사이드바에 CalendarCard
- 운영 문서: RUNBOOK, CLAUDE.md, TODOS 갱신

spec: docs/superpowers/specs/2026-05-12-hybrid-mcp-api-domains-design.md

## Test plan

- [x] shared-google 단위 테스트 10/10
- [x] shared-mcp-runtime 단위 테스트 3/3
- [x] mcp-calendar 단위 테스트 9/9
- [x] dashboard /api/mcp/credentials/google 통합 테스트 5/5
- [x] dashboard groupByDay 단위 테스트 3/3
- [x] pnpm typecheck / lint
- [x] pnpm build (placeholder env)
- [x] mcp-calendar tsup 빌드 → dist/cli.js
- [ ] CI green
- [ ] 운영 배포 후 https://gons.krdn.kr 우측 사이드바에 Calendar 카드 렌더링 (사용자 재로그인 필요 — calendar.readonly scope 동의)
- [ ] 로컬에서 node packages/mcp-calendar/dist/cli.js를 Claude Code에 등록 → tools/list에 calendar.getUpcomingEvents 노출

## 사용자 액션

머지 후:
1. 운영 .env에 `MCP_DASHBOARD_TOKEN=$(openssl rand -hex 32)` 추가, compose up
2. https://gons.krdn.kr 로그아웃 → 재로그인 (calendar.readonly scope 동의)
3. (선택) 로컬 머신의 Claude Code MCP 설정에 gons-calendar 등록

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: 머지 후 사용자 게이트**

다음을 사용자가 확인:

- 운영 .env에 `MCP_DASHBOARD_TOKEN` 추가됨
- compose up 후 `curl https://gons.krdn.kr/api/health` → `{"status":"ok"}`
- 재로그인 → 대시보드 우측에 Calendar 카드 렌더링 (실제 이벤트)
- Claude Code MCP 등록 → `gons-calendar` 도구 사용 가능

---

## DoD (Definition of Done)

- [ ] `pnpm typecheck` 전 패키지 통과
- [ ] `pnpm lint` 통과 (boundaries 규칙 위반 없음)
- [ ] `pnpm test` — 신규 30개+ 테스트 모두 PASS
- [ ] `pnpm --filter @gons/mcp-calendar build` 통과
- [ ] `pnpm build` (dashboard) 통과
- [ ] CI workflow green
- [ ] Docker image 빌드 + ghcr push 성공
- [ ] 운영 배포 후 `/api/health` 200
- [ ] (사용자) 재로그인 후 Calendar 카드가 실제 일정 렌더링
- [ ] (사용자) Claude Code MCP에 `gons-calendar` 등록 → `tools/list`에 `calendar.getUpcomingEvents` 노출
- [ ] OAuth 만료 시 Calendar 카드에 "다시 로그인" 배너
- [ ] Mediator 라우트가 `Cache-Control: no-store` 응답 (통합 테스트 검증)
