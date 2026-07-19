# Agent Memo Ingest 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code 작업 산출물을 `source='agent'` 메모로 저장하는 ingest API + `gon:memo-save` 스킬을 구축한다.

**Architecture:** 기존 메모 도메인의 세 번째 입력 소스. `POST /api/agent/memo-ingest`(Bearer=`MCP_DASHBOARD_TOKEN`)가 `createMemo(source:'agent')` 후 기존 `after()` 분류·액션 추출 파이프라인을 재사용한다. Claude Code 쪽은 스킬 하나가 수동 트리거와 자동 판단(호출당 최대 2건)을 모두 담당한다.

**Tech Stack:** Next.js 16 route handler, Drizzle (CHECK 마이그레이션), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-19-agent-memo-ingest-design.md` (Codex APPROVED)

## Global Constraints

- 응답·주석 한국어, 코드 영어 (`~/.claude/rules/korean-response.md`).
- FSD 의존 방향 준수: `app → widgets → features → entities → shared`.
- `content` 상한 20,000자 — `createMemoAction`의 `MAX_MEMO_LEN` 값 미러 (상수 공유화 금지, surgical change).
- 시크릿은 어떤 형태로도 커밋·세션 출력 금지 — 토큰은 변수명으로만 지칭.
- 테스트 실행: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test <파일>` (단일 파일은 경로 인자 — vitest include 필터 주의: 새 테스트는 반드시 단일 경로 실행으로 "N passed" 확인).
- 커밋은 명시 경로 `git add`만 (광역 add는 hookify가 차단).
- PR 전 `cd apps/dashboard && pnpm build` 1회 필수 (Gotcha #7).
- **배포 순서 필수**: 운영 DDL → 이미지 → 스킬 (구 CHECK + 새 API는 첫 insert 실패).

---

### Task 1: 스키마·타입 'agent' 확장 + 마이그레이션

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/memo.ts:64` (memos_source_check)
- Modify: `apps/dashboard/src/entities/memo/model/types.ts:18` (MemoSource)
- Modify: `apps/dashboard/src/features/memo-compose/api/createMemoAction.ts:14` (입력 타입 축소)
- Create: `apps/dashboard/drizzle/0045_*.sql` (db:generate 산출)

**Interfaces:**
- Produces: `MemoSource = "voice" | "text" | "agent"` — Task 2·3·4가 사용.
- Produces: `CreateMemoInputAction.source: Exclude<MemoSource, "agent">` — UI 폼 경로의 agent 유입을 컴파일 타임 차단.

- [ ] **Step 1: 스키마 CHECK 갱신**

`schema/memo.ts`의 기존 라인:
```ts
check("memos_source_check", sql`${t.source} IN ('voice', 'text')`),
```
을 다음으로 교체:
```ts
check("memos_source_check", sql`${t.source} IN ('voice', 'text', 'agent')`),
```

- [ ] **Step 2: MemoSource 타입 확장**

`entities/memo/model/types.ts`:
```ts
export type MemoSource = "voice" | "text" | "agent";
```

- [ ] **Step 3: createMemoAction 입력 타입 축소**

`createMemoAction.ts`의 interface를:
```ts
export interface CreateMemoInputAction {
  source: Exclude<MemoSource, "agent">;
  rawContent: string;
  cleanedContent: string;
  title?: string;
}
```
런타임 검증(`input.source !== "voice" && input.source !== "text"`)은 그대로 둔다.

- [ ] **Step 4: typecheck로 파급 확인**

Run: `pnpm typecheck`
Expected: PASS (UI 컴포저는 "voice"/"text" 리터럴만 전달). 실패 시 실패 지점이 agent를 넘기는 잘못된 경로 — 수정 대상.

- [ ] **Step 5: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `apps/dashboard/drizzle/0045_*.sql`에 아래 두 문장이 포함:
```sql
ALTER TABLE "memos" DROP CONSTRAINT "memos_source_check";--> statement-breakpoint
ALTER TABLE "memos" ADD CONSTRAINT "memos_source_check" CHECK ("memos"."source" IN ('voice', 'text', 'agent'));
```
drizzle-kit이 CHECK diff를 감지하지 못해 빈 마이그레이션이 나오면: 생성물 삭제 후 `cd apps/dashboard && pnpm drizzle-kit generate --custom --name=agent-memo-source`로 빈 파일을 만들고 위 SQL을 수기로 채운다 (snapshot id 충돌 시 메모리 `drizzle-snapshot-id-collision` 참조).

- [ ] **Step 6: fixture drift 전수 grep**

Run: `rg -n "source_check|source: \"(voice|text)\"" apps/dashboard/src apps/dashboard/tests | grep -v node_modules`
Expected: 기존 fixture는 'voice'/'text'라 여전히 유효 — CHECK가 'agent'를 거부한다고 단언하는 테스트가 **없음**을 확인. 있으면 해당 단언 갱신.

- [ ] **Step 7: 기존 메모 테스트 회귀 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/entities/memo src/features/memo-compose`
Expected: PASS (DB 통합 테스트는 로컬 test DB 미기동 시 ECONNREFUSED — Gotcha #2, pure unit 통과면 OK)

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema/memo.ts apps/dashboard/src/entities/memo/model/types.ts apps/dashboard/src/features/memo-compose/api/createMemoAction.ts apps/dashboard/drizzle/
git commit -m "feat: memos.source에 'agent' 추가 — CHECK·타입 확장, 액션 입력 축소"
```

---

### Task 2: MemoCard·RecentMemos 소스 표시 3-way 전환

**Files:**
- Modify: `apps/dashboard/src/entities/memo/ui/MemoCard.tsx:179` (`{isVoice ? "🎙 음성" : "✍ 텍스트"}`)
- Modify: `apps/dashboard/src/widgets/memo/ui/RecentMemos.tsx:25` (`{m.source === "voice" ? "🎙" : "✍"}`)
- Test: `apps/dashboard/src/entities/memo/ui/MemoCard.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `MemoSource`(3-way).
- Produces: 없음 (표시 전용).

- [ ] **Step 1: MemoCard agent 케이스 실패 테스트 추가**

`MemoCard.test.tsx`에 describe 블록 추가 (기존 `memo` fixture 재사용 — 파일 상단에 이미 존재):

```tsx
describe("MemoCard source 뱃지", () => {
  it("agent 메모는 🤖 에이전트로 표시하고 텍스트 뱃지를 겸용하지 않는다", () => {
    render(
      <MemoCard memo={{ ...memo, source: "agent" } as Memo} transformations={[]} highlightTerms={[]} />,
    );
    expect(screen.getByText("🤖 에이전트")).toBeTruthy();
    expect(screen.queryByText("✍ 텍스트")).toBeNull();
  });

  it("text 메모는 ✍ 텍스트 뱃지를 유지한다 (회귀)", () => {
    render(
      <MemoCard memo={{ ...memo, source: "text" } as Memo} transformations={[]} highlightTerms={[]} />,
    );
    expect(screen.getByText("✍ 텍스트")).toBeTruthy();
  });
});
```
(`MemoCard`의 `transformations`/`highlightTerms` prop 시그니처가 다르면 기존 테스트의 최소 호출 형태를 그대로 복사해 memo만 교체.)

- [ ] **Step 2: 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/entities/memo/ui/MemoCard.test.tsx`
Expected: FAIL — agent 메모가 "✍ 텍스트"로 렌더 (2-way ternary의 else 분기)

- [ ] **Step 3: MemoCard 3-way 구현**

`MemoCard.tsx` 모듈 레벨(컴포넌트 밖)에 추가하고 ternary를 교체:

```tsx
const SOURCE_BADGE: Record<MemoSource, string> = {
  voice: "🎙 음성",
  text: "✍ 텍스트",
  agent: "🤖 에이전트",
};
```
```tsx
// 교체 전: {isVoice ? "🎙 음성" : "✍ 텍스트"}
// 교체 후:
{SOURCE_BADGE[memo.source]}
```
`MemoSource` 타입 import를 `../model/types`에서 추가. `isVoice` 변수는 하이라이트 분기(`=== "voice"`)가 계속 쓰므로 남긴다.

- [ ] **Step 4: RecentMemos 3-way 구현**

`RecentMemos.tsx:25` ternary 교체:
```tsx
<span className="text-neutral-400">{m.source === "voice" ? "🎙" : m.source === "agent" ? "🤖" : "✍"}</span> {m.title}
```

- [ ] **Step 5: 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/entities/memo/ui/MemoCard.test.tsx`
Expected: PASS (신규 2개 포함 전체)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/entities/memo/ui/MemoCard.tsx apps/dashboard/src/entities/memo/ui/MemoCard.test.tsx apps/dashboard/src/widgets/memo/ui/RecentMemos.tsx
git commit -m "feat: 메모 소스 표시 3-way — agent 뱃지(🤖)를 MemoCard·RecentMemos에 추가"
```

---

### Task 3: memo-insights agentCount 분리 집계

**Files:**
- Modify: `apps/dashboard/src/widgets/memo-insights/model/types.ts:25-30` (CategoryDistribution)
- Modify: `apps/dashboard/src/widgets/memo-insights/lib/aggregate.ts:126-134` (buildCategoryDistribution)
- Modify: `apps/dashboard/src/widgets/memo-insights/ui/CategoryBlock.tsx:14-15,47-48,53-54`
- Test: `apps/dashboard/src/widgets/memo-insights/lib/aggregate.test.ts`

**Interfaces:**
- Consumes: Task 1의 `MemoSource`.
- Produces: `CategoryDistribution.agentCount: number` — CategoryBlock이 소비.

- [ ] **Step 1: 실패 테스트 추가**

`aggregate.test.ts`의 `buildCategoryDistribution` describe에 추가 (기존 `fact()` 헬퍼 재사용):

```ts
it("agent 소스는 textCount가 아니라 agentCount로 집계한다", () => {
  const facts = [
    fact({ source: "voice" }),
    fact({ source: "text" }),
    fact({ source: "agent" }),
    fact({ source: "agent" }),
  ];
  const d = buildCategoryDistribution(facts, []);
  expect(d.voiceCount).toBe(1);
  expect(d.textCount).toBe(1);
  expect(d.agentCount).toBe(2);
});
```

- [ ] **Step 2: 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/widgets/memo-insights/lib/aggregate.test.ts`
Expected: FAIL — `agentCount` 프로퍼티 부재(undefined) 또는 textCount=3

- [ ] **Step 3: 타입 + 집계 구현**

`model/types.ts`:
```ts
export interface CategoryDistribution {
  byCategory: { slug: string; labelKo: string; count: number }[];
  voiceCount: number;
  textCount: number;
  agentCount: number;
  unclassifiedCount: number;
}
```

`aggregate.ts` `buildCategoryDistribution` 루프 교체:
```ts
let voiceCount = 0;
let textCount = 0;
let agentCount = 0;
let unclassifiedCount = 0;

for (const f of facts) {
  if (f.source === "voice") voiceCount++;
  else if (f.source === "agent") agentCount++;
  else textCount++;
  if (f.category === null) unclassifiedCount++;
  else bySlug.set(f.category, (bySlug.get(f.category) ?? 0) + 1);
}
```
return 객체에 `agentCount` 추가.

- [ ] **Step 4: CategoryBlock 표시 추가**

`CategoryBlock.tsx`:
```tsx
const { byCategory, voiceCount, textCount, agentCount, unclassifiedCount } = category;
const total = voiceCount + textCount + agentCount;
```
카운트 span 나열에 추가:
```tsx
<span>에이전트 {agentCount}</span>
```
분포 바에 세그먼트 추가 (기존 violet/sky 옆):
```tsx
<div className="bg-amber-400" style={{ width: `${(agentCount / total) * 100}%` }} />
```

- [ ] **Step 5: 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/widgets/memo-insights`
Expected: PASS (신규 1개 포함 전체 — 기존 테스트가 agentCount 부재로 깨지면 기대 객체에 `agentCount: 0` 추가)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/widgets/memo-insights/model/types.ts apps/dashboard/src/widgets/memo-insights/lib/aggregate.ts apps/dashboard/src/widgets/memo-insights/ui/CategoryBlock.tsx apps/dashboard/src/widgets/memo-insights/lib/aggregate.test.ts
git commit -m "feat: memo-insights 소스 분포에 agentCount 분리 집계 추가"
```

---

### Task 4: ingest 라우트 — POST /api/agent/memo-ingest

**Files:**
- Create: `apps/dashboard/src/app/api/agent/memo-ingest/route.ts`
- Test: `apps/dashboard/tests/integration/memo-ingest.test.ts`

**Interfaces:**
- Consumes: `verifyBearer(req, env.MCP_DASHBOARD_TOKEN)` (`@/shared/lib/auth/cron`), `createMemo`·`classifyAndPersistMemoCategory` (`@/entities/memo/server`), `deriveTitle` (`@/entities/memo/client`), `extractAndPersistMemoActions` (`@/features/memo-actions`).
- Produces: `POST /api/agent/memo-ingest` — body `{ title?: string, content: string }` → 200 `{ id }` / 400 / 401 / 404 / 500. Task 5의 스킬이 소비.

- [ ] **Step 1: 실패 테스트 작성**

`tests/integration/memo-ingest.test.ts` 신규 — `tests/integration/mcp-credentials.test.ts`의 hoisted env + db mock 패턴, `createMemoAction.test.ts`의 after-캡처 패턴을 결합:

```ts
// /api/agent/memo-ingest 라우트 통합 테스트.
// 검증: 401(bearer 누락/오답) · 400(malformed JSON·공백-only·20k 초과) ·
//       404(admin user 행 없음) · 500(createMemo 실패) · 200(id + no-store + after 예약)
const TEST_BEARER = vi.hoisted(() => {
  const token = "test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // min 32자
  process.env.MCP_DASHBOARD_TOKEN = token;
  process.env.ADMIN_EMAILS ??= "krdn.net@gmail.com";
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5999/test_dummy";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.NEXTAUTH_SECRET ??= "test-secret-at-least-32-chars-padded!!";
  process.env.NEXTAUTH_URL ??= "http://localhost:3020";
  process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
  process.env.ANTHROPIC_BASE_URL ??= "http://localhost:8317";
  process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
  process.env.CRON_BEARER_TOKEN ??= "test-cron-bearer-token-padded-aaaaaaaaaa";
  process.env.ALLOWLIST_EMAILS ??= "krdn.net@gmail.com";
  return token;
});

let userRow: { id: string }[] = [];
vi.mock("@/shared/lib/db/client", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(userRow),
  };
  return { db: { select: () => selectChain } };
});

const createMemoMock = vi.hoisted(() => vi.fn());
const classifyMock = vi.hoisted(() => vi.fn());
const extractMock = vi.hoisted(() => vi.fn());
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("@/entities/memo/server", () => ({
  createMemo: createMemoMock,
  classifyAndPersistMemoCategory: classifyMock,
}));
vi.mock("@/features/memo-actions", () => ({
  extractAndPersistMemoActions: extractMock,
}));
// client barrel은 UI 컴포넌트를 포함하므로 node 환경에서 mock으로 차단
// (createMemoAction.test.ts와 동일 관례). deriveTitle은 실제 규칙의 축약 복제 —
// 첫 문장 절단만 재현해 파생 경로를 결정적으로 검증한다.
vi.mock("@/entities/memo/client", () => ({
  deriveTitle: (s: string) => s.trim().split(/[.!?。\n]/)[0].trim() || "(제목 없음)",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => afterCallbacks.push(cb),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/agent/memo-ingest/route";

function makeReq(bearer: string | null, body: BodyInit | null): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://gons.krdn.kr/api/agent/memo-ingest", {
    method: "POST",
    headers,
    body,
  });
}
const json = (o: unknown) => JSON.stringify(o);

describe("/api/agent/memo-ingest", () => {
  beforeEach(() => {
    userRow = [{ id: "u1" }];
    createMemoMock.mockReset().mockResolvedValue({ id: "m1", category: null });
    classifyMock.mockReset().mockResolvedValue({ kind: "classified" });
    extractMock.mockReset().mockResolvedValue({ kind: "extracted", count: 0 });
    afterCallbacks.length = 0;
  });

  it("bearer 누락 → 401", async () => {
    const res = await POST(makeReq(null, json({ content: "본문" })));
    expect(res.status).toBe(401);
  });
  it("bearer 오답 → 401", async () => {
    const res = await POST(makeReq("wrong", json({ content: "본문" })));
    expect(res.status).toBe(401);
  });
  it("malformed JSON → 400", async () => {
    const res = await POST(makeReq(TEST_BEARER, "not-json{"));
    expect(res.status).toBe(400);
  });
  it("공백-only content → 400", async () => {
    const res = await POST(makeReq(TEST_BEARER, json({ content: "   " })));
    expect(res.status).toBe(400);
    expect(createMemoMock).not.toHaveBeenCalled();
  });
  it("20k 초과 content → 400", async () => {
    const res = await POST(makeReq(TEST_BEARER, json({ content: "a".repeat(20_001) })));
    expect(res.status).toBe(400);
  });
  it("admin user 행 없음 → 404", async () => {
    userRow = [];
    const res = await POST(makeReq(TEST_BEARER, json({ content: "본문" })));
    expect(res.status).toBe(404);
  });
  it("createMemo 실패 → 500", async () => {
    createMemoMock.mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq(TEST_BEARER, json({ content: "본문" })));
    expect(res.status).toBe(500);
  });
  it("정상 → 200 {id} + no-store + trim 저장 + title 파생 + after 예약", async () => {
    const res = await POST(
      makeReq(TEST_BEARER, json({ content: "  다음 스프린트에 ingest 멱등 키 추가.  " })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "m1" });
    expect(createMemoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        source: "agent",
        rawContent: "다음 스프린트에 ingest 멱등 키 추가.",
        cleanedContent: "다음 스프린트에 ingest 멱등 키 추가.",
        title: "다음 스프린트에 ingest 멱등 키 추가",
      }),
    );
    expect(afterCallbacks.length).toBe(1);
    await afterCallbacks[0]();
    expect(classifyMock).toHaveBeenCalled();
    expect(extractMock).toHaveBeenCalled();
  });
  it("title 제공 시 trim해 그대로 사용", async () => {
    await POST(makeReq(TEST_BEARER, json({ title: "  제목  ", content: "본문" })));
    expect(createMemoMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "제목" }),
    );
  });
});
```
주의: `deriveTitle`의 실제 50자 절단 등 전체 규칙은 이 테스트 대상이 아니다 — 그 자체는 `entities/memo/model`의 기존 단위 테스트가 커버한다.

- [ ] **Step 2: 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test tests/integration/memo-ingest.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/agent/memo-ingest/route'`

- [ ] **Step 3: 라우트 구현**

`apps/dashboard/src/app/api/agent/memo-ingest/route.ts`:

```ts
// /api/agent/memo-ingest — Claude Code 스킬(gon:memo-save)의 메모 저장 입구.
//
// 정책 (spec 2026-07-19-agent-memo-ingest):
//   - Bearer 인증 (env.MCP_DASHBOARD_TOKEN — mediator와 동일 토큰·정책).
//   - 단일 사용자: ADMIN_EMAILS[0] → users 조회.
//   - 저장 후 분류·액션 추출은 after()로 기존 파이프라인 재사용 (best-effort).
//   - rate limiting 없음 (명시 결정 — 단일 사용자 + Bearer 필수).
import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { verifyBearer } from "@/shared/lib/auth/cron";
import { createMemo, classifyAndPersistMemoCategory } from "@/entities/memo/server";
import { deriveTitle } from "@/entities/memo/client";
// features→features 아님 — app 레이어의 features 참조 (FSD 허용 방향).
import { extractAndPersistMemoActions } from "@/features/memo-actions";

export const dynamic = "force-dynamic";

// createMemoAction의 MAX_MEMO_LEN 미러 (상수 공유화 없이 값만 — spec §4.3).
const MAX_MEMO_LEN = 20_000;

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(MAX_MEMO_LEN),
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  if (!verifyBearer(req, env.MCP_DASHBOARD_TOKEN)) {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response("Invalid body", { status: 400, headers: NO_STORE });
  }

  const adminEmail = env.ADMIN_EMAILS.split(",")[0]?.trim().toLowerCase();
  if (!adminEmail) {
    return new Response("ADMIN_EMAILS 미설정", { status: 500, headers: NO_STORE });
  }
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);
  if (row.length === 0) {
    return new Response("User not found", { status: 404, headers: NO_STORE });
  }

  const { content } = parsed.data;
  const title = parsed.data.title ?? deriveTitle(content);

  try {
    const memo = await createMemo({
      userId: row[0].id,
      source: "agent",
      title,
      rawContent: content,
      cleanedContent: content,
    });
    // createMemoAction 성공 분기와 동일 — best-effort, 실패는 cron sweep이 회수.
    after(() =>
      Promise.allSettled([
        classifyAndPersistMemoCategory(memo),
        extractAndPersistMemoActions(memo, new Date()),
      ]),
    );
    revalidatePath("/memos");
    return Response.json({ id: memo.id }, { headers: NO_STORE });
  } catch (err) {
    console.error("[memo-ingest] createMemo failed", err);
    return new Response("Transient error", { status: 500, headers: NO_STORE });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test tests/integration/memo-ingest.test.ts`
Expected: PASS — 10 passed (단일 경로 실행으로 개수 확인 — vitest include 함정)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/api/agent/memo-ingest/route.ts apps/dashboard/tests/integration/memo-ingest.test.ts
git commit -m "feat: POST /api/agent/memo-ingest — Claude Code 산출물 메모 저장 API"
```

---

### Task 5: gon:memo-save 스킬 + ingest.env + RUNBOOK

**Files:**
- Create: `~/.claude/skills/gon:memo-save/SKILL.md` (레포 밖)
- Create: `~/.config/gons-dashboard/ingest.env` (mode 600, 레포 밖)
- Modify: `docs/RUNBOOK.md` (시크릿 회전 절차에 MCP_DASHBOARD_TOKEN 3곳 항목)

**Interfaces:**
- Consumes: Task 4의 `POST /api/agent/memo-ingest` 계약.
- Produces: 스킬 트리거 — 이후 모든 Claude Code 세션이 사용.

- [ ] **Step 1: SKILL.md 작성**

`~/.claude/skills/gon:memo-save/SKILL.md` 전문:

````markdown
---
name: gon:memo-save
description: Gons Dashboard 메모로 작업 산출물 저장. 수동 — 사용자가 "/gon:memo-save", "메모에 저장해줘", "대시보드 메모로 보내줘"라고 할 때. 자동 — 작업을 마무리·정리하는 시점에, 지금 실행하지 않는 후속 작업이나 재사용 가치가 있는 아이디어·패턴·결정이 남았다고 판단되면 호출해 최대 2건까지 배치 저장 (best-effort — 세션 종료를 보장 후킹하지 않음).
---

# gon:memo-save — 작업 산출물을 Gons Dashboard 메모로

## 저장 판단 기준 (자동 경로)

**저장한다**: (a) 이번 세션에서 도출됐으나 지금 실행하지 않는 후속 작업,
(b) 재사용 가치가 있는 아이디어·패턴·결정, (c) 사용자가 명시 요청한 내용.

**저장하지 않는다**: 이미 GitHub Issue·TODOS.md·메모리에 기록된 것, 일회성
디버깅 노트, **시크릿·자격증명·토큰이 포함된 내용 (절대 금지 — 마스킹해도
본문에서 제외)**.

**상한**: 자동 경로는 작업 마무리 시 **1회 호출로 후보를 모아 최대 2건**만
저장. 초과 후보는 저장하지 말고 사용자에게 목록으로 제안한다.

## 본문 형식

- `title`: 한 줄 요약 (≤200자, 생략 시 서버가 첫 문장에서 파생).
- `content`: 정리된 본문 (≤20,000자). 말미에 출처 한 줄:
  `— 출처: <프로젝트명> Claude Code 세션, YYYY-MM-DD`

## 전송 절차 (shell 보간 금지)

1. **JSON payload는 Write 툴로 파일 생성** — 본문을 shell 문자열에 직접
   삽입하지 않는다 (따옴표·개행 깨짐 방지). scratchpad에
   `memo-payload.json`으로 `{ "title": "...", "content": "..." }` 작성.
2. 전송:

```bash
source ~/.config/gons-dashboard/ingest.env
curl -sS --fail-with-body --max-time 15 \
  -X POST "$MEMO_INGEST_URL/api/agent/memo-ingest" \
  -H "Authorization: Bearer $MEMO_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @<scratchpad>/memo-payload.json
```

3. **성공 판정**: HTTP 200 **그리고** 응답 body에 `"id"` 존재. 둘 다
   확인해야 성공.

## 실패 처리 — 자동 재시도 금지

POST는 비멱등이다 — 서버가 저장한 뒤 응답만 유실됐다면 재시도가 중복 메모를
만든다. 실패 시:
1. 재시도하지 않는다.
2. **본문 전문을 세션에 출력**해 유실을 방지한다.
3. 사용자에게 실패 사실을 보고하고, 재시도는 사용자 지시로만 수행한다.

## 보고 의무

자동 저장 시 무엇을 왜 저장했는지 세션에서 즉시 보고한다. 조용한 저장 금지.
````

- [ ] **Step 2: ingest.env 생성 (시크릿 비표시)**

값을 화면에 출력하지 않고 운영 `.env`에서 직접 파이프한다:

```bash
mkdir -p ~/.config/gons-dashboard
{
  echo 'MEMO_INGEST_URL=https://gons.krdn.kr'
  ssh gon@192.168.0.5 "grep '^MCP_DASHBOARD_TOKEN=' /home/gon/projects/gon/gons-dashboard/.env" \
    | sed 's/^MCP_DASHBOARD_TOKEN=/MEMO_INGEST_TOKEN=/'
} > ~/.config/gons-dashboard/ingest.env
chmod 600 ~/.config/gons-dashboard/ingest.env
```

Run(검증): `grep -c '^MEMO_INGEST_TOKEN=.' ~/.config/gons-dashboard/ingest.env && stat -c %a ~/.config/gons-dashboard/ingest.env`
Expected: `1` 그리고 `600` (값 자체는 출력하지 않는다)

- [ ] **Step 3: RUNBOOK 회전 절차 추가**

`docs/RUNBOOK.md`의 시크릿 회전 섹션에 항목 추가:

```markdown
### MCP_DASHBOARD_TOKEN 회전 (3곳 동시)

이 토큰은 MCP mediator(Google credential 발급)와 memo ingest를 함께 연다 —
유출 의심 시 즉시 회전하고 아래 3곳을 동시에 교체한다:

1. 운영 `.env` (`192.168.0.5:/home/gon/projects/gon/gons-dashboard/.env`) →
   app 컨테이너 `--no-deps --force-recreate` 재기동
2. `~/.claude.json`의 MCP 서버 등록 env (gons-calendar 등 mediator 사용 항목)
3. `~/.config/gons-dashboard/ingest.env` (gon:memo-save 스킬)
```

- [ ] **Step 4: 스킬 카탈로그 snapshot 갱신 (선택)**

Run: `pnpm skills:snapshot`
Expected: 카탈로그 JSON에 gon:memo-save 항목 추가 (실패해도 기능 무관 — 카탈로그 위젯 표시용)

- [ ] **Step 5: Commit (레포 내 변경분만)**

```bash
git add docs/RUNBOOK.md
git commit -m "docs: MCP_DASHBOARD_TOKEN 3곳 동시 회전 절차 추가 (memo ingest 결합 위험)"
```

---

### Task 6: 전체 검증 + production build

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 정적 검증**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 2: 전체 테스트**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: PASS (로컬 test DB 미기동 시 DB 통합 13개 ECONNREFUSED는 기지 사항 — Gotcha #2)

- [ ] **Step 3: production build (Gotcha #7 — PR 전 필수)**

Run: `cd apps/dashboard && pnpm build`
Expected: 성공. 실패 시 barrel server/client seam 위반 여부 확인 (라우트는 server tree라 해당 없음이 정상)

- [ ] **Step 4: PR 생성**

```bash
git push -u origin feat/agent-memo-ingest
gh pr create --title "feat: Claude Code 산출물 메모 저장 — agent memo ingest" --body "spec: docs/superpowers/specs/2026-07-19-agent-memo-ingest-design.md (Codex APPROVED)"
```
(브랜치는 구현 시작 시 main에서 분기 — worktree 사용 시 superpowers:using-git-worktrees.)

---

### Task 7: 배포 (순서 필수 — DDL → 이미지 → 스킬)

**Files:** 없음 (운영 절차)

- [ ] **Step 1: 운영 DDL 선적용**

```bash
ssh gon@192.168.0.5 "docker exec -i gons-dashboard-postgres psql -U gons -d gons -c \"BEGIN; ALTER TABLE memos DROP CONSTRAINT memos_source_check; ALTER TABLE memos ADD CONSTRAINT memos_source_check CHECK (source IN ('voice','text','agent')); COMMIT;\""
```
(DB 이름은 운영 compose의 `POSTGRES_DB` 값으로 확인 후 실행 — `docker exec gons-dashboard-postgres env | grep POSTGRES_DB`.)

Run(검증): `ssh gon@192.168.0.5 "docker exec -i gons-dashboard-postgres psql -U gons -d gons -c \"SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='memos_source_check'\""`
Expected: `'agent'` 포함

- [ ] **Step 2: PR 머지 후 이미지 배포 (기존 4단계 검증)**

```bash
gh run watch
docker --context home-server compose -f /home/gon/projects/gon/gons-dashboard/docker-compose.yml pull app
ssh gon@192.168.0.5 "cd /home/gon/projects/gon/gons-dashboard && docker compose -f docker-compose.yml --env-file .env up -d --no-deps --force-recreate app"
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"
```
Expected: `{"status":"ok"}` (참고: `--no-deps` 필수 — postgres recreate 방지, 메모리 `compose-up-postgres-recreate-password-drift`)

- [ ] **Step 3: 운영 스모크 (dev 서버 아닌 운영 — dev는 운영 DB를 봐서 DDL 전 실패했을 경로)**

Task 5의 payload 파일 패턴으로 테스트 메모 1건 전송:
```bash
source ~/.config/gons-dashboard/ingest.env
printf '{"title":"ingest 스모크","content":"agent memo ingest 배포 검증용 — 확인 후 삭제.\\n— 출처: gons-dashboard Claude Code 세션, 2026-07-19"}' > /tmp/smoke.json
curl -sS --fail-with-body --max-time 15 -X POST "$MEMO_INGEST_URL/api/agent/memo-ingest" -H "Authorization: Bearer $MEMO_INGEST_TOKEN" -H "Content-Type: application/json" --data @/tmp/smoke.json
```
Expected: `{"id":"..."}`. 이어서 https://gons.krdn.kr/memos 에서 🤖 뱃지 + (수 분 내) 자동 분류 확인 → 스모크 메모 삭제.

- [ ] **Step 4: 스킬 실전 검증**

다음 Claude Code 세션에서: (1) `/gon:memo-save`로 수동 저장 1회, (2) 작업 마무리 시 자동 판단 경로 발화 여부 관찰. 스킬 수용 체크리스트(스펙 §6-4): JSON 특수문자 본문 왕복, 토큰 누락 시 명확한 실패 보고, 실패 시 본문 세션 출력.
