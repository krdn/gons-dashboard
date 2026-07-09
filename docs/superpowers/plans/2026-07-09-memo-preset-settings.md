# 메모 AI 정리 프리셋 설정 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모 스타일 변환 프리셋(빌트인 7종 편집+복구, 커스텀 추가)을 사용자가 설정하는 기능 — 스펙 `docs/superpowers/specs/2026-07-09-memo-preset-settings-design.md`.

**Architecture:** 코드 기본값 + DB override/custom 병합(행 없음=기본값, 복구=행 삭제). 프롬프트는 3층(하드 계약/충실 가드 토글/스타일 지시). `/memos/settings` 전용 페이지(master-detail). 서버 해석은 `preset-resolver`가 담당.

**Tech Stack:** Next.js 16 RSC + Server Actions, Drizzle, Zod, Vitest(+jsdom), Tailwind v4.

## Global Constraints

- 브랜치: `feat/memo-preset-settings` (스펙 커밋 2개 이미 존재). 커밋 메시지는 한국어 `<type>: <제목>`.
- FSD 의존 방향 준수: `app → widgets → features → entities → shared`. features→features는 허용 예외.
- 프롬프트 모듈(`prompts.ts`, `preset-resolver.ts`)은 `import "server-only"` 필수. client에는 카탈로그 데이터만 props로.
- `"use server"` 파일에서 **import한 타입 재-export 금지** (ReferenceError 사고) — 결과 타입은 각 액션 파일 내 선언.
- 액션 에러 reason은 고정 문자열 (내부 정보 클라이언트 비노출).
- 테스트: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`. DB 통합 테스트는 로컬 도커 필요:
  `docker run -d --rm --name gons-test-db -p 5999:5432 -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy postgres:16-alpine`
  스키마 적용 (tests/setup.ts는 마이그레이션을 안 돌린다 — 개발자가 직접 적용):
  `cd apps/dashboard && DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm db:migrate` (로컬 URL이라 prod 가드 통과). Task 1에서 0037이 생성된 뒤 다시 한 번 적용해야 Task 2 통합 테스트가 돈다.
- **새 테스트 파일은 반드시 단일 경로로 실행해 "N passed" 확인** (vitest include 밖 조용한 스킵 사고).
- 명령은 모두 `apps/dashboard/`에서 실행 (`cd apps/dashboard` 후 `pnpm vitest run <path>` 등). root `pnpm test`는 dashboard로 위임.
- 마지막에 `pnpm build` 1회 필수 (barrel seam은 typecheck/lint로 못 잡음).
- UI 문구는 한국어, 코드 식별자는 영어. 시각 포맷은 locale-free.

---

### Task 1: DB 스키마 + 마이그레이션 + 타입 정리

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema/memo.ts`
- Modify: `apps/dashboard/src/entities/memo/model/types.ts`
- Modify: `apps/dashboard/src/entities/memo/api/memoTransformRepo.ts` (입력 타입 완화 + presetLabel)
- Create: `apps/dashboard/drizzle/0037_*.sql` (자동 생성)

**Interfaces:**
- Produces: `memoTransformPresets` 테이블 스키마, `MemoTransformPreset` 타입(= `$inferSelect`), `MemoTransformation.presetLabel: string | null`, `UpsertTransformationInput { memoId: string; preset: string; presetLabel: string | null; model: string; content: string }`

- [ ] **Step 1: 스키마 수정** — `schema/memo.ts`에서 ① `memoTransformations`의 `check("memo_transformations_preset_check", ...)` 줄 삭제, ② `presetLabel: text("preset_label"),`를 `content` 아래 추가 (저장 시점 라벨 스냅샷, null=코드 라벨 폴백), ③ 파일 끝에 새 테이블 추가. import에 `boolean` 추가 (`drizzle-orm/pg-core`).

```ts
// memo_transform_presets: 빌트인 override(slug=빌트인 id) + 커스텀(slug='c-…').
// 행 없음 = 코드 기본값 (복구 = 행 삭제). 스펙 2026-07-09-memo-preset-settings.
export const memoTransformPresets = pgTable(
  "memo_transform_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    instruction: text("instruction").notNull(),
    fidelityGuard: boolean("fidelity_guard").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memo_transform_presets_user_slug_uq").on(t.userId, t.slug),
    check("memo_transform_presets_slug_format", sql`${t.slug} ~ '^[a-z0-9-]{1,40}$'`),
    check("memo_transform_presets_label_len", sql`length(${t.label}) BETWEEN 1 AND 20`),
    check(
      "memo_transform_presets_instruction_len",
      sql`length(${t.instruction}) BETWEEN 1 AND 2000`,
    ),
  ],
);
```

- [ ] **Step 2: 타입 노출** — `entities/memo/model/types.ts`의 import를 `import type { memos, memoTransformations, memoTransformPresets } from "@/shared/lib/db/schema";`로 바꾸고 아래 추가. `TRANSFORM_PRESET_IDS` 위 주석의 "DB CHECK와 동기 유지"를 "빌트인 프리셋 목록 (커스텀은 DB `memo_transform_presets`)"로 수정.

```ts
export type MemoTransformPreset = typeof memoTransformPresets.$inferSelect;
```

- [ ] **Step 3: repo 입력 완화** — `memoTransformRepo.ts`에서 `UpsertTransformationInput.preset: TransformPresetId` → `preset: string`으로, `presetLabel: string | null` 필드 추가. `import type { MemoTransformation, TransformPresetId }` → `import type { MemoTransformation }`. upsert의 `set`에 `presetLabel: input.presetLabel` 추가.

- [ ] **Step 4: 마이그레이션 생성 + 검증**

Run: `cd apps/dashboard && pnpm db:generate && pnpm typecheck`
Expected: `drizzle/0037_*.sql` 생성 (CREATE TABLE memo_transform_presets + ALTER TABLE memo_transformations DROP CONSTRAINT + ADD COLUMN preset_label). typecheck 통과. ⚠️ 생성 SQL에 기존 테이블 DROP+ADD 같은 spurious diff가 있으면 스키마 정의 실수 — 수정 후 재생성.

`saveTransformationAction.ts`가 `presetLabel` 없이 upsert를 호출해 컴파일 에러가 나면, 이 Task에서는 임시로 `presetLabel: null`을 넘긴다 (Task 5에서 서버 재해석 값으로 교체).

- [ ] **Step 5: 기존 repo 테스트 회귀 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoTransformRepo.test.ts`
Expected: PASS (로컬 테스트 DB 기동 시). DB 미기동이면 ECONNREFUSED — Global Constraints의 docker 명령으로 기동 후 재실행.

- [ ] **Step 6: Commit** — `git add`는 명시 경로만.

```bash
git add apps/dashboard/src/shared/lib/db/schema/memo.ts apps/dashboard/src/entities/memo/model/types.ts apps/dashboard/src/entities/memo/api/memoTransformRepo.ts apps/dashboard/src/features/memo-transform/api/saveTransformationAction.ts apps/dashboard/drizzle/
git commit -m "feat: memo_transform_presets 테이블 + preset_label 스냅샷 컬럼 (프리셋 설정 스키마)"
```

---

### Task 2: memoPresetRepo — entity CRUD

**Files:**
- Create: `apps/dashboard/src/entities/memo/api/memoPresetRepo.ts`
- Test: `apps/dashboard/src/entities/memo/api/memoPresetRepo.test.ts` (통합 — 기존 `memoTransformRepo.test.ts`의 setup 패턴 미러: 같은 beforeAll/afterAll에서 테이블 생성·정리하는 방식 그대로 복사)
- Modify: `apps/dashboard/src/entities/memo/server.ts` (export 추가)

**Interfaces:**
- Consumes: Task 1의 `memoTransformPresets`, `MemoTransformPreset`, `TRANSFORM_PRESET_IDS`
- Produces:
  - `listPresetsByUser(userId: string): Promise<MemoTransformPreset[]>`
  - `getPresetBySlug(userId: string, slug: string): Promise<MemoTransformPreset | null>`
  - `upsertPreset(input: UpsertPresetInput): Promise<MemoTransformPreset>` — `UpsertPresetInput { userId: string; slug: string; label: string; instruction: string; fidelityGuard: boolean }`
  - `insertPreset(input: UpsertPresetInput): Promise<MemoTransformPreset>` — 충돌 시 throw (커스텀 생성용)
  - `deletePresetBySlug(userId: string, slug: string): Promise<boolean>` — 삭제됐으면 true
  - `countCustomPresets(userId: string): Promise<number>` — slug가 빌트인 목록 밖인 행 수

- [ ] **Step 1: 실패하는 통합 테스트 작성** — `memoTransformRepo.test.ts`의 DB setup을 그대로 미러하고 케이스 6개: upsert 신규 생성 / 같은 (userId,slug) upsert는 교체(행 1개 유지, updatedAt 갱신) / getPresetBySlug 미존재 null / deletePresetBySlug true·미존재 false / countCustomPresets는 빌트인 slug 행(`tidy`) 제외하고 `c-*`만 센다 / listPresetsByUser는 소유자 행만.

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoPresetRepo.test.ts`
Expected: FAIL — "Cannot find module './memoPresetRepo'"

- [ ] **Step 3: 구현**

```ts
import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoTransformPresets } from "@/shared/lib/db/schema";
import { TRANSFORM_PRESET_IDS } from "../model/types";
import type { MemoTransformPreset } from "../model/types";

export interface UpsertPresetInput {
  userId: string;
  slug: string;
  label: string;
  instruction: string;
  fidelityGuard: boolean;
}

export async function listPresetsByUser(userId: string): Promise<MemoTransformPreset[]> {
  return db
    .select()
    .from(memoTransformPresets)
    .where(eq(memoTransformPresets.userId, userId))
    .orderBy(memoTransformPresets.createdAt);
}

export async function getPresetBySlug(
  userId: string,
  slug: string,
): Promise<MemoTransformPreset | null> {
  const rows = await db
    .select()
    .from(memoTransformPresets)
    .where(and(eq(memoTransformPresets.userId, userId), eq(memoTransformPresets.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

/** override 저장 — 같은 (user, slug)면 교체. */
export async function upsertPreset(input: UpsertPresetInput): Promise<MemoTransformPreset> {
  const rows = await db
    .insert(memoTransformPresets)
    .values(input)
    .onConflictDoUpdate({
      target: [memoTransformPresets.userId, memoTransformPresets.slug],
      set: {
        label: input.label,
        instruction: input.instruction,
        fidelityGuard: input.fidelityGuard,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

/** 커스텀 생성 — slug 충돌이면 throw (호출자가 slug 재생성 재시도). */
export async function insertPreset(input: UpsertPresetInput): Promise<MemoTransformPreset> {
  const rows = await db.insert(memoTransformPresets).values(input).returning();
  return rows[0];
}

export async function deletePresetBySlug(userId: string, slug: string): Promise<boolean> {
  const rows = await db
    .delete(memoTransformPresets)
    .where(and(eq(memoTransformPresets.userId, userId), eq(memoTransformPresets.slug, slug)))
    .returning({ id: memoTransformPresets.id });
  return rows.length > 0;
}

export async function countCustomPresets(userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memoTransformPresets)
    .where(
      and(
        eq(memoTransformPresets.userId, userId),
        notInArray(memoTransformPresets.slug, [...TRANSFORM_PRESET_IDS]),
      ),
    );
  return rows[0]?.n ?? 0;
}
```

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행. Expected: "6 passed" (케이스 수 기준 N passed — 0 skipped 확인).

- [ ] **Step 5: server.ts export 추가**

```ts
export {
  listPresetsByUser,
  getPresetBySlug,
  upsertPreset,
  insertPreset,
  deletePresetBySlug,
  countCustomPresets,
  type UpsertPresetInput,
} from "./api/memoPresetRepo";
export type { MemoTransformPreset } from "./model/types";
```

- [ ] **Step 6: typecheck + Commit**

```bash
cd apps/dashboard && pnpm typecheck && cd ../..
git add apps/dashboard/src/entities/memo/api/memoPresetRepo.ts apps/dashboard/src/entities/memo/api/memoPresetRepo.test.ts apps/dashboard/src/entities/memo/server.ts
git commit -m "feat: memoPresetRepo — 프리셋 override/커스텀 CRUD (entities/memo)"
```

---

### Task 3: prompts.ts 3층 재구성 + 조립 함수

**Files:**
- Modify: `apps/dashboard/src/features/memo-transform/lib/prompts.ts`
- Test: `apps/dashboard/src/features/memo-transform/lib/prompts.test.ts` (신규)

**Interfaces:**
- Produces: `HARD_CONTRACT: string`, `FIDELITY_GUARD: string`, `PRESET_INSTRUCTIONS: Record<TransformPresetId, string>` (기존 유지), `buildTransformSystemPrompt(instruction: string, fidelityGuard: boolean): string`
- 주의: 기존 `GUARDRAIL_PROMPT` export는 Task 5에서 transform-memo가 갈아탈 때까지 **유지** (이 Task에서 삭제 금지 — 컴파일 보존).

- [ ] **Step 1: 실패하는 테스트 작성** (`prompts.test.ts`) — 케이스 4개:

```ts
import { describe, it, expect } from "vitest";
import {
  HARD_CONTRACT,
  FIDELITY_GUARD,
  PRESET_INSTRUCTIONS,
  buildTransformSystemPrompt,
} from "./prompts";

describe("buildTransformSystemPrompt", () => {
  it("가드 on: 하드 계약 + 충실 가드 + 지시 순서로 조립", () => {
    const p = buildTransformSystemPrompt("스타일: 테스트.", true);
    expect(p).toBe(`${HARD_CONTRACT}\n\n${FIDELITY_GUARD}\n\n스타일: 테스트.`);
  });
  it("가드 off: 충실 가드 미포함", () => {
    const p = buildTransformSystemPrompt("스타일: 테스트.", false);
    expect(p).toBe(`${HARD_CONTRACT}\n\n스타일: 테스트.`);
    expect(p).not.toContain("절대 규칙");
  });
  it("하드 계약은 JSON 출력 계약을 포함하고 페르소나 중립", () => {
    expect(HARD_CONTRACT).toContain('{"content"');
    expect(HARD_CONTRACT).not.toContain("도구입니다");
  });
  it("빌트인 7종 지시가 전부 존재", () => {
    expect(Object.keys(PRESET_INSTRUCTIONS)).toHaveLength(7);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/memo-transform/lib/prompts.test.ts`
Expected: FAIL — "HARD_CONTRACT is not exported" (server-only 모듈 테스트는 기존 `transform-memo.test.ts`가 이미 하고 있으므로 환경 이슈 없음 — 같은 setup을 따름).

- [ ] **Step 3: 구현** — `prompts.ts`에 추가 (기존 `GUARDRAIL_PROMPT`·`PRESET_INSTRUCTIONS`는 그대로 두고 아래를 추가):

```ts
// 1층: 하드 계약 — 편집 불가. JSON 출력 계약이 여기 있어 Zod 파싱 실패를 격리한다.
// 페르소나 중립 문구 (커스텀 프리셋의 자유 역할 부여와 싸우지 않게).
export const HARD_CONTRACT = `개인 메모를 아래 지시에 따라 변환하는 작업입니다.

응답은 반드시 JSON: {"content": "변환된 전체 텍스트"}`;

// 2층: 원문 충실 가드 — 프리셋별 토글 (fidelity_guard=true일 때만 삽입).
export const FIDELITY_GUARD = `절대 규칙:
- 고유명사·숫자·날짜를 임의로 바꾸지 않는다.
- 원문에 없는 내용을 추가하지 않는다.
- 판단·평가·조언·안전 문구를 넣지 않는다.
- 한국어 메모는 한국어로 유지한다.`;

/** 3층 조립: 하드 계약 + (가드) + 스타일 지시. */
export function buildTransformSystemPrompt(instruction: string, fidelityGuard: boolean): string {
  return [HARD_CONTRACT, fidelityGuard ? FIDELITY_GUARD : null, instruction]
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행. Expected: "4 passed".

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/memo-transform/lib/prompts.ts apps/dashboard/src/features/memo-transform/lib/prompts.test.ts
git commit -m "feat: 프롬프트 3층 재구성 — 하드 계약/충실 가드/스타일 지시 조립 함수"
```

---

### Task 4: preset-resolver — 카탈로그 병합 + 해석

**Files:**
- Create: `apps/dashboard/src/features/memo-transform/lib/catalog-types.ts` (client-safe 순수 타입)
- Create: `apps/dashboard/src/features/memo-transform/lib/preset-resolver.ts` (server-only)
- Test: `apps/dashboard/src/features/memo-transform/lib/preset-resolver.test.ts`
- Modify: `apps/dashboard/src/features/memo-transform/client.ts` (`catalog-types` re-export 추가)

**Interfaces:**
- Consumes: Task 2 repo 함수들, Task 3 `PRESET_INSTRUCTIONS`, 기존 `TRANSFORM_PRESETS`(preset-meta), `TRANSFORM_PRESET_IDS`/`TRANSFORM_PRESET_LABELS`(entities/memo/client)
- Produces (`catalog-types.ts` — 순수, "server-only" 금지):

```ts
export interface PresetCatalogEntry {
  slug: string;
  label: string;
  instruction: string;
  /** 빌트인이면 코드 기본 지시(복구 비교·"기본 프롬프트 보기"용), 커스텀은 null */
  defaultInstruction: string | null;
  fidelityGuard: boolean;
  minInputLen: number;
  isBuiltin: boolean;
  isOverridden: boolean;
}
/** TransformDialog용 슬림 옵션 — 프롬프트 비노출 */
export interface TransformPresetOption {
  slug: string;
  label: string;
  minInputLen: number;
}
```

- Produces (`preset-resolver.ts`):
  - `mergePresetCatalog(rows: MemoTransformPreset[]): PresetCatalogEntry[]` — 순수. 빌트인 7종 고정순(override 행 있으면 instruction/fidelityGuard만 교체, label은 항상 코드 라벨) 뒤에 커스텀(입력 rows의 createdAt 순, rows는 이미 정렬됨).
  - `listPresetCatalog(userId: string): Promise<PresetCatalogEntry[]>` — `listPresetsByUser` 후 merge.
  - `resolvePreset(userId: string, slug: string): Promise<ResolvedPreset | null>` — 빌트인: 코드 기본 + override 병합, 메타(minInputLen/strictPreserve)는 코드 고정. 커스텀: 행 없으면 null, 메타는 `{minInputLen: 1, strictPreserve: false}`.
  - `interface ResolvedPreset { slug: string; label: string; instruction: string; fidelityGuard: boolean; minInputLen: number; strictPreserve: boolean; isBuiltin: boolean; isOverridden: boolean }`

- [ ] **Step 1: 실패하는 테스트 작성** — `mergePresetCatalog` 순수 테스트 5개 (DB 불필요, `MemoTransformPreset` 행은 리터럴로 구성):
  ① 행 없음 → 빌트인 7종 고정순, 전부 `isBuiltin: true, isOverridden: false`, instruction = `PRESET_INSTRUCTIONS[slug]`, `defaultInstruction` 동일
  ② `tidy` override 행 → tidy만 `isOverridden: true`, instruction은 행 값, label은 **코드 라벨 유지**, `defaultInstruction`은 코드 기본값
  ③ 커스텀 행 2개 → 빌트인 7종 뒤에 입력 순서대로, `isBuiltin: false`, `defaultInstruction: null`, `minInputLen: 1`
  ④ override와 커스텀 혼재 → 총 9개(7+2)
  ⑤ 수동 삽입된 비빌트인 slug(`weird-slug`)도 커스텀 취급 (c- 접두사는 판별 조건 아님)
  그리고 `resolvePreset`은 `vi.mock("@/entities/memo/server", ...)`로 `getPresetBySlug`를 모킹해 3개: 빌트인 미override(코드 기본+strictPreserve 코드값) / 커스텀 존재(minInputLen 1) / 미존재 slug null.

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/memo-transform/lib/preset-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현** (`preset-resolver.ts` 핵심):

```ts
import "server-only";
import {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
  type MemoTransformPreset,
} from "@/entities/memo/server";
import { getPresetBySlug, listPresetsByUser } from "@/entities/memo/server";
import { TRANSFORM_PRESETS } from "./preset-meta";
import { PRESET_INSTRUCTIONS } from "./prompts";
import type { PresetCatalogEntry } from "./catalog-types";

export interface ResolvedPreset {
  slug: string;
  label: string;
  instruction: string;
  fidelityGuard: boolean;
  minInputLen: number;
  strictPreserve: boolean;
  isBuiltin: boolean;
  isOverridden: boolean;
}

const BUILTIN = TRANSFORM_PRESET_IDS as readonly string[];

/** 순수 병합 — 빌트인 고정순 + 커스텀(rows 순서 유지). */
export function mergePresetCatalog(rows: MemoTransformPreset[]): PresetCatalogEntry[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const builtins = TRANSFORM_PRESET_IDS.map((slug): PresetCatalogEntry => {
    const ov = bySlug.get(slug);
    return {
      slug,
      label: TRANSFORM_PRESET_LABELS[slug],
      instruction: ov?.instruction ?? PRESET_INSTRUCTIONS[slug],
      defaultInstruction: PRESET_INSTRUCTIONS[slug],
      fidelityGuard: ov?.fidelityGuard ?? true,
      minInputLen: TRANSFORM_PRESETS[slug].minInputLen,
      isBuiltin: true,
      isOverridden: ov !== undefined,
    };
  });
  const customs = rows
    .filter((r) => !BUILTIN.includes(r.slug))
    .map(
      (r): PresetCatalogEntry => ({
        slug: r.slug,
        label: r.label,
        instruction: r.instruction,
        defaultInstruction: null,
        fidelityGuard: r.fidelityGuard,
        minInputLen: 1,
        isBuiltin: false,
        isOverridden: false,
      }),
    );
  return [...builtins, ...customs];
}

export async function listPresetCatalog(userId: string): Promise<PresetCatalogEntry[]> {
  return mergePresetCatalog(await listPresetsByUser(userId));
}

export async function resolvePreset(userId: string, slug: string): Promise<ResolvedPreset | null> {
  const isBuiltin = BUILTIN.includes(slug);
  const row = await getPresetBySlug(userId, slug);
  if (isBuiltin) {
    const id = slug as (typeof TRANSFORM_PRESET_IDS)[number];
    return {
      slug,
      label: TRANSFORM_PRESET_LABELS[id],
      instruction: row?.instruction ?? PRESET_INSTRUCTIONS[id],
      fidelityGuard: row?.fidelityGuard ?? true,
      minInputLen: TRANSFORM_PRESETS[id].minInputLen,
      strictPreserve: TRANSFORM_PRESETS[id].strictPreserve,
      isBuiltin: true,
      isOverridden: row !== null,
    };
  }
  if (!row) return null;
  return {
    slug,
    label: row.label,
    instruction: row.instruction,
    fidelityGuard: row.fidelityGuard,
    minInputLen: 1,
    strictPreserve: false,
    isBuiltin: false,
    isOverridden: false,
  };
}
```

주의: `TRANSFORM_PRESET_LABELS`·`TRANSFORM_PRESET_IDS`가 `entities/memo/server`에서 export되는지 확인 — 안 되어 있으면 server.ts에 `export { TRANSFORM_PRESET_IDS, TRANSFORM_PRESET_LABELS } from "./model/types";` 추가 (types.ts는 순수 모듈이라 안전).

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행. Expected: "8 passed".

- [ ] **Step 5: client.ts re-export** — `features/memo-transform/client.ts`에 `export type { PresetCatalogEntry, TransformPresetOption } from "./lib/catalog-types";` 추가.

- [ ] **Step 6: typecheck + Commit**

```bash
cd apps/dashboard && pnpm typecheck && cd ../..
git add apps/dashboard/src/features/memo-transform/lib/catalog-types.ts apps/dashboard/src/features/memo-transform/lib/preset-resolver.ts apps/dashboard/src/features/memo-transform/lib/preset-resolver.test.ts apps/dashboard/src/features/memo-transform/client.ts apps/dashboard/src/entities/memo/server.ts
git commit -m "feat: preset-resolver — 빌트인+override+커스텀 카탈로그 병합·해석"
```

---

### Task 5: transform-memo resolved 전환 + 액션 갱신 (label 스냅샷·truncated)

**Files:**
- Modify: `apps/dashboard/src/features/memo-transform/lib/transform-memo.ts`
- Modify: `apps/dashboard/src/features/memo-transform/api/transformMemoAction.ts`
- Modify: `apps/dashboard/src/features/memo-transform/api/saveTransformationAction.ts`
- Modify: `apps/dashboard/src/features/memo-transform/lib/prompts.ts` (`GUARDRAIL_PROMPT` 삭제)
- Test: 기존 `transform-memo.test.ts`, `memoTransformActions.test.ts` 갱신

**Interfaces:**
- Consumes: Task 3 `buildTransformSystemPrompt`, Task 4 `resolvePreset`/`ResolvedPreset`
- Produces:
  - `transformMemoContent(input: string, preset: ResolvedPreset): Promise<TransformOutcome>` (systemPrompt = `buildTransformSystemPrompt(preset.instruction, preset.fidelityGuard)`, strictPreserve는 `preset.strictPreserve`, metric key = `` `memo-transform:${preset.isBuiltin ? preset.slug : "custom"}` ``)
  - `transformMemoAction(memoId: string, preset: string): Promise<TransformMemoResult>` — `TransformMemoResult`의 `ok`에 `truncated: boolean` 추가 (`memo.cleanedContent.trim().length > 4_000`), 검증은 `resolvePreset` (null → `invalid`), `too-short`는 `resolved.minInputLen`
  - `saveTransformationAction(memoId, preset, content)` — `isTransformPresetId` 제거, `resolvePreset`으로 검증(null → `invalid`) + `presetLabel: resolved.label` 저장 (클라이언트 라벨 불신)

- [ ] **Step 1: 기존 테스트를 새 시그니처로 갱신 (RED)** — `transform-memo.test.ts`: `transformMemoContent(input, preset)` 호출을 ResolvedPreset 리터럴로 교체. 헬퍼를 파일 상단에 추가:

```ts
const preset = (over: Partial<ResolvedPreset> = {}): ResolvedPreset => ({
  slug: "tidy", label: "정돈", instruction: "스타일: 정돈.", fidelityGuard: true,
  minInputLen: 1, strictPreserve: true, isBuiltin: true, isOverridden: false, ...over,
});
```

기존 케이스 매핑: "요약 축약 정상" → `preset({ slug: "summary", strictPreserve: false })`, "tidy 60% 축약 실패" → `preset()`. 추가 케이스 2개: 커스텀 프리셋 metric key가 `memo-transform:custom`으로 기록되는지 (`logLlmSpend` 모킹 인자 검증), `fidelityGuard: false`면 systemPrompt에 "절대 규칙" 미포함 (`analyzeStructured` 모킹 인자 검증).
`memoTransformActions.test.ts`: `resolvePreset` 모킹(`vi.mock("../lib/preset-resolver")`) 기반으로 교체 — invalid(null)/too-short/ok(truncated 포함)/save 시 `upsertTransformation`에 `presetLabel: "정돈"` 전달/삭제된 프리셋 저장 invalid.

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/memo-transform/lib/transform-memo.test.ts src/features/memo-transform/api/memoTransformActions.test.ts`
Expected: FAIL (시그니처 불일치)

- [ ] **Step 3: 구현** — `transform-memo.ts` 핵심 변경:

```ts
import { buildTransformSystemPrompt } from "./prompts";
import type { ResolvedPreset } from "./preset-resolver";

export async function transformMemoContent(
  input: string,
  preset: ResolvedPreset,
): Promise<TransformOutcome> {
  const text = input.trim();
  if (text.length === 0) return { kind: "failed", reason: "empty-input" };
  const truncated = text.slice(0, MAX_INPUT);
  const metricKey = `memo-transform:${preset.isBuiltin ? preset.slug : "custom"}`;
  try {
    const { object, usage } = await analyzeStructured(truncated, TransformResponseSchema, {
      ...gatewayDefaults,
      model: TRANSFORM_MODEL,
      systemPrompt: buildTransformSystemPrompt(preset.instruction, preset.fidelityGuard),
      maxOutputTokens: 4_000,
    });
    try {
      logLlmSpend(metricKey, TRANSFORM_MODEL, usage);
    } catch {
      /* swallow */
    }
    const content = object.content.trim();
    if (content.length === 0) return { kind: "failed", reason: "empty-output" };
    if (isRefusalDraft(content)) return { kind: "failed", reason: "refusal" };
    if (preset.strictPreserve && isDegenerateCleanup(truncated, content)) {
      return { kind: "failed", reason: "degenerate" };
    }
    return { kind: "ok", content };
  } catch (e) {
    console.error(`[${metricKey}] LLM 호출 실패`, e);
    return { kind: "failed", reason: "llm-error" };
  }
}
```

`transformMemoAction.ts`:

```ts
"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { getMemo } from "@/entities/memo/server";
import { resolvePreset } from "../lib/preset-resolver";
import { transformMemoContent } from "../lib/transform-memo";

// ⚠️ import한 타입 재-export 금지 ("use server" ReferenceError). 결과 타입은 파일 내 선언만.
export type TransformMemoResult =
  | { kind: "ok"; content: string; truncated: boolean }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "too-short" }
  | { kind: "failed"; reason: string };

/** 미리보기 생성 — DB 쓰기 없음. 승인 저장은 saveTransformationAction. */
export async function transformMemoAction(memoId: string, preset: string): Promise<TransformMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const resolved = await resolvePreset(session.user.id, preset);
  if (!resolved) return { kind: "invalid" };

  const memo = await getMemo(session.user.id, memoId);
  if (!memo) return { kind: "not-found" };
  const inputLen = memo.cleanedContent.trim().length;
  if (inputLen < resolved.minInputLen) return { kind: "too-short" };

  const outcome = await transformMemoContent(memo.cleanedContent, resolved);
  if (outcome.kind !== "ok") return outcome;
  return { kind: "ok", content: outcome.content, truncated: inputLen > 4_000 };
}
```

`saveTransformationAction.ts` — `isTransformPresetId(preset)` 검증을 `const resolved = await resolvePreset(session.user.id, preset); if (!resolved) return { kind: "invalid" };`로 교체하고 upsert에 `presetLabel: resolved.label` 전달. `prompts.ts`에서 `GUARDRAIL_PROMPT` 삭제 (참조 0 확인: `grep -rn GUARDRAIL_PROMPT apps/dashboard/src`).

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행. Expected: 전부 PASS.

- [ ] **Step 5: typecheck + Commit**

```bash
cd apps/dashboard && pnpm typecheck && cd ../..
git add apps/dashboard/src/features/memo-transform/
git commit -m "feat: 변환 파이프라인 resolved 프리셋 전환 — label 스냅샷·truncated·metric 고정"
```

---

### Task 6: memo-preset-manage 액션 (Zod + auth + 불변식)

**Files:**
- Create: `apps/dashboard/src/features/memo-preset-manage/api/_schema.ts`
- Create: `apps/dashboard/src/features/memo-preset-manage/api/presetActions.ts`
- Create: `apps/dashboard/src/features/memo-preset-manage/api/previewPresetAction.ts`
- Create: `apps/dashboard/src/features/memo-preset-manage/client.ts`
- Test: `apps/dashboard/src/features/memo-preset-manage/api/presetActions.test.ts`

**Interfaces:**
- Consumes: Task 2 repo, Task 4 resolver·`PRESET_INSTRUCTIONS`, Task 5 `transformMemoContent`
- Produces (모든 액션 auth 필수, revalidate 대상 `/memos`+`/memos/settings`):

```ts
// _schema.ts (순수 — "use server" 아님)
import { z } from "zod";
export const PresetFieldsInput = z.object({
  label: z.string().trim().min(1).max(20),
  instruction: z.string().trim().min(1).max(2000),
  fidelityGuard: z.boolean(),
});
export const SampleTextInput = z.string().trim().min(1).max(4000);
export const MAX_CUSTOM_PRESETS = 20;
```

```ts
// presetActions.ts 결과 타입 (파일 내 선언)
export type PresetActionResult = { kind: "ok" } | { kind: "invalid" } | { kind: "limit-exceeded" } | { kind: "failed" };
export type CreatePresetResult = { kind: "ok"; slug: string } | { kind: "invalid" } | { kind: "limit-exceeded" } | { kind: "failed" };
export async function savePresetAction(slug: string, input: unknown): Promise<PresetActionResult>
export async function createPresetAction(input: unknown): Promise<CreatePresetResult>
export async function resetPresetAction(slug: string): Promise<PresetActionResult>
export async function deletePresetAction(slug: string): Promise<PresetActionResult>
// previewPresetAction.ts
export type PreviewPresetResult = { kind: "ok"; content: string } | { kind: "invalid" } | { kind: "failed" };
export async function previewPresetAction(input: unknown): Promise<PreviewPresetResult>
```

핵심 동작 규칙 (구현·테스트 공통 기준):
0. 모든 액션: `const session = await auth(); if (!session?.user?.id) throw new Error("Unauthorized");` (기존 memo 액션 패턴 미러).
1. `savePresetAction` 빌트인 slug: label은 **무시하고 코드 라벨 강제**. `parsed.instruction === PRESET_INSTRUCTIONS[slug] && parsed.fidelityGuard === true`면 `deletePresetBySlug` (override 삭제 = 기본값 복귀 불변식), 아니면 `upsertPreset`.
2. `savePresetAction` 커스텀 slug: `getPresetBySlug` 없으면 `invalid` (create를 통해서만 생성), 있으면 `upsertPreset`.
3. `createPresetAction`: `countCustomPresets >= MAX_CUSTOM_PRESETS`면 `limit-exceeded`. slug는 `` `c-${crypto.randomUUID().slice(0, 8)}` `` — `insertPreset` 실패 시 slug 재생성 1회 재시도, 재실패면 `failed`.
4. `resetPresetAction`: 빌트인 slug만 허용 (아니면 `invalid`), `deletePresetBySlug`.
5. `deletePresetAction`: 커스텀 slug만 허용 (빌트인이면 `invalid`).
6. `previewPresetAction`: `PresetFieldsInput.pick({ instruction: true, fidelityGuard: true })` + `SampleTextInput` 검증 후 임시 ResolvedPreset(`{slug:"preview", label:"미리보기", minInputLen:1, strictPreserve:false, isBuiltin:false, isOverridden:false}`)으로 `transformMemoContent` 호출. DB 무접촉, revalidate 없음.
7. 1~5 성공 시 `revalidatePath("/memos"); revalidatePath("/memos/settings");`

- [ ] **Step 1: 실패하는 테스트 작성** — `memoManageActions.test.ts` 모킹 패턴 미러 (`vi.mock("@/shared/lib/auth")`, `vi.mock("@/entities/memo/server")`, `vi.mock("next/cache")`, `vi.mock("@/features/memo-transform/lib/transform-memo")`). 케이스 12개: 빌트인 저장(기본값과 다름)→upsert 호출·label은 코드 라벨 / 빌트인 저장(기본값 동일)→delete 호출·upsert 미호출 / 커스텀 저장(행 존재)→upsert / 커스텀 저장(행 없음)→invalid / create 20개 초과→limit-exceeded / create slug 충돌 1회→재시도 ok / reset 커스텀 slug→invalid / delete 빌트인 slug→invalid / 공백-only label→invalid (Zod trim) / instruction 2,001자→invalid (경계값) / auth 세션 없음→throw "Unauthorized" (preview 포함) / preview 정상→transformMemoContent 호출·revalidatePath 미호출.

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/memo-preset-manage/api/presetActions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현** — 위 규칙 1~7 그대로. `presetActions.ts` 골격:

```ts
"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import {
  countCustomPresets, deletePresetBySlug, getPresetBySlug, insertPreset, upsertPreset,
  TRANSFORM_PRESET_IDS, TRANSFORM_PRESET_LABELS,
} from "@/entities/memo/server";
import { PRESET_INSTRUCTIONS } from "@/features/memo-transform/lib/prompts";
import { MAX_CUSTOM_PRESETS, PresetFieldsInput } from "./_schema";

const BUILTIN = TRANSFORM_PRESET_IDS as readonly string[];
function revalidate() {
  revalidatePath("/memos");
  revalidatePath("/memos/settings");
}
```

대표 구현 — `savePresetAction` 전문 (나머지 액션은 규칙 0~7을 같은 형태로):

```ts
export type PresetActionResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "limit-exceeded" }
  | { kind: "failed" };

export async function savePresetAction(slug: string, input: unknown): Promise<PresetActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const parsed = PresetFieldsInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };

  const isBuiltin = BUILTIN.includes(slug);
  try {
    if (isBuiltin) {
      const id = slug as (typeof TRANSFORM_PRESET_IDS)[number];
      const isDefault =
        parsed.data.instruction === PRESET_INSTRUCTIONS[id] && parsed.data.fidelityGuard === true;
      if (isDefault) {
        // 기본값과 동일한 저장은 override 삭제 = "행 없음=기본값 자동 반영" 불변식 보존.
        await deletePresetBySlug(session.user.id, slug);
      } else {
        await upsertPreset({
          userId: session.user.id,
          slug,
          label: TRANSFORM_PRESET_LABELS[id], // 빌트인 라벨은 코드 강제 (클라이언트 값 무시)
          instruction: parsed.data.instruction,
          fidelityGuard: parsed.data.fidelityGuard,
        });
      }
    } else {
      const existing = await getPresetBySlug(session.user.id, slug);
      if (!existing) return { kind: "invalid" }; // 커스텀 생성은 createPresetAction 전용
      await upsertPreset({ userId: session.user.id, slug, ...parsed.data });
    }
    revalidate();
    return { kind: "ok" };
  } catch {
    return { kind: "failed" };
  }
}
```

`client.ts`는 액션 4+1개만 re-export (타입은 각 파일 내 선언이라 `export type { ... } from` 안전 — memo-transform/client.ts 주석 패턴 동일).

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행. Expected: "10 passed".

- [ ] **Step 5: typecheck + Commit**

```bash
cd apps/dashboard && pnpm typecheck && cd ../..
git add apps/dashboard/src/features/memo-preset-manage/
git commit -m "feat: 프리셋 설정 액션 — 저장/복구/생성/삭제/미리보기 (기본값 동일 시 DELETE 불변식)"
```

---

### Task 7: /memos/settings 설정 페이지 UI

**Files:**
- Create: `apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.tsx` (master-detail 셸 + 목록)
- Create: `apps/dashboard/src/features/memo-preset-manage/ui/PresetEditor.tsx` (편집기 + 테스트 패널)
- Create: `apps/dashboard/src/app/(dashboard)/memos/settings/page.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/memos/page.tsx` (PageHeader actions에 설정 링크)
- Test: `apps/dashboard/src/features/memo-preset-manage/ui/PresetSettings.test.tsx`

**Interfaces:**
- Consumes: Task 4 `listPresetCatalog`·`PresetCatalogEntry`, Task 6 액션들 (`@/features/memo-preset-manage/client` — 자기 feature 내부는 상대 경로 `../client`)
- Produces: `PresetSettings({ catalog }: { catalog: PresetCatalogEntry[] })`

**UI 사양 (스펙 §6):**
- `page.tsx`(RSC): auth → redirect("/login") 미러(기존 memos/page.tsx 패턴), `listPresetCatalog` 로드, `PageContainer width="narrow"` + `PageHeader title="AI 정리 스타일 설정"` + 뒤로가기는 PageHeader `actions`에 `<Link href="/memos">← 메모</Link>`.
- `PresetSettings`("use client"): 데스크톱 `md:grid md:grid-cols-[280px_1fr]` 2컬럼, 모바일은 선택 시 편집기만 표시(목록 `hidden md:block` 토글 + 편집기 상단 `← 목록` 버튼). 좌측: "기본 프리셋" 섹션(7종, `isOverridden`이면 `수정됨` amber 배지, 아니면 `기본` neutral 배지) + "내 프리셋" 섹션(`커스텀` 배지) + `+ 새 프리셋` 버튼. 각 항목: 라벨 + 배지 + instruction 첫 줄 미리보기(`truncate`). 항목 전환 시 편집기 dirty면 `window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?")`.
- `PresetEditor` props: `{ entry: PresetCatalogEntry | null /* null=새 커스텀 */, onDone: () => void }`. 필드: 라벨 input(빌트인 read-only, `maxLength={20}`), instruction textarea(`maxLength={2000}` + 남은 글자 수), 충실 가드 체크박스(+설명 한 줄 "고유명사·내용 보존, 조언 금지"), 빌트인 & `isOverridden`이면 `<details>`로 "기본 프롬프트 보기"(`defaultInstruction`) + `기본값 복구` 버튼(confirm → `resetPresetAction`), 커스텀이면 `삭제` 버튼(confirm "기존 변환본은 보존됩니다" → `deletePresetAction`). 테스트 패널: 샘플 textarea(프리필 "음… 내일 오전에 김대리랑 회의 있고, 끝나면 보고서 초안 써야 함.") + `▶ 테스트 실행`(`previewPresetAction`, 실행 중 disabled) + 결과 `<pre>`/실패 문구. 저장 버튼: dirty && 필드 유효할 때만 활성 — 신규는 `createPresetAction`, 기존은 `savePresetAction`. 액션 성공 시 `router.refresh()`(next/navigation) 후 `onDone()`; 실패 kind별 인라인 문구(`invalid`: "입력을 확인해 주세요", `limit-exceeded`: "커스텀 프리셋은 최대 20개입니다", `failed`: "저장에 실패했습니다").
- 접근성: 배지에 색만 의존 금지(텍스트 배지), 편집기 landmark `aria-label`, confirm은 window.confirm으로 충분(개인용 v1).

- [ ] **Step 1: 실패하는 컴포넌트 테스트 작성** (`PresetSettings.test.tsx`, jsdom — `MemoComposer.test.tsx` setup 미러, 액션 모듈 전체 `vi.mock("../client")`) — 케이스 5개: ① 카탈로그 7+1개 렌더 시 섹션 2개와 배지(기본 6·수정됨 1·커스텀 1) ② 항목 클릭 → 편집기에 해당 instruction 표시 ③ instruction 수정 후 다른 항목 클릭 → confirm 호출(모킹) ④ 커스텀 선택 시 삭제 버튼 노출·빌트인 선택 시 미노출 ⑤ `+ 새 프리셋` 클릭 → 빈 편집기(라벨 입력 가능).

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/memo-preset-manage/ui/PresetSettings.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 구현** — 위 사양대로 두 컴포넌트 + 라우트. `memos/page.tsx`에는 `<PageHeader title="메모" subtitle=... actions={<Link href="/memos/settings" className="text-sm text-neutral-500 hover:text-neutral-900">⚙ AI 정리 설정</Link>} />` (PageHeader에 actions prop 존재 확인됨).

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행. Expected: "5 passed".

- [ ] **Step 5: typecheck + lint + Commit**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && cd ../..
git add apps/dashboard/src/features/memo-preset-manage/ui/ "apps/dashboard/src/app/(dashboard)/memos/"
git commit -m "feat: /memos/settings 프리셋 설정 페이지 — master-detail·배지·테스트 실행"
```

---

### Task 8: TransformDialog 카탈로그화 + MemoCard tagged view + prop 스레딩

**Files:**
- Modify: `apps/dashboard/src/features/memo-transform/ui/TransformDialog.tsx`
- Modify: `apps/dashboard/src/entities/memo/ui/MemoCard.tsx`
- Modify: `apps/dashboard/src/features/memo-manage/ui/MemoList.tsx`
- Modify: `apps/dashboard/src/widgets/memo/ui/MemoWidget.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/memos/page.tsx`
- Test: 기존 `TransformDialog.test.tsx`, `MemoCard.test.tsx` 갱신

**Interfaces:**
- Consumes: Task 4 `TransformPresetOption`·`listPresetCatalog`, Task 5 `truncated`
- Produces:
  - `TransformDialogProps { memo: Memo; presets: TransformPresetOption[]; existingPresets: string[]; onClose: () => void }`
  - `MemoListProps`·`MemoWidgetProps`에 `presets: TransformPresetOption[]` 추가
  - MemoCard 내부 `type MemoView = { kind: "cleaned" } | { kind: "raw" } | { kind: "preset"; slug: string }`

- [ ] **Step 1: 기존 테스트 갱신 (RED)** —
  `TransformDialog.test.tsx`: props에 `presets`(7종을 `{slug,label,minInputLen}`로 구성) 전달로 교체. 추가 케이스 3개: 커스텀 프리셋 옵션 렌더 / `truncated: true` 응답 시 미리보기에 "원문이 길어 앞부분(4,000자)만 변환되었습니다" 표시 / too-short는 카탈로그 `minInputLen` 기준.
  `MemoCard.test.tsx`: 칩 정렬 단언을 갱신 — 케이스 3개: 커스텀 변환본(`preset: "c-abc12345", presetLabel: "코칭"`)이 빌트인 칩 **뒤에** 오고 라벨 "코칭" 표시 / `presetLabel: null`인 빌트인은 코드 라벨 폴백 / 커스텀 2개는 라벨 사전순.

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/features/memo-transform/ui/TransformDialog.test.tsx src/entities/memo/ui/MemoCard.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현** —
  **TransformDialog**: `TRANSFORM_PRESET_IDS.map` → `presets.map((p) => ...)`, 라벨은 `p.label`, `tooShort = inputLen < p.minInputLen`, `run(slug: string)`, `preset` state는 `string | null`, 교체 경고 라벨은 `presets.find((x) => x.slug === preset)?.label ?? preset`. preview에 truncated 상태 저장 후:

```tsx
{truncated && (
  <p className="mb-2 text-xs text-neutral-500">원문이 길어 앞부분(4,000자)만 변환되었습니다.</p>
)}
```

  **MemoCard**: 칩 정렬·라벨 (교체 코드):

```ts
function chipLabel(t: MemoTransformation): string {
  return (
    t.presetLabel ??
    TRANSFORM_PRESET_LABELS[t.preset as TransformPresetId] ??
    t.preset
  );
}
const BUILTIN = TRANSFORM_PRESET_IDS as readonly string[];
const sortedTransformations = [...transformations].sort((a, b) => {
  const ai = BUILTIN.indexOf(a.preset);
  const bi = BUILTIN.indexOf(b.preset);
  const ar = ai === -1 ? BUILTIN.length : ai;
  const br = bi === -1 ? BUILTIN.length : bi;
  if (ar !== br) return ar - br;
  return chipLabel(a).localeCompare(chipLabel(b), "ko");
});
```

  view 상태를 tagged로: `useState<MemoView>({ kind: "cleaned" })`, 칩 key는 `t.preset`, body는 `view.kind === "preset" ? (transformations.find((t) => t.preset === view.slug)?.content ?? memo.cleanedContent) : ...`, `aria-pressed`는 kind+slug 비교.
  **MemoList**: props에 `presets: TransformPresetOption[]` 추가, TransformDialog에 `presets` 전달, `existingPresets`는 `(transformationsByMemo[...] ?? []).map((t) => t.preset)` (cast 제거).
  **MemoWidget**: `presets` prop 추가·전달.
  **page.tsx**: `Promise.all`에 `listPresetCatalog(session.user.id)` 추가 후 슬림 매핑:

```ts
const presetOptions = catalog.map(({ slug, label, minInputLen }) => ({ slug, label, minInputLen }));
```

`<MemoWidget memos={...} transformationsByMemo={...} presets={presetOptions} />`. import는 `@/features/memo-transform/lib/preset-resolver` (RSC — server-only OK).

- [ ] **Step 4: 통과 확인** — Step 2 명령 재실행 + 전체 메모 테스트:

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo src/features/memo-transform src/features/memo-manage src/features/memo-preset-manage`
Expected: 전부 PASS

- [ ] **Step 5: typecheck + lint + Commit**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && cd ../..
git add apps/dashboard/src/features/memo-transform/ui/ apps/dashboard/src/entities/memo/ui/ apps/dashboard/src/features/memo-manage/ui/MemoList.tsx apps/dashboard/src/widgets/memo/ui/MemoWidget.tsx "apps/dashboard/src/app/(dashboard)/memos/page.tsx"
git commit -m "feat: 변환 UI 카탈로그화 — 커스텀 프리셋 표시·칩 정렬·절단 안내"
```

---

### Task 9: 전체 검증 + build

- [ ] **Step 1: 전체 스위트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: typecheck/lint 클린. 테스트는 기존 기지 실패(tiger-profile 통합 1건 — 테스트 DB CHECK 미적용 기지 이슈) 외 전부 PASS.

- [ ] **Step 2: production build** (barrel seam 검증 — Gotcha #7)

Run: `cd apps/dashboard && pnpm build`
Expected: 성공 + `/memos/settings` 라우트 출력에 포함.

- [ ] **Step 3: 신규 테스트 파일 단일 경로 재확인** — Task 2·3·4·6·7 신규 테스트 5개 파일을 각각 단일 경로로 실행해 "N passed, 0 skipped" 확인 (vitest include 함정).

- [ ] **Step 4: Commit (잔여 변경 있으면)** — 없으면 스킵.

---

## 배포 노트 (계획 밖 운영 절차 — 구현 완료 후 수행)

1. PR 생성·머지 → GHA Build & Push 대기.
2. **운영 DDL 먼저** (psql BEGIN/COMMIT 수동 — drizzle-kit migrate 운영 broken):
   사전 확인 `SELECT conname FROM pg_constraint WHERE conname = 'memo_transformations_preset_check';` → 존재 확인 후 `drizzle/0037_*.sql` 내용을 BEGIN/COMMIT으로 감싸 적용.
3. 이미지 pull/up (`--no-deps`, `.env`의 `APP_IMAGE_REF` digest 갱신 주의) → health/route 검증.
4. dogfood smoke: `/memos/settings`에서 빌트인 1개 수정→변환 반영→기본값 복구, 커스텀 1개 생성→변환→삭제.
