# 텍스트/음성 메모 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인 대시보드에 텍스트/음성 메모 캡처 기능을 추가한다 — 음성은 브라우저 STT로 받아쓰고 AI가 정리(sonnet-5)해 승인 후 저장, 텍스트는 바로 저장. 원문+정리본 둘 다 보관.

**Architecture:** FSD 3계층. `entities/memo`(DB CRUD·타입·표시 카드), `features/memo-compose`(녹음·클린업·승인), `features/memo-manage`(목록·편집·삭제), `widgets/memo`(조합), `app/(dashboard)/memos`(전용 페이지). client/server seam은 `email-reply` 패턴 미러(`client.ts`=Server Action re-export, server-only 함수 분리).

**Tech Stack:** Next.js 16 App Router(RSC + Server Actions), TypeScript strict, Drizzle ORM + PostgreSQL 16, Web Speech API, `@krdn/llm-gateway` `analyzeStructured`, Vitest.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-09-voice-text-memo-design.md`
- FSD 의존성: `app → widgets → features → entities → shared` (상위만 하위 참조). entities 간 직접 import 금지.
- **client/server seam (Gotcha #7)**: `"use client"`는 `features/*/client.ts`만 import. server-only(postgres 의존)는 별도. **`pnpm build`만 seam 위반을 잡는다** — 각 UI 태스크 후 build 1회 필수.
- `userId`는 `uuid` + `.references(() => users.id, { onDelete: "cascade" })` (auth users.id가 uuid).
- `source`는 `text` + `check` 제약 IN ('voice','text') — drizzle enum 아님 (Gotcha #10 CHECK 패턴).
- 모델: `claude-sonnet-5`. 클린업 프롬프트는 transcript normalizer (요약·판단·할일추출·내용삭제·고유명사변경 금지).
- 관측은 best-effort try/catch swallow. LLM 로깅은 토큰만, 본문 미로깅.
- Server Action 에러는 `.then(success, failure)` 유니온 패턴 (react-hooks/error-boundaries 룰).
- 통합 테스트는 `TEST_DATABASE_URL` 필요 (Gotcha #2).
- 검증 게이트: `pnpm typecheck && pnpm lint && cd apps/dashboard && pnpm build`.
- 운영 마이그레이션: psql BEGIN/COMMIT 직접 적용 후 이미지 교체 (drizzle-kit migrate prod broken).
- 커밋 컨벤션: `feat:`/`test:`/`docs:` + 한국어 제목.

---

### Task 0: 브랜치 분리

**Files:** (없음 — git 작업만)

- [ ] **Step 1: 새 브랜치 생성**

현재 브랜치(`chore/bump-llm-gateway-v3.4`)와 분리. main 기준으로 판다.

```bash
cd /home/gon/projects/gon/gons-dashboard
git fetch origin
git checkout -b feat/voice-text-memo origin/main
```

Expected: `Switched to a new branch 'feat/voice-text-memo'`

---

### Task 1: DB 스키마 (memos 테이블)

**Files:**
- Create: `apps/dashboard/src/shared/lib/db/schema/memo.ts`
- Modify: `apps/dashboard/src/shared/lib/db/schema/index.ts` (export 추가)

**Interfaces:**
- Produces: `memos` (drizzle pgTable), `Memo` 타입은 Task 2에서 `$inferSelect`로 파생.

- [ ] **Step 1: 스키마 파일 작성**

`apps/dashboard/src/shared/lib/db/schema/memo.ts`:

```typescript
// Memo 도메인 — entities/memo.
// - memos: 텍스트/음성 메모. 원문(raw_content) + AI 정리본(cleaned_content) 둘 다 보관.
//   음성은 승인해야 저장하므로 DB의 모든 행은 승인 완료 상태.
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, index, check } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const memos = pgTable(
  "memos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'voice' | 'text' — CHECK 제약으로 강제 (drizzle enum 아님).
    source: text("source").notNull(),
    // 자동 파생 시에도 저장 시점에 확정값을 넣는다 (목록 렌더 단순화).
    title: text("title").notNull(),
    // 음성: 받아쓰기 원문 / 텍스트: 입력 그대로. 생성 후 immutable.
    rawContent: text("raw_content").notNull(),
    // 음성: AI 클린업본 / 텍스트: raw와 동일. 편집 대상.
    cleanedContent: text("cleaned_content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("memos_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("memos_source_check", sql`${t.source} IN ('voice', 'text')`),
    check("memos_raw_not_empty", sql`length(${t.rawContent}) > 0`),
    check("memos_cleaned_not_empty", sql`length(${t.cleanedContent}) > 0`),
  ],
);
```

- [ ] **Step 2: schema/index.ts에 등록**

`apps/dashboard/src/shared/lib/db/schema/index.ts`의 export 목록에 추가:

```typescript
export * from "./stock";
export * from "./memo";
```

- [ ] **Step 3: 마이그레이션 생성**

```bash
cd apps/dashboard
pnpm db:generate
```

Expected: `drizzle/00XX_*.sql` 생성. snapshot id collision 나면 snapshot json의 `id`/`prevId` 두 줄만 수정 (Gotcha).

- [ ] **Step 4: typecheck**

```bash
cd apps/dashboard && pnpm typecheck
```

Expected: PASS (에러 없음).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema/memo.ts apps/dashboard/src/shared/lib/db/schema/index.ts apps/dashboard/drizzle/
git commit -m "feat: memos 테이블 스키마 추가"
```

---

### Task 2: entity/memo — 타입 + client barrel

**Files:**
- Create: `apps/dashboard/src/entities/memo/model/types.ts`
- Create: `apps/dashboard/src/entities/memo/client.ts`
- Test: `apps/dashboard/src/entities/memo/model/types.test.ts`

**Interfaces:**
- Consumes: `memos` (Task 1).
- Produces: `Memo`, `MemoSource`, `deriveTitle(cleaned: string): string`.

- [ ] **Step 1: 타입 + 유틸 테스트 작성**

`apps/dashboard/src/entities/memo/model/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveTitle } from "./types";

describe("deriveTitle", () => {
  it("첫 문장을 제목으로 파생한다", () => {
    expect(deriveTitle("내일 회의가 있다. 자료 준비 필요.")).toBe("내일 회의가 있다");
  });
  it("긴 첫 문장은 최대 길이로 자른다", () => {
    const long = "가".repeat(100);
    expect(deriveTitle(long).length).toBeLessThanOrEqual(50);
  });
  it("빈 문자열이면 기본 제목을 반환한다", () => {
    expect(deriveTitle("")).toBe("(제목 없음)");
    expect(deriveTitle("   ")).toBe("(제목 없음)");
  });
  it("마침표가 없으면 전체(길이 컷)에서 파생한다", () => {
    expect(deriveTitle("마침표 없는 짧은 메모")).toBe("마침표 없는 짧은 메모");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/dashboard && pnpm vitest run src/entities/memo/model/types.test.ts
```

Expected: FAIL ("deriveTitle is not a function" 또는 module not found).

- [ ] **Step 3: 타입 + 유틸 구현**

`apps/dashboard/src/entities/memo/model/types.ts`:

```typescript
import type { memos } from "@/shared/lib/db/schema";

export type Memo = typeof memos.$inferSelect;
export type MemoSource = "voice" | "text";

const MAX_TITLE_LEN = 50;

/** cleaned_content 첫 문장에서 제목 파생. 저장 시점에 title 확정값 생성용. */
export function deriveTitle(cleaned: string): string {
  const trimmed = cleaned.trim();
  if (trimmed.length === 0) return "(제목 없음)";
  // 첫 문장 (마침표/물음표/느낌표 기준). 없으면 전체.
  const firstSentence = trimmed.split(/[.!?。\n]/)[0].trim();
  const base = firstSentence.length > 0 ? firstSentence : trimmed;
  return base.length > MAX_TITLE_LEN ? base.slice(0, MAX_TITLE_LEN) : base;
}
```

- [ ] **Step 4: client barrel 작성**

`apps/dashboard/src/entities/memo/client.ts`:

```typescript
// entities/memo — client-safe entrypoint (타입·상수만; server-only 함수 없음).
export type { Memo, MemoSource } from "./model/types";
export { deriveTitle } from "./model/types";
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd apps/dashboard && pnpm vitest run src/entities/memo/model/types.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/entities/memo/
git commit -m "feat: memo entity 타입 + deriveTitle 유틸"
```

---

### Task 3: entity/memo — server CRUD

**Files:**
- Create: `apps/dashboard/src/entities/memo/api/memoRepo.ts`
- Create: `apps/dashboard/src/entities/memo/server.ts`
- Test: `apps/dashboard/src/entities/memo/api/memoRepo.test.ts`

**Interfaces:**
- Consumes: `memos` (Task 1), `db` from `@/shared/lib/db/client`, `Memo` (Task 2).
- Produces:
  - `listMemos(userId: string): Promise<Memo[]>`
  - `getMemo(userId: string, id: string): Promise<Memo | null>`
  - `createMemo(input: { userId: string; source: MemoSource; title: string; rawContent: string; cleanedContent: string }): Promise<Memo>`
  - `updateMemo(userId: string, id: string, patch: { title: string; cleanedContent: string }): Promise<Memo | null>`
  - `deleteMemo(userId: string, id: string): Promise<boolean>`

- [ ] **Step 1: CRUD 통합 테스트 작성**

`apps/dashboard/src/entities/memo/api/memoRepo.test.ts` (DB 통합 — `TEST_DATABASE_URL` 필요):

```typescript
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { memos } from "@/shared/lib/db/schema";
import { users } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMemo, listMemos, getMemo, updateMemo, deleteMemo } from "./memoRepo";

const USER_ID = "00000000-0000-0000-0000-000000000abc";

beforeAll(async () => {
  // 테스트 유저 확보 (FK 충족). 존재하면 무시.
  await db.insert(users).values({ id: USER_ID, email: "memo-test@example.com" }).onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(memos).where(eq(memos.userId, USER_ID));
});

describe("memoRepo", () => {
  const base = { userId: USER_ID, source: "text" as const, title: "제목", rawContent: "원문", cleanedContent: "원문" };

  it("createMemo → getMemo 왕복", async () => {
    const created = await createMemo(base);
    const fetched = await getMemo(USER_ID, created.id);
    expect(fetched?.title).toBe("제목");
  });

  it("listMemos는 최신순으로 소유자 것만 반환한다", async () => {
    await createMemo({ ...base, title: "첫번째" });
    await createMemo({ ...base, title: "두번째" });
    const list = await listMemos(USER_ID);
    expect(list.length).toBe(2);
    expect(list[0].createdAt.getTime()).toBeGreaterThanOrEqual(list[1].createdAt.getTime());
  });

  it("getMemo는 다른 유저 메모에 null (소유 격리)", async () => {
    const created = await createMemo(base);
    const other = await getMemo("00000000-0000-0000-0000-000000000fff", created.id);
    expect(other).toBeNull();
  });

  it("updateMemo는 cleaned/title만 바꾸고 raw는 보존한다", async () => {
    const created = await createMemo(base);
    const updated = await updateMemo(USER_ID, created.id, { title: "수정", cleanedContent: "수정본" });
    expect(updated?.title).toBe("수정");
    expect(updated?.cleanedContent).toBe("수정본");
    expect(updated?.rawContent).toBe("원문"); // immutable
  });

  it("updateMemo는 다른 유저 메모를 못 바꾼다", async () => {
    const created = await createMemo(base);
    const result = await updateMemo("00000000-0000-0000-0000-000000000fff", created.id, { title: "x", cleanedContent: "x" });
    expect(result).toBeNull();
  });

  it("deleteMemo는 소유자 것만 삭제한다", async () => {
    const created = await createMemo(base);
    expect(await deleteMemo("00000000-0000-0000-0000-000000000fff", created.id)).toBe(false);
    expect(await deleteMemo(USER_ID, created.id)).toBe(true);
    expect(await getMemo(USER_ID, created.id)).toBeNull();
  });

  it("빈 content는 CHECK 제약으로 거부된다", async () => {
    await expect(createMemo({ ...base, rawContent: "", cleanedContent: "" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoRepo.test.ts
```

Expected: FAIL (memoRepo not found). DB 미기동이면 ECONNREFUSED — 로컬 test DB 필요 (CLAUDE.md Gotcha #2 참조, pg_trgm/pgcrypto는 각각 별도 psql로 설치).

- [ ] **Step 3: memoRepo 구현**

`apps/dashboard/src/entities/memo/api/memoRepo.ts`:

```typescript
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memos } from "@/shared/lib/db/schema";
import type { Memo, MemoSource } from "../model/types";

export function listMemos(userId: string): Promise<Memo[]> {
  return db.select().from(memos).where(eq(memos.userId, userId)).orderBy(desc(memos.createdAt));
}

export async function getMemo(userId: string, id: string): Promise<Memo | null> {
  const rows = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateMemoInput {
  userId: string;
  source: MemoSource;
  title: string;
  rawContent: string;
  cleanedContent: string;
}

export async function createMemo(input: CreateMemoInput): Promise<Memo> {
  const rows = await db.insert(memos).values(input).returning();
  return rows[0];
}

export async function updateMemo(
  userId: string,
  id: string,
  patch: { title: string; cleanedContent: string },
): Promise<Memo | null> {
  const rows = await db
    .update(memos)
    .set({ title: patch.title, cleanedContent: patch.cleanedContent, updatedAt: new Date() })
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteMemo(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, userId)))
    .returning({ id: memos.id });
  return rows.length > 0;
}
```

- [ ] **Step 4: server barrel 작성**

`apps/dashboard/src/entities/memo/server.ts`:

```typescript
// entities/memo — server entrypoint (DB 접근 CRUD). "server-only".
import "server-only";
export {
  listMemos,
  getMemo,
  createMemo,
  updateMemo,
  deleteMemo,
  type CreateMemoInput,
} from "./api/memoRepo";
export type { Memo, MemoSource } from "./model/types";
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoRepo.test.ts
```

Expected: PASS (7 tests). (로컬 test DB에 memos 스키마 push 필요: `pnpm db:push` 대신 test DB에 drizzle-kit push.)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/entities/memo/
git commit -m "feat: memo entity server CRUD (소유 격리 + raw immutable)"
```

---

### Task 4: LLM 클린업 함수 (cleanup-transcript)

**Files:**
- Create: `apps/dashboard/src/features/memo-compose/lib/cleanup-transcript.ts`
- Test: `apps/dashboard/src/features/memo-compose/lib/cleanup-transcript.test.ts`

**Interfaces:**
- Consumes: `analyzeStructured` from `@krdn/llm-gateway/gateway`, `gatewayDefaults`/`logLlmSpend` from `@/shared/lib/llm/anthropic`, `isRefusalDraft` from `@/shared/lib/llm/draft-reply`.
- Produces:
  - `CleanupResult = { kind: "ok"; cleaned: string } | { kind: "raw-fallback"; reason: string }`
  - `cleanupTranscript(raw: string): Promise<CleanupResult>`
  - `CleanupResponseSchema` (Zod, export — mock 함정 회피용 직접 safeParse 테스트 대상)
  - `isDegenerateCleanup(raw: string, cleaned: string): boolean` (과도 축약 감지)

- [ ] **Step 1: 순수 검증 테스트 작성 (mock 함정 회피 — 스키마·판별 함수 직접)**

`apps/dashboard/src/features/memo-compose/lib/cleanup-transcript.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CleanupResponseSchema, isDegenerateCleanup } from "./cleanup-transcript";

describe("CleanupResponseSchema", () => {
  it("정상 cleaned 문자열을 통과시킨다", () => {
    expect(CleanupResponseSchema.safeParse({ cleaned: "정리된 텍스트" }).success).toBe(true);
  });
  it("빈 cleaned는 거부한다", () => {
    expect(CleanupResponseSchema.safeParse({ cleaned: "" }).success).toBe(false);
  });
});

describe("isDegenerateCleanup — 과도 축약 감지", () => {
  it("60% 미만으로 줄면 degenerate", () => {
    const raw = "가".repeat(100);
    expect(isDegenerateCleanup(raw, "가".repeat(50))).toBe(true);
  });
  it("정상 정리(경미한 축소)는 통과", () => {
    const raw = "어 그 내일 회의가 있어요";
    expect(isDegenerateCleanup(raw, "내일 회의가 있어요")).toBe(false);
  });
  it("빈 결과는 degenerate", () => {
    expect(isDegenerateCleanup("원문 있음", "")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/lib/cleanup-transcript.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: cleanup-transcript 구현**

`apps/dashboard/src/features/memo-compose/lib/cleanup-transcript.ts`:

```typescript
// 받아쓰기 원문 → AI 정리(transcript normalizer). draft-reply.ts 패턴 미러.
// 요약·판단·할일추출·내용삭제·고유명사변경 금지 — 뜻 보존이 최우선.
import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults, logLlmSpend } from "@/shared/lib/llm/anthropic";
import { isRefusalDraft } from "@/shared/lib/llm/draft-reply";

const MAX_INPUT = 20_000;
const CLEANUP_MODEL = "claude-sonnet-5";

export const CleanupResponseSchema = z.object({
  cleaned: z.string().min(1).max(30_000),
});

export type CleanupResult =
  | { kind: "ok"; cleaned: string }
  | { kind: "raw-fallback"; reason: string };

const SYSTEM_PROMPT = `당신은 음성 받아쓰기 원문을 정리하는 transcript normalizer입니다.

할 일:
- 군말("음…", "어…", "그…")·반복·받아쓰기 오류를 제거.
- 문장부호와 문단을 자연스럽게 정리.

금지 (엄수):
- 요약하지 않는다. 원문의 모든 정보를 보존한다.
- 판단·평가·조언·안전 문구를 넣지 않는다.
- 할 일 목록·제목을 만들지 않는다.
- 고유명사·숫자·날짜를 임의로 바꾸지 않는다.
- 내용을 삭제하지 않는다 (군말 제외).

응답은 정리된 텍스트만. JSON: {"cleaned": "정리된 전체 텍스트"}`;

/** 과도 축약/빈 결과 감지 — degenerate면 raw fallback. */
export function isDegenerateCleanup(raw: string, cleaned: string): boolean {
  const c = cleaned.trim();
  if (c.length === 0) return true;
  // 원문 대비 60% 미만으로 줄면 정보 손실로 간주.
  return c.length < raw.trim().length * 0.6;
}

export async function cleanupTranscript(raw: string): Promise<CleanupResult> {
  const input = raw.trim();
  if (input.length === 0) return { kind: "raw-fallback", reason: "empty-input" };
  const truncated = input.slice(0, MAX_INPUT);

  try {
    const result = await analyzeStructured({
      ...gatewayDefaults,
      model: CLEANUP_MODEL,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: truncated }],
      schema: CleanupResponseSchema,
    });
    // logLlmSpend는 best-effort (관측이 주 경로를 깨지 않게).
    try {
      logLlmSpend("memo-cleanup", CLEANUP_MODEL, result.usage);
    } catch {
      /* swallow */
    }
    const cleaned = result.data.cleaned;
    if (isRefusalDraft(cleaned)) return { kind: "raw-fallback", reason: "refusal" };
    if (isDegenerateCleanup(truncated, cleaned)) return { kind: "raw-fallback", reason: "degenerate" };
    return { kind: "ok", cleaned };
  } catch (e) {
    return { kind: "raw-fallback", reason: e instanceof Error ? e.message : "llm-error" };
  }
}
```

> 주: `analyzeStructured` 호출 시그니처(`gatewayDefaults` 스프레드, `schema`, `result.data`/`result.usage`)는 구현 시 `draft-reply.ts`의 실제 호출부를 그대로 따를 것. 위는 패턴 근사치 — 실제 API 형태가 다르면 draft-reply.ts에 맞춘다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/lib/cleanup-transcript.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/memo-compose/lib/cleanup-transcript.ts apps/dashboard/src/features/memo-compose/lib/cleanup-transcript.test.ts
git commit -m "feat: 메모 AI 클린업 (sonnet-5 normalizer + raw fallback)"
```

---

### Task 5: Web Speech 훅 (useSpeechRecognition)

**Files:**
- Create: `apps/dashboard/src/features/memo-compose/lib/useSpeechRecognition.ts`
- Create: `apps/dashboard/src/features/memo-compose/lib/speechResultReducer.ts` (순수 로직 분리 — 테스트 대상)
- Test: `apps/dashboard/src/features/memo-compose/lib/speechResultReducer.test.ts`

**Interfaces:**
- Produces:
  - `accumulateFinal(prev: string, event: { resultIndex: number; results: SpeechRecognitionResultLike[] }): { finalText: string; interim: string }` (순수)
  - `useSpeechRecognition(): { isSupported: boolean; isRecording: boolean; rawTranscript: string; interim: string; error: SpeechError | null; start(): void; stop(): void; reset(): void }`
  - `type SpeechError = "not-allowed" | "no-speech" | "network" | "aborted" | "unknown"`

- [ ] **Step 1: 순수 리듀서 테스트 (중복 final 방지 — 가장 흔한 버그)**

`apps/dashboard/src/features/memo-compose/lib/speechResultReducer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { accumulateFinal } from "./speechResultReducer";

// SpeechRecognitionResult 최소 형태 mock.
function mk(transcript: string, isFinal: boolean) {
  return { 0: { transcript }, isFinal, length: 1 };
}

describe("accumulateFinal — resultIndex부터 isFinal만 누적", () => {
  it("final 결과만 finalText에 append한다", () => {
    const prev = "안녕하세요. ";
    const event = { resultIndex: 0, results: [mk("반갑습니다.", true)] };
    const { finalText, interim } = accumulateFinal(prev, event);
    expect(finalText).toBe("안녕하세요. 반갑습니다.");
    expect(interim).toBe("");
  });
  it("interim 결과는 별도 버퍼로 두고 finalText에 안 넣는다", () => {
    const event = { resultIndex: 0, results: [mk("말하는중", false)] };
    const { finalText, interim } = accumulateFinal("", event);
    expect(finalText).toBe("");
    expect(interim).toBe("말하는중");
  });
  it("resultIndex부터만 순회해 중복 누적을 막는다", () => {
    // resultIndex=1이면 index 0은 이미 처리됨 → 건너뛴다.
    const event = { resultIndex: 1, results: [mk("이미처리", true), mk("새결과", true)] };
    const { finalText } = accumulateFinal("기존. ", event);
    expect(finalText).toBe("기존. 새결과");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/lib/speechResultReducer.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: 순수 리듀서 구현**

`apps/dashboard/src/features/memo-compose/lib/speechResultReducer.ts`:

```typescript
// Web Speech 결과 누적 — 순수 로직 (훅에서 분리해 테스트 가능하게).
// 핵심: event.resultIndex부터만 순회하고 isFinal만 append (중복 누적 방지).
interface ResultLike {
  0: { transcript: string };
  isFinal: boolean;
  length: number;
}

export function accumulateFinal(
  prevFinal: string,
  event: { resultIndex: number; results: ArrayLike<ResultLike> },
): { finalText: string; interim: string } {
  let finalText = prevFinal;
  let interim = "";
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const r = event.results[i];
    const transcript = r[0].transcript;
    if (r.isFinal) {
      finalText += transcript;
    } else {
      interim += transcript;
    }
  }
  return { finalText, interim };
}
```

- [ ] **Step 4: 리듀서 테스트 통과 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/lib/speechResultReducer.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: 훅 구현 (React 19 순수성 — 콜백에서만 setState)**

`apps/dashboard/src/features/memo-compose/lib/useSpeechRecognition.ts`:

```typescript
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accumulateFinal } from "./speechResultReducer";

export type SpeechError = "not-allowed" | "no-speech" | "network" | "aborted" | "unknown";

// 브라우저 벤더 프리픽스 대응.
function getRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  return (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null) as never;
}

export function useSpeechRecognition() {
  const [isRecording, setIsRecording] = useState(false);
  const [rawTranscript, setRawTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<SpeechError | null>(null);
  const recRef = useRef<SpeechRecognition | null>(null);
  const wantRecordingRef = useRef(false); // onend 자동 재시작 판단용.
  const isSupported = getRecognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);
    setRawTranscript("");
    setInterim("");
    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      setRawTranscript((prev) => {
        const { finalText, interim: itm } = accumulateFinal(prev, e);
        setInterim(itm);
        return finalText;
      });
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      const code = e.error;
      if (code === "not-allowed" || code === "no-speech" || code === "network" || code === "aborted") {
        setError(code);
      } else {
        setError("unknown");
      }
      if (code === "not-allowed" || code === "aborted") wantRecordingRef.current = false;
    };
    rec.onend = () => {
      // 브라우저가 임의 종료했지만 사용자가 아직 녹음 중이면 재시작 (debounce).
      if (wantRecordingRef.current) {
        setTimeout(() => {
          if (wantRecordingRef.current) {
            try {
              rec.start();
            } catch {
              /* 이미 시작됨 등 — 무시 */
            }
          }
        }, 250);
      } else {
        setIsRecording(false);
      }
    };
    wantRecordingRef.current = true;
    recRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, []);

  const stop = useCallback(() => {
    wantRecordingRef.current = false;
    recRef.current?.stop();
    setIsRecording(false);
    setInterim("");
  }, []);

  const reset = useCallback(() => {
    setRawTranscript("");
    setInterim("");
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      wantRecordingRef.current = false;
      recRef.current?.stop();
    };
  }, []);

  return { isSupported, isRecording, rawTranscript, interim, error, start, stop, reset };
}
```

> 주: `SpeechRecognition` 타입은 lib.dom.d.ts에 있으나 `webkitSpeechRecognition`는 없을 수 있음. 필요 시 `apps/dashboard/src/features/memo-compose/lib/speech.d.ts`에 `declare global { interface Window { webkitSpeechRecognition?: ... } }` 앰비언트 선언 추가.

- [ ] **Step 6: typecheck (앰비언트 타입 필요 시 선언 추가)**

```bash
cd apps/dashboard && pnpm typecheck
```

Expected: PASS. `webkitSpeechRecognition` 타입 에러 나면 speech.d.ts 앰비언트 선언 추가 후 재실행.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/features/memo-compose/lib/
git commit -m "feat: Web Speech 훅 + 순수 결과 리듀서 (중복 final 방지)"
```

---

### Task 6: Server Actions (cleanupTranscriptAction + createMemoAction)

**Files:**
- Create: `apps/dashboard/src/features/memo-compose/api/cleanupTranscriptAction.ts`
- Create: `apps/dashboard/src/features/memo-compose/api/createMemoAction.ts`
- Create: `apps/dashboard/src/features/memo-compose/client.ts`
- Test: `apps/dashboard/src/features/memo-compose/api/createMemoAction.test.ts`

**Interfaces:**
- Consumes: `cleanupTranscript` (Task 4), `createMemo`/`deriveTitle` (Task 2·3), `auth` from `@/shared/lib/auth`.
- Produces:
  - `cleanupTranscriptAction(raw: string): Promise<CleanupResult>` ("use server")
  - `createMemoAction(input: { source: MemoSource; rawContent: string; cleanedContent: string; title?: string }): Promise<CreateMemoActionResult>` ("use server")
  - `type CreateMemoActionResult = { kind: "ok"; id: string } | { kind: "invalid" } | { kind: "failed" }`

- [ ] **Step 1: createMemoAction 검증 테스트 (빈 값·title 파생·source 검증)**

`apps/dashboard/src/features/memo-compose/api/createMemoAction.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// auth·createMemo mock — 순수 검증 로직만 태운다.
const createMemoMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  createMemo: (...args: unknown[]) => createMemoMock(...args),
}));
vi.mock("@/entities/memo/client", () => ({
  deriveTitle: (s: string) => (s.trim() ? s.trim().slice(0, 10) : "(제목 없음)"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createMemoAction } from "./createMemoAction";

beforeEach(() => createMemoMock.mockReset().mockResolvedValue({ id: "m1" }));

describe("createMemoAction", () => {
  it("빈 cleanedContent는 invalid", async () => {
    const r = await createMemoAction({ source: "text", rawContent: "", cleanedContent: "  " });
    expect(r.kind).toBe("invalid");
    expect(createMemoMock).not.toHaveBeenCalled();
  });
  it("잘못된 source는 invalid", async () => {
    const r = await createMemoAction({ source: "x" as never, rawContent: "a", cleanedContent: "a" });
    expect(r.kind).toBe("invalid");
  });
  it("title 미입력 시 cleaned에서 파생해 저장한다", async () => {
    await createMemoAction({ source: "text", rawContent: "원문", cleanedContent: "정리본 텍스트" });
    expect(createMemoMock).toHaveBeenCalledWith(expect.objectContaining({ title: "정리본 텍스트", userId: "u1" }));
  });
  it("성공 시 ok + id", async () => {
    const r = await createMemoAction({ source: "text", rawContent: "a", cleanedContent: "a", title: "제목" });
    expect(r).toEqual({ kind: "ok", id: "m1" });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/api/createMemoAction.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: cleanupTranscriptAction 구현**

`apps/dashboard/src/features/memo-compose/api/cleanupTranscriptAction.ts`:

```typescript
"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { cleanupTranscript, type CleanupResult } from "../lib/cleanup-transcript";

export async function cleanupTranscriptAction(raw: string): Promise<CleanupResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return cleanupTranscript(raw);
}

export type { CleanupResult };
```

- [ ] **Step 4: createMemoAction 구현**

`apps/dashboard/src/features/memo-compose/api/createMemoAction.ts`:

```typescript
"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { createMemo } from "@/entities/memo/server";
import { deriveTitle, type MemoSource } from "@/entities/memo/client";

export interface CreateMemoInputAction {
  source: MemoSource;
  rawContent: string;
  cleanedContent: string;
  title?: string;
}

export type CreateMemoActionResult =
  | { kind: "ok"; id: string }
  | { kind: "invalid" }
  | { kind: "failed" };

export async function createMemoAction(
  input: CreateMemoInputAction,
): Promise<CreateMemoActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  const raw = input.rawContent.trim();
  const cleaned = input.cleanedContent.trim();
  if (raw.length === 0 || cleaned.length === 0) return { kind: "invalid" };
  if (input.source !== "voice" && input.source !== "text") return { kind: "invalid" };

  const title = input.title?.trim() || deriveTitle(cleaned);

  return createMemo({ userId, source: input.source, title, rawContent: raw, cleanedContent: cleaned })
    .then(
      (memo) => {
        revalidatePath("/memos");
        return { kind: "ok" as const, id: memo.id };
      },
      () => ({ kind: "failed" as const }),
    );
}
```

- [ ] **Step 5: client barrel 작성 (seam)**

`apps/dashboard/src/features/memo-compose/client.ts`:

```typescript
// features/memo-compose — client-safe entrypoint. Server Action만 re-export.
// server-only 함수(cleanup-transcript, memoRepo)가 client 번들로 새지 않게 분리 (Gotcha #7).
export { cleanupTranscriptAction } from "./api/cleanupTranscriptAction";
export type { CleanupResult } from "./api/cleanupTranscriptAction";
export { createMemoAction } from "./api/createMemoAction";
export type { CreateMemoInputAction, CreateMemoActionResult } from "./api/createMemoAction";
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/api/createMemoAction.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/features/memo-compose/api/ apps/dashboard/src/features/memo-compose/client.ts
git commit -m "feat: memo-compose Server Actions (클린업 + 승인 저장)"
```

---

### Task 7: localStorage 초안 저장

**Files:**
- Create: `apps/dashboard/src/features/memo-compose/lib/memoDraftStorage.ts`
- Test: `apps/dashboard/src/features/memo-compose/lib/memoDraftStorage.test.ts`

**Interfaces:**
- Produces:
  - `type MemoDraft = { rawContent: string; cleanedContent: string; title: string; savedAt: number }`
  - `saveDraft(d: MemoDraft): void`, `loadDraft(): MemoDraft | null`, `clearDraft(): void`

- [ ] **Step 1: 테스트 작성 (jsdom localStorage)**

`apps/dashboard/src/features/memo-compose/lib/memoDraftStorage.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveDraft, loadDraft, clearDraft } from "./memoDraftStorage";

beforeEach(() => localStorage.clear());

describe("memoDraftStorage", () => {
  const draft = { rawContent: "원문", cleanedContent: "정리본", title: "제목", savedAt: 1234 };
  it("save → load 왕복", () => {
    saveDraft(draft);
    expect(loadDraft()).toEqual(draft);
  });
  it("초안 없으면 null", () => {
    expect(loadDraft()).toBeNull();
  });
  it("clear 후 null", () => {
    saveDraft(draft);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
  it("손상된 JSON은 null (throw 안 함)", () => {
    localStorage.setItem("memo-draft-v1", "{not json");
    expect(loadDraft()).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/lib/memoDraftStorage.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: 구현**

`apps/dashboard/src/features/memo-compose/lib/memoDraftStorage.ts`:

```typescript
// 승인 전 메모 초안 — 이 기기 localStorage에만 임시 저장 (유실 방지, 서버 무저장).
const KEY = "memo-draft-v1";

export interface MemoDraft {
  rawContent: string;
  cleanedContent: string;
  title: string;
  savedAt: number;
}

export function saveDraft(d: MemoDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* quota 초과 등 — 초안 저장은 best-effort */
  }
}

export function loadDraft(): MemoDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MemoDraft;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-compose/lib/memoDraftStorage.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/memo-compose/lib/memoDraftStorage.ts apps/dashboard/src/features/memo-compose/lib/memoDraftStorage.test.ts
git commit -m "feat: 메모 초안 localStorage 임시저장 (승인 전 유실 방지)"
```

---

### Task 8: memo-manage Server Actions (update + delete)

**Files:**
- Create: `apps/dashboard/src/features/memo-manage/api/updateMemoAction.ts`
- Create: `apps/dashboard/src/features/memo-manage/api/deleteMemoAction.ts`
- Create: `apps/dashboard/src/features/memo-manage/client.ts`
- Test: `apps/dashboard/src/features/memo-manage/api/memoManageActions.test.ts`

**Interfaces:**
- Consumes: `updateMemo`/`deleteMemo` (Task 3), `deriveTitle` (Task 2), `auth`.
- Produces:
  - `updateMemoAction(id: string, patch: { title?: string; cleanedContent: string }): Promise<{ kind: "ok" } | { kind: "invalid" } | { kind: "not-found" }>`
  - `deleteMemoAction(id: string): Promise<{ kind: "ok" } | { kind: "not-found" }>`

- [ ] **Step 1: 검증 테스트 작성**

`apps/dashboard/src/features/memo-manage/api/memoManageActions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  updateMemo: (...a: unknown[]) => updateMock(...a),
  deleteMemo: (...a: unknown[]) => deleteMock(...a),
}));
vi.mock("@/entities/memo/client", () => ({ deriveTitle: (s: string) => s.trim().slice(0, 10) || "(제목 없음)" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateMemoAction } from "./updateMemoAction";
import { deleteMemoAction } from "./deleteMemoAction";

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ id: "m1" });
  deleteMock.mockReset().mockResolvedValue(true);
});

describe("updateMemoAction", () => {
  it("빈 cleanedContent는 invalid", async () => {
    expect((await updateMemoAction("m1", { cleanedContent: "  " })).kind).toBe("invalid");
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("title 미입력 시 파생", async () => {
    await updateMemoAction("m1", { cleanedContent: "새 정리본" });
    expect(updateMock).toHaveBeenCalledWith("u1", "m1", expect.objectContaining({ title: "새 정리본" }));
  });
  it("소유 아님(updateMemo null)이면 not-found", async () => {
    updateMock.mockResolvedValue(null);
    expect((await updateMemoAction("m1", { cleanedContent: "x" })).kind).toBe("not-found");
  });
});

describe("deleteMemoAction", () => {
  it("삭제 성공 ok", async () => {
    expect((await deleteMemoAction("m1")).kind).toBe("ok");
  });
  it("소유 아님(false)이면 not-found", async () => {
    deleteMock.mockResolvedValue(false);
    expect((await deleteMemoAction("m1")).kind).toBe("not-found");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-manage/api/memoManageActions.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: updateMemoAction 구현**

`apps/dashboard/src/features/memo-manage/api/updateMemoAction.ts`:

```typescript
"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { updateMemo } from "@/entities/memo/server";
import { deriveTitle } from "@/entities/memo/client";

export type UpdateMemoResult = { kind: "ok" } | { kind: "invalid" } | { kind: "not-found" };

export async function updateMemoAction(
  id: string,
  patch: { title?: string; cleanedContent: string },
): Promise<UpdateMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const cleaned = patch.cleanedContent.trim();
  if (cleaned.length === 0) return { kind: "invalid" };
  const title = patch.title?.trim() || deriveTitle(cleaned);

  return updateMemo(session.user.id, id, { title, cleanedContent: cleaned }).then(
    (memo) => {
      if (!memo) return { kind: "not-found" as const };
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "not-found" as const }),
  );
}
```

- [ ] **Step 4: deleteMemoAction 구현**

`apps/dashboard/src/features/memo-manage/api/deleteMemoAction.ts`:

```typescript
"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { deleteMemo } from "@/entities/memo/server";

export type DeleteMemoResult = { kind: "ok" } | { kind: "not-found" };

export async function deleteMemoAction(id: string): Promise<DeleteMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return deleteMemo(session.user.id, id).then(
    (deleted) => {
      if (!deleted) return { kind: "not-found" as const };
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "not-found" as const }),
  );
}
```

- [ ] **Step 5: client barrel**

`apps/dashboard/src/features/memo-manage/client.ts`:

```typescript
// features/memo-manage — client-safe entrypoint. Server Action만 re-export.
export { updateMemoAction } from "./api/updateMemoAction";
export type { UpdateMemoResult } from "./api/updateMemoAction";
export { deleteMemoAction } from "./api/deleteMemoAction";
export type { DeleteMemoResult } from "./api/deleteMemoAction";
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd apps/dashboard && pnpm vitest run src/features/memo-manage/api/memoManageActions.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/features/memo-manage/
git commit -m "feat: memo-manage Server Actions (편집·삭제, 소유 격리)"
```

---

### Task 9: UI — MemoCard (entity, 표시 전용)

**Files:**
- Create: `apps/dashboard/src/entities/memo/ui/MemoCard.tsx`

**Interfaces:**
- Consumes: `Memo` (Task 2).
- Produces: `MemoCard` — 표시 전용. edit/delete는 props 콜백 주입 (entity가 feature 액션을 모름).

- [ ] **Step 1: MemoCard 구현 (표시 전용 + 원문/정리본 토글)**

`apps/dashboard/src/entities/memo/ui/MemoCard.tsx`:

```typescript
"use client";
import { useState } from "react";
import type { Memo } from "../model/types";

interface MemoCardProps {
  memo: Memo;
  onEdit?: (memo: Memo) => void;
  onDelete?: (id: string) => void;
}

// locale-free 시각 포맷 (hydration mismatch 방지 — Gotcha #3).
function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MemoCard({ memo, onEdit, onDelete }: MemoCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const isVoice = memo.source === "voice";
  const body = showRaw ? memo.rawContent : memo.cleanedContent;

  return (
    <article className="rounded-lg border border-neutral-200 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-900">{memo.title}</h3>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500">
          {isVoice ? "🎙 음성" : "✍ 텍스트"}
        </span>
      </header>
      <p className="whitespace-pre-wrap text-sm text-neutral-700">{body}</p>
      <footer className="mt-3 flex items-center gap-3 text-xs text-neutral-400">
        <time>{formatTime(memo.createdAt)}</time>
        {isVoice && (
          <button type="button" onClick={() => setShowRaw((v) => !v)} className="hover:text-neutral-700">
            {showRaw ? "정리본 보기" : "원문 보기"}
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={() => onEdit(memo)} className="hover:text-neutral-700">
            편집
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={() => onDelete(memo.id)} className="hover:text-red-600">
            삭제
          </button>
        )}
      </footer>
    </article>
  );
}
```

- [ ] **Step 2: typecheck + build (seam 검증)**

```bash
cd apps/dashboard && pnpm typecheck && pnpm build
```

Expected: PASS. build가 통과해야 client/server seam 위반 없음 확인.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/entities/memo/ui/MemoCard.tsx
git commit -m "feat: MemoCard (표시 전용 + 음성 원문/정리본 토글)"
```

---

### Task 10: UI — MemoComposer (녹음·텍스트·클린업·승인)

**Files:**
- Create: `apps/dashboard/src/features/memo-compose/ui/MemoComposer.tsx`

**Interfaces:**
- Consumes: `useSpeechRecognition` (Task 5), `cleanupTranscriptAction`/`createMemoAction` (Task 6 via client.ts), draft storage (Task 7).
- Produces: `MemoComposer` — 대시보드/페이지에서 사용.

- [ ] **Step 1: MemoComposer 구현**

`apps/dashboard/src/features/memo-compose/ui/MemoComposer.tsx`:

```typescript
"use client";
import { useState } from "react";
import { useSpeechRecognition } from "../lib/useSpeechRecognition";
import { saveDraft, clearDraft } from "../lib/memoDraftStorage";
import { cleanupTranscriptAction, createMemoAction } from "../client";

type Mode = "idle" | "cleaning" | "preview";
type Tab = "voice" | "text";

export function MemoComposer() {
  const speech = useSpeechRecognition();
  const [tab, setTab] = useState<Tab>(speech.isSupported ? "voice" : "text");
  const [mode, setMode] = useState<Mode>("idle");
  const [cleaned, setCleaned] = useState("");
  const [title, setTitle] = useState("");
  const [textInput, setTextInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 음성: 녹음 종료 → 클린업 → 미리보기
  function handleStopAndClean() {
    speech.stop();
    const raw = speech.rawTranscript.trim();
    if (!raw) {
      setNotice("녹음된 내용이 없습니다.");
      return;
    }
    setMode("cleaning");
    saveDraft({ rawContent: raw, cleanedContent: "", title: "", savedAt: Date.now() });
    cleanupTranscriptAction(raw).then(
      (result) => {
        const text = result.kind === "ok" ? result.cleaned : raw;
        if (result.kind !== "ok") setNotice("AI 정리 실패 — 원문으로 진행하거나 재시도하세요.");
        setCleaned(text);
        saveDraft({ rawContent: raw, cleanedContent: text, title: "", savedAt: Date.now() });
        setMode("preview");
      },
      () => {
        setCleaned(raw);
        setNotice("AI 정리 실패 — 원문으로 진행하거나 재시도하세요.");
        setMode("preview");
      },
    );
  }

  // 음성 승인 저장
  function handleApprove() {
    const raw = speech.rawTranscript.trim();
    setSaving(true);
    createMemoAction({ source: "voice", rawContent: raw, cleanedContent: cleaned.trim(), title }).then(
      (r) => {
        setSaving(false);
        if (r.kind === "ok") {
          clearDraft();
          resetVoice();
          setNotice("저장되었습니다.");
        } else {
          setNotice(r.kind === "invalid" ? "내용이 비어 있습니다." : "저장에 실패했습니다.");
        }
      },
      () => {
        setSaving(false);
        setNotice("저장에 실패했습니다.");
      },
    );
  }

  function resetVoice() {
    speech.reset();
    setCleaned("");
    setTitle("");
    setMode("idle");
  }

  // 텍스트 바로 저장
  function handleSaveText() {
    const text = textInput.trim();
    if (!text) {
      setNotice("내용을 입력하세요.");
      return;
    }
    setSaving(true);
    createMemoAction({ source: "text", rawContent: text, cleanedContent: text, title }).then(
      (r) => {
        setSaving(false);
        if (r.kind === "ok") {
          setTextInput("");
          setTitle("");
          setNotice("저장되었습니다.");
        } else {
          setNotice("저장에 실패했습니다.");
        }
      },
      () => {
        setSaving(false);
        setNotice("저장에 실패했습니다.");
      },
    );
  }

  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("voice")}
          disabled={!speech.isSupported}
          className={tab === "voice" ? "font-semibold" : "text-neutral-400"}
        >
          🎙 음성
        </button>
        <button type="button" onClick={() => setTab("text")} className={tab === "text" ? "font-semibold" : "text-neutral-400"}>
          ✍ 텍스트
        </button>
      </div>

      {!speech.isSupported && tab === "voice" && (
        <p className="text-sm text-amber-600">이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트 메모를 이용하세요.</p>
      )}

      {tab === "voice" && speech.isSupported && (
        <div className="space-y-3">
          {mode === "idle" && (
            <>
              {!speech.isRecording ? (
                <button type="button" onClick={speech.start} className="rounded bg-neutral-900 px-4 py-2 text-white">
                  녹음 시작
                </button>
              ) : (
                <button type="button" onClick={handleStopAndClean} className="rounded bg-red-600 px-4 py-2 text-white">
                  녹음 종료 · AI 정리
                </button>
              )}
              {speech.isRecording && (
                <p className="text-sm text-neutral-500">
                  {speech.rawTranscript}
                  <span className="text-neutral-400">{speech.interim}</span>
                </p>
              )}
              {speech.error === "not-allowed" && (
                <p className="text-sm text-red-600">마이크 권한이 거부되었습니다. 텍스트 메모를 이용하세요.</p>
              )}
            </>
          )}
          {mode === "cleaning" && <p className="text-sm text-neutral-500">AI가 정리하는 중…</p>}
          {mode === "preview" && (
            <>
              <p className="text-xs text-neutral-400">AI 정리는 텍스트를 서버로 전송합니다. 검토 후 승인하세요.</p>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="제목 (선택 — 비우면 자동)"
                className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <textarea
                value={cleaned}
                onChange={(e) => setCleaned(e.target.value)}
                rows={6}
                className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleApprove} disabled={saving} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
                  {saving ? "저장 중…" : "승인 · 저장"}
                </button>
                <button type="button" onClick={resetVoice} disabled={saving} className="rounded border px-4 py-2">
                  취소
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "text" && (
        <div className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 (선택)"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            rows={5}
            placeholder="메모 입력…"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <button type="button" onClick={handleSaveText} disabled={saving} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {notice && <p className="mt-2 text-sm text-neutral-500">{notice}</p>}
    </section>
  );
}
```

- [ ] **Step 2: typecheck + build (seam 검증 — client가 client.ts만 import하는지)**

```bash
cd apps/dashboard && pnpm typecheck && pnpm build
```

Expected: PASS. `Module not found: 'net'/'tls'` 나면 seam 위반 — client가 server-only를 import한 것.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/memo-compose/ui/MemoComposer.tsx
git commit -m "feat: MemoComposer (녹음·텍스트·AI정리·승인 UI)"
```

---

### Task 11: UI — MemoList (편집·삭제)

**Files:**
- Create: `apps/dashboard/src/features/memo-manage/ui/MemoList.tsx`

**Interfaces:**
- Consumes: `MemoCard` (Task 9), `updateMemoAction`/`deleteMemoAction` (Task 8 via client.ts), `Memo` (Task 2).
- Produces: `MemoList` — 목록 + 인라인 편집.

- [ ] **Step 1: MemoList 구현**

`apps/dashboard/src/features/memo-manage/ui/MemoList.tsx`:

```typescript
"use client";
import { useState } from "react";
import type { Memo } from "@/entities/memo/client";
import { MemoCard } from "@/entities/memo/ui/MemoCard";
import { updateMemoAction, deleteMemoAction } from "../client";

interface MemoListProps {
  memos: Memo[];
}

export function MemoList({ memos }: MemoListProps) {
  const [editing, setEditing] = useState<Memo | null>(null);
  const [draft, setDraft] = useState({ title: "", cleaned: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function startEdit(memo: Memo) {
    setEditing(memo);
    setDraft({ title: memo.title, cleaned: memo.cleanedContent });
  }

  function saveEdit() {
    if (!editing) return;
    setBusy(true);
    updateMemoAction(editing.id, { title: draft.title, cleanedContent: draft.cleaned }).then(
      (r) => {
        setBusy(false);
        if (r.kind === "ok") {
          setEditing(null);
        } else {
          setNotice(r.kind === "invalid" ? "내용이 비어 있습니다." : "메모를 찾을 수 없습니다.");
        }
      },
      () => {
        setBusy(false);
        setNotice("수정에 실패했습니다.");
      },
    );
  }

  function handleDelete(id: string) {
    setBusy(true);
    deleteMemoAction(id).then(
      () => setBusy(false),
      () => {
        setBusy(false);
        setNotice("삭제에 실패했습니다.");
      },
    );
  }

  if (memos.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-400">아직 메모가 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {notice && <p className="text-sm text-neutral-500">{notice}</p>}
      {memos.map((memo) =>
        editing?.id === memo.id ? (
          <div key={memo.id} className="space-y-2 rounded-lg border border-neutral-300 p-4">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <textarea
              value={draft.cleaned}
              onChange={(e) => setDraft((d) => ({ ...d, cleaned: e.target.value }))}
              rows={5}
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button type="button" onClick={saveEdit} disabled={busy} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                저장
              </button>
              <button type="button" onClick={() => setEditing(null)} disabled={busy} className="rounded border px-3 py-1.5 text-sm">
                취소
              </button>
            </div>
          </div>
        ) : (
          <MemoCard key={memo.id} memo={memo} onEdit={startEdit} onDelete={handleDelete} />
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck + build**

```bash
cd apps/dashboard && pnpm typecheck && pnpm build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/memo-manage/ui/MemoList.tsx
git commit -m "feat: MemoList (인라인 편집·삭제)"
```

---

### Task 12: widget/memo + /memos 페이지 + 메인 요약 위젯

**Files:**
- Create: `apps/dashboard/src/widgets/memo/ui/MemoWidget.tsx`
- Create: `apps/dashboard/src/widgets/memo/ui/RecentMemos.tsx`
- Create: `apps/dashboard/src/app/(dashboard)/memos/page.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/page.tsx` (메인에 최근 메모 요약 추가)

**Interfaces:**
- Consumes: `MemoComposer` (Task 10), `MemoList` (Task 11), `listMemos` (Task 3), `auth`.
- Produces: `/memos` 라우트, 메인 요약.

- [ ] **Step 1: MemoWidget (composer + list 조합)**

`apps/dashboard/src/widgets/memo/ui/MemoWidget.tsx`:

```typescript
import { MemoComposer } from "@/features/memo-compose/ui/MemoComposer";
import { MemoList } from "@/features/memo-manage/ui/MemoList";
import type { Memo } from "@/entities/memo/client";

interface MemoWidgetProps {
  memos: Memo[];
}

export function MemoWidget({ memos }: MemoWidgetProps) {
  return (
    <div className="space-y-6">
      <MemoComposer />
      <MemoList memos={memos} />
    </div>
  );
}
```

- [ ] **Step 2: RecentMemos (메인 요약 — 최근 3개, 읽기 전용)**

`apps/dashboard/src/widgets/memo/ui/RecentMemos.tsx`:

```typescript
import Link from "next/link";
import type { Memo } from "@/entities/memo/client";

interface RecentMemosProps {
  memos: Memo[];
}

export function RecentMemos({ memos }: RecentMemosProps) {
  const recent = memos.slice(0, 3);
  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">최근 메모</h2>
        <Link href="/memos" className="text-sm text-neutral-500 hover:text-neutral-900">
          전체 보기 →
        </Link>
      </header>
      {recent.length === 0 ? (
        <p className="text-sm text-neutral-400">아직 메모가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {recent.map((m) => (
            <li key={m.id} className="truncate text-sm text-neutral-700">
              <span className="text-neutral-400">{m.source === "voice" ? "🎙" : "✍"}</span> {m.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: /memos 페이지 (RSC)**

`apps/dashboard/src/app/(dashboard)/memos/page.tsx`:

```typescript
import { auth } from "@/shared/lib/auth";
import { listMemos } from "@/entities/memo/server";
import { MemoWidget } from "@/widgets/memo/ui/MemoWidget";

export default async function MemosPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // 미들웨어가 로그인 리다이렉트 처리
  const memos = await listMemos(session.user.id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">메모</h1>
      <MemoWidget memos={memos} />
    </main>
  );
}
```

- [ ] **Step 4: 메인 페이지에 RecentMemos 추가**

`apps/dashboard/src/app/(dashboard)/page.tsx`를 열어 기존 위젯 배치 구조를 확인하고, `listMemos`로 메모를 가져와 `<RecentMemos memos={...} />`를 적절한 위치에 추가. 기존 `const session = await auth()`를 재사용하고, import 추가:

```typescript
import { listMemos } from "@/entities/memo/server";
import { RecentMemos } from "@/widgets/memo/ui/RecentMemos";
// ... 렌더 안에서:
// const memos = session?.user?.id ? await listMemos(session.user.id) : [];
// <RecentMemos memos={memos} />
```

> 주: 기존 page.tsx 레이아웃(grid/컬럼 구조)을 먼저 Read로 확인 후, 다른 위젯과 같은 컨테이너 스타일로 배치. 기존 코드 스타일 매치.

- [ ] **Step 5: typecheck + lint + build (전체 게이트)**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build
```

Expected: PASS 전부.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/widgets/memo/ apps/dashboard/src/app/'(dashboard)'/memos/ apps/dashboard/src/app/'(dashboard)'/page.tsx
git commit -m "feat: memo 위젯 + /memos 페이지 + 메인 최근 메모 요약"
```

---

### Task 13: 네비게이션 링크 + 전체 검증

**Files:**
- Modify: `apps/dashboard/src/widgets/app-shell/*` (네비 트리에 메모 링크 추가 — 실제 파일은 Read로 확인)

**Interfaces:**
- Consumes: 기존 app-shell 네비 구조.

- [ ] **Step 1: 네비게이션에 메모 링크 추가**

app-shell(또는 사이드바/네비) 컴포넌트를 Grep으로 찾는다:

```bash
cd apps/dashboard
grep -rn "href=\"/stocks\"\|href=\"/skills\"\|href=\"/agents\"" src/widgets/app-shell/ src/app/'(dashboard)'/layout.tsx 2>/dev/null | head
```

찾은 네비 구조에 기존 링크와 같은 형식으로 `{ href: "/memos", label: "메모" }` (또는 해당 컴포넌트 컨벤션) 추가. 아이콘/순서는 기존 항목 스타일 매치.

- [ ] **Step 2: 전체 게이트 재실행**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build
```

Expected: PASS 전부.

- [ ] **Step 3: 전체 테스트**

```bash
cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test 2>&1 | tail -20
```

Expected: memo 관련 테스트 전부 PASS (DB 미기동 통합 테스트는 ECONNREFUSED 허용 — Gotcha #2).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/app-shell/ apps/dashboard/src/app/'(dashboard)'/layout.tsx
git commit -m "feat: 네비게이션에 메모 링크 추가"
```

---

### Task 14: PR 생성 + 운영 마이그레이션 준비

**Files:** (없음 — git/배포)

- [ ] **Step 1: 브랜치 푸시 + PR 생성**

```bash
cd /home/gon/projects/gon/gons-dashboard
git push -u origin feat/voice-text-memo
gh pr create --title "feat: 텍스트/음성 메모 기능" --body "$(cat <<'EOF'
## 요약
개인 대시보드에 텍스트/음성 메모 캡처 기능 추가.
- 음성: Web Speech API 실시간 받아쓰기 → AI 클린업(sonnet-5) → 승인 후 저장
- 텍스트: AI 없이 바로 저장. 원문+정리본 둘 다 보관
- FSD 3계층(entity/memo + feature/memo-compose·memo-manage + widget/memo + /memos)

## 스펙·계획
- 스펙: docs/superpowers/specs/2026-07-09-voice-text-memo-design.md
- 계획: docs/superpowers/plans/2026-07-09-voice-text-memo.md

## 테스트
- deriveTitle·클린업 스키마·Web Speech 리듀서·Server Action 검증·DB CRUD 소유격리
- typecheck + lint + build 통과

## 배포 주의 (운영 마이그레이션)
- 운영은 psql BEGIN/COMMIT으로 memos 테이블 먼저 생성 후 이미지 교체 (drizzle-kit migrate prod broken)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Rg45ggbYq4cfxCq5KRe2ba
EOF
)"
```

- [ ] **Step 2: 운영 마이그레이션 SQL 확인**

`apps/dashboard/drizzle/00XX_*.sql`(Task 1에서 생성)의 memos CREATE TABLE + 인덱스 + CHECK를 확인. 이 SQL을 운영 psql에 BEGIN/COMMIT으로 적용할 준비 (실제 적용은 PR 머지 후 배포 단계에서 사용자 확인 하에).

- [ ] **Step 3: CI 통과 대기 + 배포는 사용자 확인 후**

PR CI(Lint & Type Check) 통과 확인. 머지·운영 배포·마이그레이션 적용은 **비가역 작업이므로 사용자 승인 후** 진행 (배포 시퀀스: 운영 psql 마이그레이션 먼저 → 이미지 교체 → health/route 검증).

---

## Self-Review

**1. Spec coverage:**
- §2.1 음성 STT → Task 5 ✅ / §2.2 AI 클린업 → Task 4 ✅ / §2.3 원문+정리본 → Task 1·3 ✅
- §2.4 승인 흐름+localStorage → Task 6·7·10 ✅ / §2.5 텍스트 바로 저장 → Task 6·10 ✅
- §2.6 목록·편집·삭제 → Task 8·11 ✅ / §2.7 title 자동파생 → Task 2·6·8 ✅ / §2.8 모델 sonnet → Task 4 ✅
- §2 프라이버시 문구 → Task 10 (preview 안내) ✅
- §3 데이터모델 → Task 1 ✅ / §4 컴포넌트 → Task 2·3·9·10·11·12 ✅ / §5 데이터흐름 → Task 6·10 ✅
- §6 Web Speech 함정 → Task 5 ✅ / §7 클린업 → Task 4 ✅ / §8 에러 → Task 4·6·8·10 ✅ / §9 테스트 → 각 Task ✅

**2. Placeholder scan:** cleanup-transcript의 `analyzeStructured` 시그니처는 "draft-reply.ts 실제 호출부 따를 것"으로 명시(근사치 주의). page.tsx 메인 수정은 "기존 레이아웃 Read 후 매치"로 안내. 나머지 코드 블록은 완결. ✅

**3. Type consistency:**
- `MemoSource='voice'|'text'` — Task 2 정의, Task 6·9 사용 일치.
- `createMemo(input: CreateMemoInput)` — Task 3 정의, Task 6 사용 (`userId`·`source`·`title`·`rawContent`·`cleanedContent`) 일치.
- `deriveTitle(cleaned)` — Task 2 정의, Task 6·8 사용 일치.
- `CleanupResult` — Task 4 정의, Task 6 re-export 일치.
- `updateMemo(userId, id, {title, cleanedContent})` — Task 3 정의, Task 8 사용 일치.
- Server Action 결과 유니온(`{kind}`) — 모든 액션 일관.
