# 메모 스타일 변환 (memo-transform) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장된 메모를 온디맨드로 7가지 스타일(정돈·매끄럽게·요약·구조화·할일·일기체·이메일)로 변환해 병존 보관하고 칩으로 전환한다.

**Architecture:** `memo_transformations` 테이블(메모당 프리셋당 1개, upsert 교체)에 변환본을 병존 저장. 변환은 `cleaned_content` 기준 온디맨드 Server Action(미리보기 → 승인 저장 2단계). LLM은 2층 프롬프트(공통 가드레일 + 프리셋 지시)로 `claude-sonnet-5` 호출. UI는 MemoCard 칩 전환 + TransformDialog(createPortal).

**Tech Stack:** Next.js 16 (App Router, Server Actions), Drizzle ORM + PostgreSQL 16, `@krdn/llm-gateway` `analyzeStructured` + Zod, Vitest(+jsdom/@testing-library/react), Tailwind v4.

**Branch:** `feat/memo-transform` (스펙 커밋 `8e9b520` 존재, `feat/voice-text-memo`에서 분기 — PR #268 머지 후 main으로 rebase).

**Spec:** `docs/superpowers/specs/2026-07-09-memo-transform-design.md`
**Research:** `docs/research/2026-07-09-memo-style-presets-research.md`

### 스펙과의 차이 2건 (계획 확정 사항)

1. **프리셋 라벨은 `entities/memo/model/types.ts`로 이동** (스펙 §4는 preset-meta에 라벨 포함).
   이유: MemoCard(entity ui)가 칩 라벨을 표시해야 하는데 entities는 features를 import할 수
   없다 (FSD 방향). 라벨·ID를 entities에 두고 features가 참조한다 (features→entities 허용).
2. **`transformMemoAction` 결과에 `invalid` 추가** (스펙 §5 유니온에 없음).
   이유: preset 파라미터를 시스템 경계에서 `string`으로 받고 타입가드로 검증한다
   (경계 입력 검증 규칙). 알 수 없는 preset은 `{ kind: "invalid" }`.
3. **`features/memo-transform/index.ts`(server entrypoint) 생략** (스펙 §4에 있음).
   이유: 서버 트리 소비자가 없다 — 액션은 client 트리만 호출하고, lib는 액션이 내부
   경로로 쓴다. memo-manage·memo-compose도 index.ts 없이 client.ts만 두는 관행.
   서버 소비자가 생기면 그때 추가.

## Global Constraints

- 모델: `"claude-sonnet-5"` 고정 (haiku 금지 — cli-proxy 비코딩 생성 거절 이력).
- LLM 입력: `cleaned_content` 기준(raw 아님), trim 후 `MAX_INPUT 4_000`자 절단. `maxOutputTokens: 4_000`.
- 저장 상한: content `20_000`자 (기존 `MAX_MEMO_LEN`과 동일 값).
- 프리셋 7종 확정값 (id / 라벨 / minInputLen / strictPreserve):
  `tidy`/정돈/1/**true**, `polish`/매끄럽게/20/false, `summary`/요약/80/false,
  `structured`/구조화/80/false, `todos`/할 일 추출/20/false, `journal`/일기체/20/false,
  `email`/이메일 초안/20/false.
- 60% 축약 감지(`isDegenerateCleanup`)는 `strictPreserve === true`(tidy)에만 적용.
- todos 프리셋: 할 일이 전혀 없으면 정확히 `"할 일 없음"` 한 줄 (유효 출력, 실패 아님).
- **`"use server"` 파일에서 import한 타입의 재-export(`export type { X };`) 금지** —
  dev 런타임 ReferenceError로 모듈 사망 (파일 내 선언 타입의 export는 안전).
- FSD: entities는 features import 금지. features→features는 허용
  (memo-manage → memo-transform, memo-transform → memo-compose lib 재사용).
- 관측(`logLlmSpend`)은 best-effort — 실패해도 주 경로를 절대 깨지 않는다.
- 시각 표시는 locale-free 포맷 유지 (hydration mismatch 방지).
- DB 통합 테스트는 `TEST_DATABASE_URL` 필요. 로컬 테스트 DB가 없으면:
  ```bash
  docker run -d --rm --name gons-test-db -p 5999:5432 \
    -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
    postgres:16-alpine
  ```
  이후 `apps/dashboard`에서 마이그레이션 적용 후 테스트:
  `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run <파일>`
  (통합 테스트 스위트가 스키마를 요구하므로, 테스트 DB에는 `DATABASE_URL`을 테스트 DB로
  지정한 `pnpm db:migrate`로 전체 마이그레이션을 먼저 적용해 둔다.)
- 모든 명령은 `apps/dashboard/`에서 실행.

---

### Task 1: DB 스키마 + 마이그레이션 0036

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/memo.ts`
- Generate: `apps/dashboard/drizzle/0036_*.sql` (drizzle-kit 자동 명명)

**Interfaces:**
- Consumes: 기존 `memos` 테이블 (같은 파일).
- Produces: `memoTransformations` pgTable — Task 2의 `$inferSelect` 타입·repo가 사용.
  barrel(`shared/lib/db/schema/index.ts`)은 `export * from "./memo"`라 자동 노출.

- [ ] **Step 1: 스키마에 memo_transformations 추가**

`memo.ts`의 import 줄을 다음으로 교체하고(`uniqueIndex` 추가):

```ts
import { pgTable, text, timestamp, uuid, index, uniqueIndex, check } from "drizzle-orm/pg-core";
```

파일 끝(`memos` 정의 뒤)에 추가:

```ts
// memo_transformations: 저장된 메모의 스타일 변환본 (요약·할일 등).
// 메모당 프리셋당 1개 — 재생성은 UNIQUE(memo_id, preset) upsert로 교체.
// 원문(raw)·정리본(cleaned)은 불변, 변환본은 병존 (스펙 2026-07-09-memo-transform).
export const memoTransformations = pgTable(
  "memo_transformations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoId: uuid("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    // TransformPresetId — CHECK 제약으로 강제 (entities/memo/model/types.ts와 동기).
    preset: text("preset").notNull(),
    // 생성에 사용한 모델 (감사용).
    model: text("model").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memo_transformations_memo_preset_uq").on(t.memoId, t.preset),
    check(
      "memo_transformations_preset_check",
      sql`${t.preset} IN ('tidy', 'polish', 'summary', 'structured', 'todos', 'journal', 'email')`,
    ),
    check("memo_transformations_content_not_empty", sql`length(${t.content}) > 0`),
  ],
);
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm db:generate`
Expected: `drizzle/0036_<임의이름>.sql` 생성.
⚠️ snapshot id collision 에러가 나면 새로 생긴 `drizzle/meta/0036_snapshot.json`의
`id`/`prevId` 두 줄만 직전 스냅샷과 체인이 이어지게 수정 (과거 복구 관행).

- [ ] **Step 3: 생성 SQL 검토**

`drizzle/0036_*.sql`을 열어 확인:
- `CREATE TABLE "memo_transformations"` + `memo_id` FK `ON DELETE cascade`
- `CREATE UNIQUE INDEX "memo_transformations_memo_preset_uq"`
- CHECK 2개 (`preset IN (...)`, `length(content) > 0`)
- **기존 테이블에 대한 DROP/ALTER가 없어야 함** (순수 추가). 있으면 스키마 정의 오류 — 수정 후 재생성.

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: 에러 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/db/schema/memo.ts drizzle/
git commit -m "feat: memo_transformations 스키마 + 마이그레이션 0036"
```

---

### Task 2: entities/memo — 변환 타입·라벨 + transform repo (TDD)

**Files:**
- Modify: `apps/dashboard/src/entities/memo/model/types.ts`
- Create: `apps/dashboard/src/entities/memo/api/memoTransformRepo.ts`
- Test: `apps/dashboard/src/entities/memo/api/memoTransformRepo.test.ts`
- Modify: `apps/dashboard/src/entities/memo/server.ts`, `apps/dashboard/src/entities/memo/client.ts`

**Interfaces:**
- Consumes: Task 1의 `memoTransformations` 테이블.
- Produces (이후 모든 태스크가 사용):
  - `type MemoTransformation` (= `$inferSelect`), `type TransformPresetId`,
    `const TRANSFORM_PRESET_IDS: readonly TransformPresetId[]`,
    `const TRANSFORM_PRESET_LABELS: Record<TransformPresetId, string>`
  - `upsertTransformation(input: { memoId: string; preset: TransformPresetId; model: string; content: string }): Promise<MemoTransformation>`
  - `listTransformationsByUser(userId: string): Promise<MemoTransformation[]>`

- [ ] **Step 1: 타입·상수 추가**

`model/types.ts`의 첫 import를 교체:

```ts
import type { memos, memoTransformations } from "@/shared/lib/db/schema";
```

`export type MemoSource = ...` 아래에 추가:

```ts
export type MemoTransformation = typeof memoTransformations.$inferSelect;

// 스타일 변환 프리셋 — DB CHECK(memo_transformations_preset_check)와 동기 유지.
export const TRANSFORM_PRESET_IDS = [
  "tidy",
  "polish",
  "summary",
  "structured",
  "todos",
  "journal",
  "email",
] as const;
export type TransformPresetId = (typeof TRANSFORM_PRESET_IDS)[number];

// 칩·다이얼로그 표시 라벨. entities에 두는 이유: MemoCard(entity ui)는
// features를 import할 수 없다 (FSD 방향) — features/memo-transform이 이걸 참조.
export const TRANSFORM_PRESET_LABELS: Record<TransformPresetId, string> = {
  tidy: "정돈",
  polish: "매끄럽게",
  summary: "요약",
  structured: "구조화",
  todos: "할 일 추출",
  journal: "일기체",
  email: "이메일 초안",
};
```

- [ ] **Step 2: 실패하는 repo 통합 테스트 작성**

`api/memoTransformRepo.test.ts` 전체:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { memos, memoTransformations, users } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMemo } from "./memoRepo";
import { upsertTransformation, listTransformationsByUser } from "./memoTransformRepo";

const USER_ID = "00000000-0000-0000-0000-000000000abd";
const OTHER_ID = "00000000-0000-0000-0000-000000000abe";

beforeAll(async () => {
  await db
    .insert(users)
    .values([
      { id: USER_ID, email: "memo-transform-test@example.com" },
      { id: OTHER_ID, email: "memo-transform-other@example.com" },
    ])
    .onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(memos).where(eq(memos.userId, USER_ID));
  await db.delete(memos).where(eq(memos.userId, OTHER_ID));
});

const base = { userId: USER_ID, source: "text" as const, title: "제목", rawContent: "원문", cleanedContent: "원문" };

describe("memoTransformRepo", () => {
  it("같은 (memo, preset) 재저장은 교체한다 (새 행 아님)", async () => {
    const memo = await createMemo(base);
    const first = await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m1", content: "v1" });
    const second = await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m2", content: "v2" });
    expect(second.id).toBe(first.id);
    const list = await listTransformationsByUser(USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("v2");
    expect(list[0].model).toBe("m2");
  });

  it("다른 preset은 병존한다", async () => {
    const memo = await createMemo(base);
    await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m", content: "요약" });
    await upsertTransformation({ memoId: memo.id, preset: "todos", model: "m", content: "- [ ] 할일" });
    expect(await listTransformationsByUser(USER_ID)).toHaveLength(2);
  });

  it("listTransformationsByUser는 소유자 것만 반환한다", async () => {
    const mine = await createMemo(base);
    const others = await createMemo({ ...base, userId: OTHER_ID });
    await upsertTransformation({ memoId: mine.id, preset: "summary", model: "m", content: "a" });
    await upsertTransformation({ memoId: others.id, preset: "summary", model: "m", content: "b" });
    const list = await listTransformationsByUser(USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0].memoId).toBe(mine.id);
  });

  it("메모 삭제 시 변환본이 cascade 삭제된다", async () => {
    const memo = await createMemo(base);
    await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m", content: "a" });
    await db.delete(memos).where(eq(memos.id, memo.id));
    const rows = await db.select().from(memoTransformations).where(eq(memoTransformations.memoId, memo.id));
    expect(rows).toHaveLength(0);
  });

  it("허용 외 preset은 CHECK 제약으로 거부된다", async () => {
    const memo = await createMemo(base);
    await expect(
      upsertTransformation({ memoId: memo.id, preset: "nope" as never, model: "m", content: "a" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoTransformRepo.test.ts`
Expected: FAIL — `Cannot find module './memoTransformRepo'` (또는 그에 준하는 import 에러).
⚠️ 테스트 DB에 0036이 아직 없으므로 이 태스크 전에 테스트 DB에 마이그레이션 적용
(Global Constraints 참조). ECONNREFUSED면 테스트 DB 컨테이너 미기동 — 기동 후 재시도.

- [ ] **Step 4: repo 구현**

`api/memoTransformRepo.ts` 전체:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memos, memoTransformations } from "@/shared/lib/db/schema";
import type { MemoTransformation, TransformPresetId } from "../model/types";

export interface UpsertTransformationInput {
  memoId: string;
  preset: TransformPresetId;
  model: string;
  content: string;
}

/** 메모당 프리셋당 1개 — 재저장은 교체 (UNIQUE(memo_id, preset) upsert). */
export async function upsertTransformation(input: UpsertTransformationInput): Promise<MemoTransformation> {
  const rows = await db
    .insert(memoTransformations)
    .values(input)
    .onConflictDoUpdate({
      target: [memoTransformations.memoId, memoTransformations.preset],
      set: { content: input.content, model: input.model, updatedAt: new Date() },
    })
    .returning();
  return rows[0];
}

/** 소유자 메모들의 변환본 전체 — /memos 페이지 1쿼리 로드용 (N+1 회피). */
export async function listTransformationsByUser(userId: string): Promise<MemoTransformation[]> {
  const rows = await db
    .select({ transformation: memoTransformations })
    .from(memoTransformations)
    .innerJoin(memos, eq(memoTransformations.memoId, memos.id))
    .where(eq(memos.userId, userId));
  return rows.map((r) => r.transformation);
}
```

- [ ] **Step 5: barrel 갱신**

`server.ts` 전체를 다음으로 교체:

```ts
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
export {
  upsertTransformation,
  listTransformationsByUser,
  type UpsertTransformationInput,
} from "./api/memoTransformRepo";
export type { Memo, MemoSource, MemoTransformation, TransformPresetId } from "./model/types";
```

`client.ts` 전체를 다음으로 교체:

```ts
// entities/memo — client-safe entrypoint.
export type { Memo, MemoSource, MemoTransformation, TransformPresetId } from "./model/types";
export { deriveTitle, TRANSFORM_PRESET_IDS, TRANSFORM_PRESET_LABELS } from "./model/types";
export { MemoCard } from "./ui/MemoCard";
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoTransformRepo.test.ts`
Expected: PASS 5/5.

- [ ] **Step 7: Commit**

```bash
git add src/entities/memo
git commit -m "feat: memo 변환본 타입·라벨 + transform repo (upsert 교체·목록·cascade)"
```

---

### Task 3: 프리셋 메타 (client-safe) — TDD

**Files:**
- Create: `apps/dashboard/src/features/memo-transform/lib/preset-meta.ts`
- Test: `apps/dashboard/src/features/memo-transform/lib/preset-meta.test.ts`

**Interfaces:**
- Consumes: `TRANSFORM_PRESET_IDS`, `TransformPresetId` (`@/entities/memo/client`, Task 2).
- Produces: `TRANSFORM_PRESETS: Record<TransformPresetId, TransformPresetMeta>`
  (`TransformPresetMeta = { id, minInputLen, strictPreserve }`),
  `isTransformPresetId(v: string): v is TransformPresetId`.
  라벨은 여기 없음 — `TRANSFORM_PRESET_LABELS`(entities) 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`preset-meta.test.ts` 전체:

```ts
import { describe, it, expect } from "vitest";
import { TRANSFORM_PRESETS, isTransformPresetId } from "./preset-meta";
import { TRANSFORM_PRESET_IDS } from "@/entities/memo/client";

describe("TRANSFORM_PRESETS", () => {
  it("7종 전부 정의되고 id가 키와 일치한다", () => {
    expect(Object.keys(TRANSFORM_PRESETS).sort()).toEqual([...TRANSFORM_PRESET_IDS].sort());
    for (const id of TRANSFORM_PRESET_IDS) expect(TRANSFORM_PRESETS[id].id).toBe(id);
  });
  it("tidy만 strictPreserve", () => {
    for (const id of TRANSFORM_PRESET_IDS) {
      expect(TRANSFORM_PRESETS[id].strictPreserve).toBe(id === "tidy");
    }
  });
  it("minInputLen 스펙 확정값", () => {
    expect(TRANSFORM_PRESETS.tidy.minInputLen).toBe(1);
    expect(TRANSFORM_PRESETS.polish.minInputLen).toBe(20);
    expect(TRANSFORM_PRESETS.summary.minInputLen).toBe(80);
    expect(TRANSFORM_PRESETS.structured.minInputLen).toBe(80);
    expect(TRANSFORM_PRESETS.todos.minInputLen).toBe(20);
    expect(TRANSFORM_PRESETS.journal.minInputLen).toBe(20);
    expect(TRANSFORM_PRESETS.email.minInputLen).toBe(20);
  });
});

describe("isTransformPresetId", () => {
  it("유효/무효 판별", () => {
    expect(isTransformPresetId("summary")).toBe(true);
    expect(isTransformPresetId("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/features/memo-transform/lib/preset-meta.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`preset-meta.ts` 전체:

```ts
// features/memo-transform — client-safe 프리셋 메타.
// 프롬프트 instruction은 server-only ./prompts.ts (client 번들 격리).
// 라벨은 entities/memo의 TRANSFORM_PRESET_LABELS (MemoCard 칩이 써야 해서 entity에 위치).
import { TRANSFORM_PRESET_IDS, type TransformPresetId } from "@/entities/memo/client";

export interface TransformPresetMeta {
  id: TransformPresetId;
  /** cleaned_content(trim) 길이가 이 값 미만이면 프리셋 비활성. 서버도 재검증. */
  minInputLen: number;
  /** true(tidy)만 60% 축약 감지 적용 — 요약 계열은 축약이 정상. */
  strictPreserve: boolean;
}

export const TRANSFORM_PRESETS: Record<TransformPresetId, TransformPresetMeta> = {
  tidy: { id: "tidy", minInputLen: 1, strictPreserve: true },
  polish: { id: "polish", minInputLen: 20, strictPreserve: false },
  summary: { id: "summary", minInputLen: 80, strictPreserve: false },
  structured: { id: "structured", minInputLen: 80, strictPreserve: false },
  todos: { id: "todos", minInputLen: 20, strictPreserve: false },
  journal: { id: "journal", minInputLen: 20, strictPreserve: false },
  email: { id: "email", minInputLen: 20, strictPreserve: false },
};

export function isTransformPresetId(v: string): v is TransformPresetId {
  return (TRANSFORM_PRESET_IDS as readonly string[]).includes(v);
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/features/memo-transform/lib/preset-meta.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/features/memo-transform
git commit -m "feat: memo-transform 프리셋 메타 7종 (client-safe)"
```

---

### Task 4: 프롬프트 + LLM 변환 라이브러리 — TDD

**Files:**
- Create: `apps/dashboard/src/features/memo-transform/lib/prompts.ts`
- Create: `apps/dashboard/src/features/memo-transform/lib/transform-memo.ts`
- Test: `apps/dashboard/src/features/memo-transform/lib/transform-memo.test.ts`
- Modify: `apps/dashboard/src/shared/lib/llm/anthropic.ts` (logLlmSpend scope 확장)

**Interfaces:**
- Consumes: `TRANSFORM_PRESETS`(Task 3), `analyzeStructured`(`@krdn/llm-gateway/gateway`),
  `gatewayDefaults`/`logLlmSpend`(`@/shared/lib/llm/anthropic`),
  `isRefusalDraft`(`@/shared/lib/llm/draft-reply`),
  `isDegenerateCleanup`(`@/features/memo-compose/lib/cleanup-transcript` — features→features 허용, 순수 함수 재사용).
- Produces (Task 5가 사용):
  - `transformMemoContent(input: string, preset: TransformPresetId): Promise<TransformOutcome>`
    (`TransformOutcome = { kind: "ok"; content: string } | { kind: "failed"; reason: string }`)
  - `const TRANSFORM_MODEL = "claude-sonnet-5"`, `TransformResponseSchema`

- [ ] **Step 1: logLlmSpend scope 확장**

`shared/lib/llm/anthropic.ts`의 `logLlmSpend` 시그니처에서 scope 유니온을 교체:

```ts
export function logLlmSpend(
  scope:
    | "reply-classify"
    | "important-classify"
    | "reply-draft"
    | "memo-cleanup"
    | `memo-transform:${string}`,
  model: string,
  usage: Record<string, unknown> | undefined | null,
): void {
```

(본문 변경 없음. 템플릿 리터럴 타입이라 shared가 feature 타입을 import하지 않는다.)

- [ ] **Step 2: prompts.ts 작성**

`prompts.ts` 전체:

```ts
// 2층 프롬프트의 서버 전용 부분 — 공통 가드레일 + 프리셋별 스타일 지시.
// client-safe 메타(preset-meta.ts)와 분리해 프롬프트가 client 번들로 새지 않게 한다.
import "server-only";
import type { TransformPresetId } from "@/entities/memo/client";

// 1층: 모든 프리셋에 항상 적용되는 공통 가드레일.
export const GUARDRAIL_PROMPT = `당신은 개인 메모를 지정된 스타일로 정리하는 도구입니다.

절대 규칙 (모든 스타일 공통):
- 고유명사·숫자·날짜를 임의로 바꾸지 않는다.
- 원문에 없는 내용을 추가하지 않는다.
- 판단·평가·조언·안전 문구를 넣지 않는다.
- 한국어 메모는 한국어로 유지한다.

응답은 JSON: {"content": "변환된 전체 텍스트"}`;

// 2층: 프리셋별 스타일 지시.
export const PRESET_INSTRUCTIONS: Record<TransformPresetId, string> = {
  tidy: `스타일: 정돈. 군말("음…", "어…", "그…")·반복·받아쓰기 오류만 제거하고 문장부호와 문단을 정리한다. 요약하지 않는다. 원문의 모든 정보를 보존한다. 내용을 삭제하지 않는다 (군말 제외).`,
  polish: `스타일: 매끄럽게. 받아쓰기 오류와 어색한 문장을 자연스러운 문어체로 재작성한다. 정보를 전부 보존하고 요약하지 않는다.`,
  summary: `스타일: 요약. 핵심만 3~5문장 또는 3~5개 불릿으로 압축한다. 사소한 세부는 생략해도 된다.`,
  structured: `스타일: 구조화. 내용을 주제별로 나눠 마크다운 헤딩(##)과 불릿(-)으로 재구성한다. 정보는 보존하되 문장은 간결하게 다듬어도 된다.`,
  todos: `스타일: 할 일 추출. 실행할 액션 아이템만 골라 "- [ ] 항목" 마크다운 체크리스트로 만든다. 할 일이 전혀 없으면 정확히 "할 일 없음" 한 줄만 출력한다.`,
  journal: `스타일: 일기체. 정돈된 일기(저널) 문체로 재구성한다. 사실 관계와 감정 표현을 보존하고 새로운 해석을 덧붙이지 않는다.`,
  email: `스타일: 이메일 초안. 인사말, 본문, 맺음말을 갖춘 정중한 이메일 초안으로 재구성한다. 수신자 이름이 원문에 없으면 "안녕하세요," 로 시작한다.`,
};
```

- [ ] **Step 3: 실패하는 테스트 작성**

`transform-memo.test.ts` 전체:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const analyzeMock = vi.fn();
vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: (...a: unknown[]) => analyzeMock(...a),
}));
vi.mock("@/shared/lib/llm/anthropic", () => ({
  gatewayDefaults: { provider: "claude-cli", baseUrl: "http://test", apiKey: "k" },
  logLlmSpend: vi.fn(),
}));
vi.mock("@/shared/lib/llm/draft-reply", () => ({
  isRefusalDraft: (t: string) => t.startsWith("죄송"),
}));

import { transformMemoContent, TransformResponseSchema } from "./transform-memo";

beforeEach(() => {
  analyzeMock.mockReset();
});

// vi.mock이 게이트웨이를 대체해도 스키마 검증 자체는 여기서 직접 가드 (mock 함정 회피).
describe("TransformResponseSchema", () => {
  it("정상 content 통과", () => {
    expect(TransformResponseSchema.safeParse({ content: "정리된 텍스트" }).success).toBe(true);
  });
  it("빈 content 거부", () => {
    expect(TransformResponseSchema.safeParse({ content: "" }).success).toBe(false);
  });
});

describe("transformMemoContent", () => {
  it("정상 변환은 ok", async () => {
    analyzeMock.mockResolvedValue({ object: { content: "요약 결과" }, usage: {} });
    const r = await transformMemoContent("원문 ".repeat(50), "summary");
    expect(r).toEqual({ kind: "ok", content: "요약 결과" });
  });

  it("요약의 대폭 축약도 정상 (60% 규칙 미적용)", async () => {
    analyzeMock.mockResolvedValue({ object: { content: "짧은 요약" }, usage: {} });
    const r = await transformMemoContent("가".repeat(500), "summary");
    expect(r.kind).toBe("ok");
  });

  it("tidy의 60% 미만 축약은 degenerate 실패", async () => {
    analyzeMock.mockResolvedValue({ object: { content: "가".repeat(10) }, usage: {} });
    const r = await transformMemoContent("가".repeat(100), "tidy");
    expect(r).toEqual({ kind: "failed", reason: "degenerate" });
  });

  it("거절 응답은 refusal 실패", async () => {
    analyzeMock.mockResolvedValue({ object: { content: "죄송하지만 도와드릴 수 없습니다" }, usage: {} });
    const r = await transformMemoContent("원문 내용입니다 원문 내용입니다", "polish");
    expect(r).toEqual({ kind: "failed", reason: "refusal" });
  });

  it("LLM 예외는 failed(reason=메시지)", async () => {
    analyzeMock.mockRejectedValue(new Error("boom"));
    const r = await transformMemoContent("원문 내용입니다 원문 내용입니다", "summary");
    expect(r).toEqual({ kind: "failed", reason: "boom" });
  });

  it("빈 입력은 LLM 호출 없이 empty-input", async () => {
    expect(await transformMemoContent("   ", "tidy")).toEqual({ kind: "failed", reason: "empty-input" });
    expect(analyzeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm vitest run src/features/memo-transform/lib/transform-memo.test.ts`
Expected: FAIL — `transform-memo` 모듈 없음.

- [ ] **Step 5: transform-memo.ts 구현**

`transform-memo.ts` 전체:

```ts
// 저장된 메모 → 프리셋 스타일 변환. cleanup-transcript 패턴 미러 (2층 프롬프트).
// 온디맨드 + 미리보기 승인 흐름이라 raw-fallback 저장은 없다 — 실패는 failed로 반환만.
import "server-only";
import { z } from "zod";
import { analyzeStructured } from "@krdn/llm-gateway/gateway";
import { gatewayDefaults, logLlmSpend } from "@/shared/lib/llm/anthropic";
import { isRefusalDraft } from "@/shared/lib/llm/draft-reply";
import { isDegenerateCleanup } from "@/features/memo-compose/lib/cleanup-transcript";
import type { TransformPresetId } from "@/entities/memo/client";
import { TRANSFORM_PRESETS } from "./preset-meta";
import { GUARDRAIL_PROMPT, PRESET_INSTRUCTIONS } from "./prompts";

const MAX_INPUT = 4_000;
export const TRANSFORM_MODEL = "claude-sonnet-5";

export const TransformResponseSchema = z.object({
  content: z.string().min(1).max(30_000),
});

export type TransformOutcome =
  | { kind: "ok"; content: string }
  | { kind: "failed"; reason: string };

export async function transformMemoContent(
  input: string,
  preset: TransformPresetId,
): Promise<TransformOutcome> {
  const text = input.trim();
  if (text.length === 0) return { kind: "failed", reason: "empty-input" };
  const truncated = text.slice(0, MAX_INPUT);

  try {
    const { object, usage } = await analyzeStructured(truncated, TransformResponseSchema, {
      ...gatewayDefaults,
      model: TRANSFORM_MODEL,
      systemPrompt: `${GUARDRAIL_PROMPT}\n\n${PRESET_INSTRUCTIONS[preset]}`,
      maxOutputTokens: 4_000,
    });

    // 관측은 best-effort — 변환 결과를 절대 뒤집지 않는다.
    try {
      logLlmSpend(`memo-transform:${preset}`, TRANSFORM_MODEL, usage);
    } catch {
      /* swallow */
    }

    const content = object.content.trim();
    if (content.length === 0) return { kind: "failed", reason: "empty-output" };
    if (isRefusalDraft(content)) return { kind: "failed", reason: "refusal" };
    if (TRANSFORM_PRESETS[preset].strictPreserve && isDegenerateCleanup(truncated, content)) {
      return { kind: "failed", reason: "degenerate" };
    }
    return { kind: "ok", content };
  } catch (e) {
    return { kind: "failed", reason: e instanceof Error ? e.message : "llm-error" };
  }
}
```

- [ ] **Step 6: 통과 확인 + typecheck**

Run: `pnpm vitest run src/features/memo-transform/lib/transform-memo.test.ts && pnpm typecheck`
Expected: PASS 8/8, typecheck 에러 0.

- [ ] **Step 7: Commit**

```bash
git add src/features/memo-transform src/shared/lib/llm/anthropic.ts
git commit -m "feat: memo-transform LLM 변환 라이브러리 (2층 프롬프트 + 프리셋별 검증)"
```

---

### Task 5: Server Actions 2개 + client barrel — TDD

**Files:**
- Create: `apps/dashboard/src/features/memo-transform/api/transformMemoAction.ts`
- Create: `apps/dashboard/src/features/memo-transform/api/saveTransformationAction.ts`
- Test: `apps/dashboard/src/features/memo-transform/api/memoTransformActions.test.ts`
- Create: `apps/dashboard/src/features/memo-transform/client.ts`

**Interfaces:**
- Consumes: `getMemo`/`upsertTransformation`(entities, Task 2),
  `transformMemoContent`/`TRANSFORM_MODEL`(Task 4), `TRANSFORM_PRESETS`/`isTransformPresetId`(Task 3).
- Produces (Task 7 다이얼로그가 사용):
  - `transformMemoAction(memoId: string, preset: string): Promise<TransformMemoResult>`
  - `saveTransformationAction(memoId: string, preset: string, content: string): Promise<SaveTransformationResult>`
  - client barrel `@/features/memo-transform/client`

- [ ] **Step 1: 실패하는 테스트 작성**

`memoTransformActions.test.ts` 전체:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getMemoMock = vi.fn();
const upsertMock = vi.fn();
const transformMock = vi.fn();
vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/entities/memo/server", () => ({
  getMemo: (...a: unknown[]) => getMemoMock(...a),
  upsertTransformation: (...a: unknown[]) => upsertMock(...a),
}));
vi.mock("../lib/transform-memo", () => ({
  transformMemoContent: (...a: unknown[]) => transformMock(...a),
  TRANSFORM_MODEL: "claude-sonnet-5",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { transformMemoAction } from "./transformMemoAction";
import { saveTransformationAction } from "./saveTransformationAction";

const memo = { id: "m1", cleanedContent: "가".repeat(200) };

beforeEach(() => {
  getMemoMock.mockReset().mockResolvedValue(memo);
  upsertMock.mockReset().mockResolvedValue({ id: "t1" });
  transformMock.mockReset().mockResolvedValue({ kind: "ok", content: "결과" });
});

describe("transformMemoAction", () => {
  it("알 수 없는 preset은 invalid (경계 검증)", async () => {
    expect((await transformMemoAction("m1", "nope")).kind).toBe("invalid");
    expect(getMemoMock).not.toHaveBeenCalled();
  });
  it("소유 아님(getMemo null)이면 not-found", async () => {
    getMemoMock.mockResolvedValue(null);
    expect((await transformMemoAction("m1", "summary")).kind).toBe("not-found");
  });
  it("minInputLen 미달이면 too-short (서버 재검증)", async () => {
    getMemoMock.mockResolvedValue({ id: "m1", cleanedContent: "짧다" });
    expect((await transformMemoAction("m1", "summary")).kind).toBe("too-short");
    expect(transformMock).not.toHaveBeenCalled();
  });
  it("변환 결과를 그대로 반환한다", async () => {
    expect(await transformMemoAction("m1", "summary")).toEqual({ kind: "ok", content: "결과" });
    expect(transformMock).toHaveBeenCalledWith(memo.cleanedContent, "summary");
  });
});

describe("saveTransformationAction", () => {
  it("빈 content는 invalid", async () => {
    expect((await saveTransformationAction("m1", "summary", "  ")).kind).toBe("invalid");
    expect(upsertMock).not.toHaveBeenCalled();
  });
  it("20k 초과는 invalid", async () => {
    expect((await saveTransformationAction("m1", "summary", "가".repeat(20_001))).kind).toBe("invalid");
  });
  it("소유 아님이면 not-found", async () => {
    getMemoMock.mockResolvedValue(null);
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("not-found");
  });
  it("upsert 성공 시 ok + revalidatePath", async () => {
    const { revalidatePath } = await import("next/cache");
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("ok");
    expect(upsertMock).toHaveBeenCalledWith({
      memoId: "m1",
      preset: "summary",
      model: "claude-sonnet-5",
      content: "내용",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/memos");
  });
  it("DB 실패는 failed로 삼킨다", async () => {
    upsertMock.mockRejectedValue(new Error("db down"));
    expect((await saveTransformationAction("m1", "summary", "내용")).kind).toBe("failed");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/features/memo-transform/api/memoTransformActions.test.ts`
Expected: FAIL — 액션 모듈 없음.

- [ ] **Step 3: transformMemoAction.ts 구현**

파일 전체:

```ts
"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { getMemo } from "@/entities/memo/server";
import { TRANSFORM_PRESETS, isTransformPresetId } from "../lib/preset-meta";
import { transformMemoContent } from "../lib/transform-memo";

// ⚠️ import한 타입 재-export 금지 ("use server" ReferenceError). 결과 타입은 파일 내 선언만.
export type TransformMemoResult =
  | { kind: "ok"; content: string }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "too-short" }
  | { kind: "failed"; reason: string };

/** 미리보기 생성 — DB 쓰기 없음. 승인 저장은 saveTransformationAction. */
export async function transformMemoAction(memoId: string, preset: string): Promise<TransformMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!isTransformPresetId(preset)) return { kind: "invalid" };

  const memo = await getMemo(session.user.id, memoId);
  if (!memo) return { kind: "not-found" };
  if (memo.cleanedContent.trim().length < TRANSFORM_PRESETS[preset].minInputLen) {
    return { kind: "too-short" };
  }
  return transformMemoContent(memo.cleanedContent, preset);
}
```

- [ ] **Step 4: saveTransformationAction.ts 구현**

파일 전체:

```ts
"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { getMemo, upsertTransformation } from "@/entities/memo/server";
import { isTransformPresetId } from "../lib/preset-meta";
import { TRANSFORM_MODEL } from "../lib/transform-memo";

const MAX_CONTENT_LEN = 20_000;

export type SaveTransformationResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "failed" };

/** 미리보기에서 사용자가 편집했을 수 있는 content를 승인 저장 (같은 preset은 교체). */
export async function saveTransformationAction(
  memoId: string,
  preset: string,
  content: string,
): Promise<SaveTransformationResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!isTransformPresetId(preset)) return { kind: "invalid" };

  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CONTENT_LEN) return { kind: "invalid" };

  const memo = await getMemo(session.user.id, memoId);
  if (!memo) return { kind: "not-found" };

  return upsertTransformation({ memoId, preset, model: TRANSFORM_MODEL, content: trimmed }).then(
    () => {
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "failed" as const }),
  );
}
```

- [ ] **Step 5: client barrel 작성**

`client.ts` 전체:

```ts
// features/memo-transform — client-safe entrypoint.
// Server Action + client-safe 프리셋 메타만. 프롬프트·LLM lib는 노출 금지.
// 결과 타입은 각 액션 파일 내 선언이라 재-export 안전 (import 타입 재-export만 금지).
export { transformMemoAction } from "./api/transformMemoAction";
export type { TransformMemoResult } from "./api/transformMemoAction";
export { saveTransformationAction } from "./api/saveTransformationAction";
export type { SaveTransformationResult } from "./api/saveTransformationAction";
export { TRANSFORM_PRESETS, isTransformPresetId } from "./lib/preset-meta";
export type { TransformPresetMeta } from "./lib/preset-meta";
```

- [ ] **Step 6: 통과 확인 + typecheck**

Run: `pnpm vitest run src/features/memo-transform/api/memoTransformActions.test.ts && pnpm typecheck`
Expected: PASS 9/9, typecheck 에러 0.

- [ ] **Step 7: Commit**

```bash
git add src/features/memo-transform
git commit -m "feat: memo-transform Server Actions (미리보기 생성 + 승인 저장 upsert)"
```

---

### Task 6: MemoCard 칩 전환 + AI 정리 트리거 — TDD

**Files:**
- Modify: `apps/dashboard/src/entities/memo/ui/MemoCard.tsx`
- Test: `apps/dashboard/src/entities/memo/ui/MemoCard.test.tsx`

**Interfaces:**
- Consumes: `MemoTransformation`/`TransformPresetId`/`TRANSFORM_PRESET_LABELS`(Task 2, 같은 entity 내부 경로 `../model/types`).
- Produces: `MemoCard` 신규 optional props — `transformations?: MemoTransformation[]`,
  `onTransform?: (memo: Memo) => void`. **기존 호출부(RecentMemos 등)는 무수정 호환**
  (신규 prop 전부 optional). 기존 footer "원문 보기" 토글은 칩 row로 대체됨.

- [ ] **Step 1: 실패하는 jsdom 테스트 작성**

`MemoCard.test.tsx` 전체:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { MemoCard } from "./MemoCard";
import type { Memo, MemoTransformation } from "../model/types";

afterEach(cleanup);

const memo = {
  id: "m1",
  userId: "u1",
  source: "voice",
  title: "회의 메모",
  rawContent: "음 어 회의는 세 시",
  cleanedContent: "회의는 세 시",
  createdAt: new Date("2026-07-09T10:00:00"),
  updatedAt: new Date("2026-07-09T10:00:00"),
} as Memo;

const summary = {
  id: "t1",
  memoId: "m1",
  preset: "summary",
  model: "claude-sonnet-5",
  content: "요약: 회의 3시",
  createdAt: new Date("2026-07-09T10:05:00"),
  updatedAt: new Date("2026-07-09T10:05:00"),
} as MemoTransformation;

describe("MemoCard 칩 전환", () => {
  it("기본은 정리본을 보여준다", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    expect(screen.getByText("회의는 세 시")).toBeTruthy();
  });
  it("원문 칩 클릭 시 raw 표시 (음성만)", () => {
    render(<MemoCard memo={memo} transformations={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "원문" }));
    expect(screen.getByText("음 어 회의는 세 시")).toBeTruthy();
  });
  it("변환본 칩 클릭 시 해당 content 표시", () => {
    render(<MemoCard memo={memo} transformations={[summary]} />);
    fireEvent.click(screen.getByRole("button", { name: "요약" }));
    expect(screen.getByText("요약: 회의 3시")).toBeTruthy();
  });
  it("텍스트 메모 + 변환 없음이면 칩 row가 없다", () => {
    render(<MemoCard memo={{ ...memo, source: "text" } as Memo} />);
    expect(screen.queryByRole("button", { name: "정리본" })).toBeNull();
  });
  it("onTransform이 있으면 AI 정리 버튼이 memo를 넘긴다", () => {
    const onTransform = vi.fn();
    render(<MemoCard memo={memo} onTransform={onTransform} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 정리" }));
    expect(onTransform).toHaveBeenCalledWith(memo);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/entities/memo/ui/MemoCard.test.tsx`
Expected: FAIL — `원문`/`요약` 칩 버튼 없음(기존 UI는 footer 토글), `AI 정리` 버튼 없음.

- [ ] **Step 3: MemoCard.tsx 구현**

파일 전체를 다음으로 교체:

```tsx
"use client";
import { useState } from "react";
import type { Memo, MemoTransformation, TransformPresetId } from "../model/types";
import { TRANSFORM_PRESET_LABELS } from "../model/types";

interface MemoCardProps {
  memo: Memo;
  /** 이 메모의 저장된 변환본들 — 칩으로 전환 표시. */
  transformations?: MemoTransformation[];
  onEdit?: (memo: Memo) => void;
  onDelete?: (id: string) => void;
  /** AI 정리 다이얼로그 트리거 (조립은 MemoList 담당 — entity는 features 접근 불가). */
  onTransform?: (memo: Memo) => void;
}

// 표시 뷰: 정리본 | 원문 | 저장된 변환본(프리셋 id).
type MemoView = "cleaned" | "raw" | TransformPresetId;

// locale-free 시각 포맷 (hydration mismatch 방지 — Gotcha #3).
function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MemoCard({ memo, transformations = [], onEdit, onDelete, onTransform }: MemoCardProps) {
  const [view, setView] = useState<MemoView>("cleaned");
  const isVoice = memo.source === "voice";

  const active = transformations.find((t) => t.preset === view);
  const body =
    view === "cleaned" ? memo.cleanedContent : view === "raw" ? memo.rawContent : (active?.content ?? memo.cleanedContent);

  const chips: Array<{ key: MemoView; label: string }> = [
    { key: "cleaned", label: "정리본" },
    ...(isVoice ? [{ key: "raw" as MemoView, label: "원문" }] : []),
    ...transformations.map((t) => ({
      key: t.preset as TransformPresetId,
      label: TRANSFORM_PRESET_LABELS[t.preset as TransformPresetId] ?? t.preset,
    })),
  ];

  return (
    <article className="rounded-lg border border-neutral-200 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-900">{memo.title}</h3>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500">
          {isVoice ? "🎙 음성" : "✍ 텍스트"}
        </span>
      </header>
      {chips.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setView(c.key)}
              className={
                view === c.key
                  ? "rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs text-white"
                  : "rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-500 hover:text-neutral-900"
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm text-neutral-700">{body}</p>
      <footer className="mt-3 flex items-center gap-3 text-xs text-neutral-400">
        <time>{formatTime(memo.createdAt)}</time>
        {onTransform && (
          <button type="button" onClick={() => onTransform(memo)} className="hover:text-neutral-700">
            AI 정리
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

- [ ] **Step 4: 통과 확인 + typecheck**

Run: `pnpm vitest run src/entities/memo/ui/MemoCard.test.tsx && pnpm typecheck`
Expected: PASS 5/5, typecheck 에러 0 (RecentMemos 등 기존 호출부 호환 확인).

- [ ] **Step 5: Commit**

```bash
git add src/entities/memo/ui
git commit -m "feat: MemoCard 변환본 칩 전환 + AI 정리 트리거 (원문 토글을 칩으로 대체)"
```

---

### Task 7: TransformDialog + MemoList 조립 — TDD

**Files:**
- Create: `apps/dashboard/src/features/memo-transform/ui/TransformDialog.tsx`
- Test: `apps/dashboard/src/features/memo-transform/ui/TransformDialog.test.tsx`
- Modify: `apps/dashboard/src/features/memo-manage/ui/MemoList.tsx`

**Interfaces:**
- Consumes: 액션·메타(Task 5 client barrel), 라벨·타입(entities, Task 2), `MemoCard`(Task 6).
- Produces: `TransformDialog({ memo: Memo; existingPresets: TransformPresetId[]; onClose: () => void })`.
  `MemoList` props 확장: `transformationsByMemo: Record<string, MemoTransformation[]>` (Task 8이 전달).

- [ ] **Step 1: 실패하는 다이얼로그 테스트 작성**

`TransformDialog.test.tsx` 전체:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../client", () => ({
  transformMemoAction: vi.fn(async () => ({ kind: "ok", content: "변환 결과" })),
  saveTransformationAction: vi.fn(async () => ({ kind: "ok" })),
}));

import { TransformDialog } from "./TransformDialog";
import { TRANSFORM_PRESETS } from "../lib/preset-meta";
import type { Memo } from "@/entities/memo/client";

afterEach(cleanup);

function makeMemo(cleaned: string): Memo {
  return {
    id: "m1",
    userId: "u1",
    source: "text",
    title: "제목",
    rawContent: cleaned,
    cleanedContent: cleaned,
    createdAt: new Date("2026-07-09T10:00:00"),
    updatedAt: new Date("2026-07-09T10:00:00"),
  } as Memo;
}

describe("TransformDialog", () => {
  it("프리셋 7종 버튼이 body 포털로 렌더된다 (inert 조상 없음)", () => {
    render(<TransformDialog memo={makeMemo("가".repeat(200))} existingPresets={[]} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.closest("[inert]")).toBeNull(); // portal 회귀 가드
    expect(Object.keys(TRANSFORM_PRESETS)).toHaveLength(7);
    for (const label of ["정돈", "매끄럽게", "요약", "구조화", "할 일 추출", "일기체", "이메일 초안"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("minInputLen 미달 프리셋은 비활성", () => {
    render(<TransformDialog memo={makeMemo("짧은 메모")} existingPresets={[]} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: /요약/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /정돈/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("프리셋 실행 → 편집 가능한 미리보기 textarea", async () => {
    render(<TransformDialog memo={makeMemo("가".repeat(200))} existingPresets={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /요약/ }));
    expect(await screen.findByDisplayValue("변환 결과")).toBeTruthy();
  });

  it("이미 저장된 프리셋에 교체 안내를 보여준다", () => {
    render(<TransformDialog memo={makeMemo("가".repeat(200))} existingPresets={["summary"]} onClose={() => {}} />);
    expect(screen.getByText(/저장됨 — 재생성 시 교체/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/features/memo-transform/ui/TransformDialog.test.tsx`
Expected: FAIL — 컴포넌트 없음.

- [ ] **Step 3: TransformDialog.tsx 구현**

파일 전체:

```tsx
"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
  type Memo,
  type TransformPresetId,
} from "@/entities/memo/client";
import { TRANSFORM_PRESETS } from "../lib/preset-meta";
import { transformMemoAction, saveTransformationAction } from "../client";

type Phase = "pick" | "loading" | "preview";

interface TransformDialogProps {
  memo: Memo;
  /** 이미 저장된 프리셋 — 재생성 시 교체 경고 표시용. */
  existingPresets: TransformPresetId[];
  onClose: () => void;
}

// createPortal로 body 탈출 — inert 조상 아래 렌더되면 클릭 불가 (과거 사고 재발 방지).
export function TransformDialog({ memo, existingPresets, onClose }: TransformDialogProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [preset, setPreset] = useState<TransformPresetId | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const inputLen = memo.cleanedContent.trim().length;
  const busy = phase === "loading" || saving;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function run(p: TransformPresetId) {
    setPreset(p);
    setPhase("loading");
    setNotice(null);
    transformMemoAction(memo.id, p).then(
      (r) => {
        if (r.kind === "ok") {
          setContent(r.content);
          setPhase("preview");
        } else {
          setNotice(
            r.kind === "too-short"
              ? "내용이 너무 짧아 이 스타일로 정리할 수 없습니다."
              : r.kind === "not-found"
                ? "메모를 찾을 수 없습니다."
                : "AI 정리에 실패했습니다. 다시 시도해 주세요.",
          );
          setPhase("pick");
        }
      },
      () => {
        setNotice("AI 정리에 실패했습니다. 다시 시도해 주세요.");
        setPhase("pick");
      },
    );
  }

  function save() {
    if (!preset) return;
    setSaving(true);
    saveTransformationAction(memo.id, preset, content).then(
      (r) => {
        setSaving(false);
        if (r.kind === "ok") {
          onClose();
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI 정리"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 font-medium text-neutral-900">AI 정리 — {memo.title}</h2>

        {phase === "pick" && (
          <>
            <p className="mb-3 text-xs text-neutral-400">
              스타일을 선택하면 현재 정리본을 기준으로 변환합니다. 텍스트는 서버로 전송됩니다.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TRANSFORM_PRESET_IDS.map((id) => {
                const tooShort = inputLen < TRANSFORM_PRESETS[id].minInputLen;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={tooShort}
                    onClick={() => run(id)}
                    className="rounded border border-neutral-200 px-3 py-2 text-left text-sm hover:border-neutral-400 disabled:opacity-40"
                  >
                    <span className="font-medium">{TRANSFORM_PRESET_LABELS[id]}</span>
                    {existingPresets.includes(id) && (
                      <span className="block text-xs text-amber-600">저장됨 — 재생성 시 교체</span>
                    )}
                    {tooShort && <span className="block text-xs text-neutral-400">내용이 너무 짧음</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {phase === "loading" && <p className="py-6 text-center text-sm text-neutral-500">AI가 정리하는 중…</p>}

        {phase === "preview" && preset && (
          <>
            {existingPresets.includes(preset) && (
              <p className="mb-2 text-xs text-amber-600">기존 {TRANSFORM_PRESET_LABELS[preset]} 정리본을 교체합니다.</p>
            )}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {saving ? "저장 중…" : "저장"}
              </button>
              <button type="button" onClick={() => run(preset)} disabled={saving} className="rounded border px-4 py-2 text-sm">
                다시 생성
              </button>
              <button type="button" onClick={onClose} disabled={saving} className="rounded border px-4 py-2 text-sm">
                취소
              </button>
            </div>
          </>
        )}

        {notice && <p className="mt-3 text-sm text-neutral-500">{notice}</p>}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: 다이얼로그 테스트 통과 확인**

Run: `pnpm vitest run src/features/memo-transform/ui/TransformDialog.test.tsx`
Expected: PASS 4/4.

- [ ] **Step 5: MemoList 조립**

`MemoList.tsx` 전체를 다음으로 교체 (편집/삭제 로직은 기존 그대로 — import·props·MemoCard 호출·다이얼로그 렌더만 추가):

```tsx
"use client";
import { useState } from "react";
import {
  MemoCard,
  type Memo,
  type MemoTransformation,
  type TransformPresetId,
} from "@/entities/memo/client";
import { updateMemoAction, deleteMemoAction } from "../client";
// features→features 허용 예외 (memo-manage가 변환 다이얼로그를 조립).
import { TransformDialog } from "@/features/memo-transform/ui/TransformDialog";

interface MemoListProps {
  memos: Memo[];
  transformationsByMemo: Record<string, MemoTransformation[]>;
}

export function MemoList({ memos, transformationsByMemo }: MemoListProps) {
  const [editing, setEditing] = useState<Memo | null>(null);
  const [transforming, setTransforming] = useState<Memo | null>(null);
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
          setNotice(null);
        } else if (r.kind === "invalid") {
          setNotice("내용이 비어 있습니다.");
        } else if (r.kind === "not-found") {
          setNotice("메모를 찾을 수 없습니다.");
        } else {
          setNotice("수정에 실패했습니다.");
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
      (r) => {
        setBusy(false);
        if (r.kind === "ok") {
          setNotice(null);
        } else if (r.kind === "not-found") {
          setNotice("메모를 찾을 수 없습니다.");
        } else {
          setNotice("삭제에 실패했습니다.");
        }
      },
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
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
                className="rounded border px-3 py-1.5 text-sm"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <MemoCard
            key={memo.id}
            memo={memo}
            transformations={transformationsByMemo[memo.id] ?? []}
            onEdit={startEdit}
            onDelete={handleDelete}
            onTransform={setTransforming}
          />
        ),
      )}
      {transforming && (
        <TransformDialog
          memo={transforming}
          existingPresets={(transformationsByMemo[transforming.id] ?? []).map(
            (t) => t.preset as TransformPresetId,
          )}
          onClose={() => setTransforming(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: **에러 발생** — `MemoWidget`이 `MemoList`에 `transformationsByMemo`를 안 넘김.
이는 Task 8에서 해소되는 의도된 중간 상태다. 에러가 그 한 종류뿐인지 확인만 하고 진행.
(단일 브랜치 연속 작업이므로 커밋은 Task 8과 묶지 않고 여기서 수행 — CI는 PR 시점에만 게이트.)

- [ ] **Step 7: Commit**

```bash
git add src/features/memo-transform src/features/memo-manage
git commit -m "feat: TransformDialog(프리셋 픽커+미리보기 승인) + MemoList 조립"
```

---

### Task 8: 페이지 배선 + 전체 게이트

**Files:**
- Modify: `apps/dashboard/src/app/(dashboard)/memos/page.tsx`
- Modify: `apps/dashboard/src/widgets/memo/ui/MemoWidget.tsx`

**Interfaces:**
- Consumes: `listTransformationsByUser`(Task 2), `MemoList` 신규 props(Task 7).
- Produces: 완성된 /memos 페이지. 배포 시 운영 psql로 0036 수동 적용 필요 (배포 노트).

- [ ] **Step 1: MemoWidget 확장**

`MemoWidget.tsx` 전체:

```tsx
import { MemoComposer } from "@/features/memo-compose/ui/MemoComposer";
import { MemoList } from "@/features/memo-manage/ui/MemoList";
import type { Memo, MemoTransformation } from "@/entities/memo/client";

interface MemoWidgetProps {
  memos: Memo[];
  transformationsByMemo: Record<string, MemoTransformation[]>;
}

// /memos 페이지용 조합 위젯 — composer(client) + list(client)를 서버 컴포넌트로 감싼다.
export function MemoWidget({ memos, transformationsByMemo }: MemoWidgetProps) {
  return (
    <div className="space-y-6">
      <MemoComposer />
      <MemoList memos={memos} transformationsByMemo={transformationsByMemo} />
    </div>
  );
}
```

- [ ] **Step 2: page.tsx 배선**

`page.tsx` 전체:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { listMemos, listTransformationsByUser, type MemoTransformation } from "@/entities/memo/server";
import { MemoWidget } from "@/widgets/memo";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [memos, transformations] = await Promise.all([
    listMemos(session.user.id),
    listTransformationsByUser(session.user.id),
  ]);
  const transformationsByMemo: Record<string, MemoTransformation[]> = {};
  for (const t of transformations) {
    (transformationsByMemo[t.memoId] ??= []).push(t);
  }

  return (
    <PageContainer width="narrow">
      <PageHeader title="메모" subtitle="음성 또는 텍스트로 빠르게 기록해요." />
      <MemoWidget memos={memos} transformationsByMemo={transformationsByMemo} />
    </PageContainer>
  );
}
```

- [ ] **Step 3: 전체 게이트**

Run (순서대로, 전부 `apps/dashboard/`):

```bash
pnpm typecheck
pnpm lint
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
pnpm build
```

Expected: typecheck·lint 에러 0 / 테스트 전부 PASS (테스트 DB 미기동이면 통합만
ECONNREFUSED — 그 경우 기동 후 재실행) / production build 성공.
⚠️ build 통과가 "use server" 타입 재-export 변종을 못 잡으므로 Step 4 필수.

- [ ] **Step 4: dev dogfood smoke (수동)**

`pnpm dev` 후 http://localhost:3020/memos 에서:
1. 기존 메모 카드의 "AI 정리" 클릭 → 다이얼로그 → "요약" 실행 → 미리보기 → 저장.
2. 카드에 "요약" 칩이 생기고 클릭 시 요약본 표시 확인.
3. 같은 프리셋 재생성 → "교체" 경고 → 저장 → 칩 1개 유지(중복 생성 없음) 확인.
4. dev 서버 터미널에 500/ReferenceError 없어야 함.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/memos/page.tsx" src/widgets/memo
git commit -m "feat: /memos 페이지 변환본 배선 (1쿼리 로드 + 위젯 전달)"
```

---

## 배포 노트 (구현 범위 외 — 머지 후 운영자 절차)

1. PR #268(메모 기능) 머지·배포가 선행.
2. 본 브랜치 머지 전 운영 psql로 `drizzle/0036_*.sql` 수동 적용 (BEGIN/COMMIT,
   drizzle-kit prod tracking 불신). 적용 확인: `SELECT to_regclass('public.memo_transformations');`
3. 이미지 교체 → `/memos`에서 dogfood smoke 1회.
