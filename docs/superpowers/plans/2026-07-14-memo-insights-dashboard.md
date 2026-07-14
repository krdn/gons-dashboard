# 메모 인사이트 대시보드 (`/memos/insights`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제로 쌓인 메모 데이터를 분석해 개인 인사이트 대시보드(`/memos/insights`)로 시각화한다 — 기록 활동·카테고리 분포·메모→액션 전환·주간 회고 4개 축.

**Architecture:** `/memos/architecture`(PR #301) 패턴 미러링. 새 RSC 라우트가 `entities/memo/server`에서 캡 없는 원시 데이터를 조회하고, `widgets/memo-insights/server`의 순수 집계 함수 5개로 차트-ready 데이터를 만든 뒤, `"use client"` recharts 뷰(`widgets/memo-insights` index.ts)에 props로 넘긴다. 집계는 전부 서버 RSC에서 끝나고 raw 메모는 클라이언트로 넘기지 않는다.

**Tech Stack:** Next.js 16 App Router (RSC), TypeScript strict, Drizzle ORM, recharts 3.8.1 (설치됨), Vitest, Tailwind v4 (라이트 모드 고정 + `globals.css` 토큰), FSD.

## Global Constraints

- **FSD 의존성 방향**: `app → widgets → entities → shared`. 라우트는 조회를 `entities/memo/server`, 집계를 `widgets/memo-insights/server`에서만 import. 집계 deep import(`lib/aggregate`) 금지 — 반드시 `server.ts` 경유. 클라이언트 뷰는 `widgets/memo-insights`(index.ts)로만 노출.
- **server/client seam (Gotcha #7)**: `widgets/memo-insights/server.ts`는 RSC 전용 진입점(순수 집계 함수 re-export). `index.ts`는 `"use client"` 뷰 barrel. 집계 결과 타입은 `model/types.ts`(중립 모듈 — server/client 양쪽 import 가능, DOM/DB 의존 없음)에 둔다. **검증은 typecheck+lint로 안 잡힘 — `cd apps/dashboard && pnpm build` 필수.**
- **캡 없는 조회 (load-bearing)**: `memoRepo.listMemos`의 `LIMIT 200`을 인사이트에 쓰면 안 된다. 신규 `listMemoFactsForInsights`는 `.limit()` 없이 조회.
- **KST 날짜 계약**: 기준 시각 `now: Date`를 RSC 페이지에서 `new Date()`로 **한 번** 캡처해 시간 의존 집계 함수에 주입. 함수 내부에서 `new Date()` 금지(순수성). 모든 일자 버킷은 KST(Asia/Seoul) 자정 경계.
- **타입 좁히기**: `memos.source`·`memo_action_items.status`는 bare `text()`라 Drizzle select 타입이 `string`. projection 시 `MemoSource`(`'voice'|'text'`)·`ActionItemStatus`로 좁힌다(값은 DB CHECK로 보장).
- **locale 함정 (Gotcha #3)**: 클라이언트 차트 축·라벨 날짜는 locale-free(`YYYY-MM-DD`, `MM/DD`). 서버 RSC 집계 내부에서만 `toLocaleDateString` 허용.
- **라이트 모드 고정**: dark variant 사용 금지. `globals.css` 디자인 토큰 재사용.
- **통합 테스트**: `TEST_DATABASE_URL` 필요. 로컬 DB 미기동 시 통합 테스트는 `ECONNREFUSED`로 fail — 순수 단위 테스트만 통과해도 OK. 실행: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`.
- **커밋 컨벤션**: `feat:`/`test:` 등 한국어 제목, 50자 이내.

---

## 파일 구조

**수정:**
- `apps/dashboard/src/entities/memo/api/memoRepo.ts` — `listMemoFactsForInsights` 추가
- `apps/dashboard/src/entities/memo/api/memoDigestRepo.ts` — `listDigestsByUser` 추가
- `apps/dashboard/src/entities/memo/model/types.ts` — `MemoFact` 타입 추가
- `apps/dashboard/src/entities/memo/server.ts` — 신규 함수·타입 export
- `apps/dashboard/src/app/(dashboard)/memos/page.tsx` — `📊 인사이트` 헤더 링크

**신규:**
- `apps/dashboard/src/widgets/memo-insights/model/types.ts` — 집계 결과 타입(중립 모듈)
- `apps/dashboard/src/widgets/memo-insights/lib/aggregate.ts` — 순수 집계 함수 5개
- `apps/dashboard/src/widgets/memo-insights/lib/aggregate.test.ts` — 단위 테스트
- `apps/dashboard/src/widgets/memo-insights/server.ts` — 집계 re-export(RSC 진입점)
- `apps/dashboard/src/widgets/memo-insights/index.ts` — 클라이언트 뷰 barrel
- `apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx` — `"use client"` 최상위 뷰
- `apps/dashboard/src/widgets/memo-insights/ui/ActivityBlock.tsx` — 블록 A(히트맵+추이)
- `apps/dashboard/src/widgets/memo-insights/ui/CategoryBlock.tsx` — 블록 B(도넛+voice/text)
- `apps/dashboard/src/widgets/memo-insights/ui/ConversionBlock.tsx` — 블록 C(퍼널+상태 스냅샷+변환)
- `apps/dashboard/src/widgets/memo-insights/ui/DigestTimelineBlock.tsx` — 블록 D(주간 타임라인)
- `apps/dashboard/src/app/(dashboard)/memos/insights/page.tsx` — RSC 라우트

---

## Task 1: 데이터 계층 — 캡 없는 조회 함수 2건 + `MemoFact` 타입

**Files:**
- Modify: `apps/dashboard/src/entities/memo/model/types.ts` (line 18 근처, `MemoSource` 뒤)
- Modify: `apps/dashboard/src/entities/memo/api/memoRepo.ts`
- Modify: `apps/dashboard/src/entities/memo/api/memoDigestRepo.ts`
- Modify: `apps/dashboard/src/entities/memo/server.ts`
- Test: `apps/dashboard/src/entities/memo/api/memoRepo.test.ts` (기존 파일에 케이스 추가), `apps/dashboard/src/entities/memo/api/memoDigestRepo.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Produces:
  - `MemoFact = { id: string; source: MemoSource; category: string | null; createdAt: Date; actionsExtractedAt: Date | null }` (in `model/types.ts`)
  - `listMemoFactsForInsights(userId: string): Promise<MemoFact[]>` — createdAt asc, 캡 없음
  - `listDigestsByUser(userId: string): Promise<MemoDigest[]>` — weekEnd asc
  - 위 둘 + `MemoFact` 타입을 `entities/memo/server` 에서 export

- [ ] **Step 1: `MemoFact` 타입을 `model/types.ts`에 추가**

`apps/dashboard/src/entities/memo/model/types.ts` 의 `export type MemoSource = "voice" | "text";` (line 18) 바로 아래에 추가:

```typescript
// 인사이트 집계 축만 담은 경량 projection — 전체 텍스트(raw/cleaned/title) 제외.
// content를 빼면 수천 행도 가볍다. 캡 없이 전량 조회하는 listMemoFactsForInsights의 반환 원소.
export interface MemoFact {
  id: string;
  source: MemoSource;
  category: string | null;
  createdAt: Date;
  actionsExtractedAt: Date | null;
}
```

- [ ] **Step 2: `listMemoFactsForInsights` 실패 테스트 작성**

`apps/dashboard/src/entities/memo/api/memoRepo.test.ts` 의 import 목록(line 6-19)에 `listMemoFactsForInsights` 를 추가하고, `describe("memoRepo", …)` 블록 끝(파일 마지막 `});` 직전)에 케이스 추가:

```typescript
  it("listMemoFactsForInsights는 캡(200) 없이 전량을 createdAt asc로 반환한다", async () => {
    // 201건 삽입 — LIMIT 200 캡 회피가 load-bearing 요구이므로 명시 가드.
    const rows = Array.from({ length: 201 }, (_, i) => ({
      ...base,
      title: `m${i}`,
      rawContent: `c${i}`,
      cleanedContent: `c${i}`,
    }));
    await db.insert(memos).values(rows);
    const facts = await listMemoFactsForInsights(USER_ID);
    expect(facts.length).toBe(201);
    // asc 정렬
    for (let i = 1; i < facts.length; i++) {
      expect(facts[i].createdAt.getTime()).toBeGreaterThanOrEqual(
        facts[i - 1].createdAt.getTime(),
      );
    }
    // projection 필드만 — content 없음
    expect(facts[0]).not.toHaveProperty("rawContent");
    expect(facts[0].source).toBe("text");
  });
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoRepo.test.ts -t "listMemoFactsForInsights"`
Expected: FAIL — `listMemoFactsForInsights is not a function` (또는 import 에러). DB 미기동이면 `ECONNREFUSED`로 fail — 이 경우 구현 후 로컬 DB 띄워 재확인.

- [ ] **Step 4: `listMemoFactsForInsights` 구현**

`apps/dashboard/src/entities/memo/api/memoRepo.ts` 의 import에 `MemoFact` 를 추가하고(line 5: `import type { Memo, MemoSource, MemoFact } from "../model/types";`), `listMemos` 함수(line 12-19) 바로 아래에 추가:

```typescript
/**
 * 인사이트 전용 조회 — 집계 축만 SELECT(전체 텍스트 제외), 캡 없음.
 * listMemos의 LIMIT 200은 인사이트에서 히트맵·총계·비율을 조용히 잘라 틀린 값을 낸다.
 * source는 bare text()라 select 타입이 string — MemoSource로 좁힌다(값은 DB CHECK로 보장).
 */
export async function listMemoFactsForInsights(userId: string): Promise<MemoFact[]> {
  const rows = await db
    .select({
      id: memos.id,
      source: memos.source,
      category: memos.category,
      createdAt: memos.createdAt,
      actionsExtractedAt: memos.actionsExtractedAt,
    })
    .from(memos)
    .where(eq(memos.userId, userId))
    .orderBy(asc(memos.createdAt));
  return rows.map((r) => ({ ...r, source: r.source as MemoSource }));
}
```

- [ ] **Step 5: `listDigestsByUser` 실패 테스트 작성**

`apps/dashboard/src/entities/memo/api/memoDigestRepo.test.ts` 의 import(line 5)에 `listDigestsByUser` 추가, `describe` 블록 끝(line 62 `});` 직전)에 추가:

```typescript
  it("listDigestsByUser는 weekEnd 오름차순 전량을 반환한다", async () => {
    await insertDigest({ ...base, weekEnd: "2026-07-05", summary: "둘째" });
    await insertDigest({ ...base, weekEnd: "2026-06-28", summary: "첫째" });
    await insertDigest({ ...base, weekEnd: "2026-07-12", summary: "셋째" });
    const list = await listDigestsByUser(USER_ID);
    expect(list.map((d) => d.weekEnd)).toEqual(["2026-06-28", "2026-07-05", "2026-07-12"]);
  });

  it("다이제스트 없는 사용자는 빈 배열", async () => {
    expect(await listDigestsByUser("00000000-0000-0000-0000-000000000fff")).toEqual([]);
  });
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoDigestRepo.test.ts -t "listDigestsByUser"`
Expected: FAIL — `listDigestsByUser is not a function`.

- [ ] **Step 7: `listDigestsByUser` 구현**

`apps/dashboard/src/entities/memo/api/memoDigestRepo.ts` 의 import에 `asc` 추가(line 2: `import { and, asc, desc, eq } from "drizzle-orm";`), `getLatestDigest` 함수(line 33-41) 아래에 추가:

```typescript
/** 인사이트 주간 타임라인용 — 소유자 전체 다이제스트, weekEnd 오름차순. */
export function listDigestsByUser(userId: string): Promise<MemoDigest[]> {
  return db
    .select()
    .from(memoDigests)
    .where(eq(memoDigests.userId, userId))
    .orderBy(asc(memoDigests.weekEnd));
}
```

- [ ] **Step 8: `entities/memo/server.ts`에 export 추가**

`apps/dashboard/src/entities/memo/server.ts` 의 memoRepo export 블록(`listMemos, getMemo, …` line 3-18)에 `listMemoFactsForInsights,` 추가, memoDigestRepo export 블록(line 19-24)에 `listDigestsByUser,` 추가. 타입 export 블록(하단 `export type { Memo, MemoSource, MemoDigest, … }`)에 `MemoFact,` 추가.

- [ ] **Step 9: 전체 테스트·타입 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/entities/memo/api/memoRepo.test.ts src/entities/memo/api/memoDigestRepo.test.ts`
Expected: 신규 케이스 PASS (DB 기동 시). 이어서 `cd apps/dashboard && pnpm typecheck` → 에러 없음.

- [ ] **Step 10: 커밋**

```bash
git add apps/dashboard/src/entities/memo/model/types.ts apps/dashboard/src/entities/memo/api/memoRepo.ts apps/dashboard/src/entities/memo/api/memoDigestRepo.ts apps/dashboard/src/entities/memo/server.ts apps/dashboard/src/entities/memo/api/memoRepo.test.ts apps/dashboard/src/entities/memo/api/memoDigestRepo.test.ts
git commit -m "feat: 메모 인사이트용 캡 없는 조회 함수 2건 추가"
```

---

## Task 2: 위젯 집계 결과 타입 (`model/types.ts`)

**Files:**
- Create: `apps/dashboard/src/widgets/memo-insights/model/types.ts`

**Interfaces:**
- Consumes: `ActionItemStatus`(`entities/memo/server`)를 여기서 재선언하지 않고 import하면 FSD 위반 아님(widgets→entities 허용). 단 이 파일은 **중립 모듈**이라 server-only/DOM 의존을 넣지 않는다 — `ActionItemStatus`는 순수 문자열 유니온이라 import 안전.
- Produces (later tasks 전부가 이 타입들에 의존):
  - `DayCell`, `ActivityHeatmap`, `DailyTrendPoint`, `CategoryDistribution`, `ActionConversion`, `DigestTimelinePoint`

- [ ] **Step 1: 타입 파일 작성**

`apps/dashboard/src/widgets/memo-insights/model/types.ts` 생성:

```typescript
// 인사이트 집계 결과 타입 — 중립 모듈(server.ts·client 뷰 공유, DOM/DB 의존 없음).
// lib/aggregate.ts가 생산하고 ui/*가 소비한다.
import type { ActionItemStatus } from "@/entities/memo/server";

/** 히트맵 한 칸 — locale-free 날짜 + 그 날 메모 수. count:0 셀도 존재. */
export interface DayCell {
  date: string; // 'YYYY-MM-DD' (KST)
  count: number;
}

export interface ActivityHeatmap {
  weeks: DayCell[][]; // 26주 × 7일 고정 그리드
  windowCount: number; // 182일 창 내부 메모 수 (분자)
  totalCount: number; // 전체 이력 수 (요약 표시용)
  currentStreak: number;
  longestStreak: number;
  dailyAvg: number; // windowCount / 182
}

export interface DailyTrendPoint {
  date: string; // 'YYYY-MM-DD'
  count: number;
}

export interface CategoryDistribution {
  byCategory: { slug: string; labelKo: string; count: number }[];
  voiceCount: number;
  textCount: number;
  unclassifiedCount: number;
}

export interface ActionConversion {
  // 메모 단위 퍼널 (단조 감소 보장)
  totalMemos: number;
  processedMemos: number; // actionsExtractedAt != null 메모 수
  memosWithActions: number; // 액션 행 1개 이상인 고유 memoId 수
  // 액션-행 단위 현재 상태 분포 (퍼널 밖, 별도 표시)
  currentStatusCounts: Record<ActionItemStatus, number>;
  // 변환본
  transformCount: number;
  transformByPreset: { slug: string; label: string; count: number }[];
}

export interface DigestTimelinePoint {
  weekEnd: string; // 'YYYY-MM-DD'
  memoCount: number;
  resurfacedCount: number;
}
```

- [ ] **Step 2: 타입 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 에러 없음 (타입만 있어 미사용 경고도 없음).

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-insights/model/types.ts
git commit -m "feat: 메모 인사이트 집계 결과 타입 정의"
```

---

## Task 3: 순수 집계 함수 5개 (`lib/aggregate.ts`) + 단위 테스트

**Files:**
- Create: `apps/dashboard/src/widgets/memo-insights/lib/aggregate.ts`
- Create: `apps/dashboard/src/widgets/memo-insights/lib/aggregate.test.ts`
- Create: `apps/dashboard/src/widgets/memo-insights/server.ts`

**Interfaces:**
- Consumes: `MemoFact`, `MemoDigest`, `MemoActionItem`, `MemoTransformation`, `MemoCategoryRow`, `ActionItemStatus`, `TRANSFORM_PRESET_LABELS`, `TransformPresetId` — 전부 `entities/memo/server` 에서 import. 결과 타입은 `../model/types`.
- Produces (Task 5 라우트가 `server.ts` 경유로 호출):
  - `buildActivityHeatmap(facts: MemoFact[], now: Date): ActivityHeatmap`
  - `buildDailyTrend(facts: MemoFact[], now: Date, days?: number): DailyTrendPoint[]`
  - `buildCategoryDistribution(facts: MemoFact[], categories: MemoCategoryRow[]): CategoryDistribution`
  - `buildActionConversion(facts: MemoFact[], actionItems: MemoActionItem[], transformations: MemoTransformation[]): ActionConversion`
  - `buildDigestTimeline(digests: MemoDigest[]): DigestTimelinePoint[]`

- [ ] **Step 1: 실패 테스트 작성 (빈 배열 + KST 경계 + 퍼널 불변식)**

`apps/dashboard/src/widgets/memo-insights/lib/aggregate.test.ts` 생성:

```typescript
import { describe, it, expect } from "vitest";
import type { MemoFact, MemoDigest, MemoActionItem, MemoTransformation } from "@/entities/memo/server";
import type { MemoCategoryRow } from "@/entities/memo/server";
import {
  buildActivityHeatmap,
  buildDailyTrend,
  buildCategoryDistribution,
  buildActionConversion,
  buildDigestTimeline,
} from "./aggregate";

// KST 자정 = UTC 15:00 전날. 2026-07-14 12:00 KST == 2026-07-14T03:00:00Z.
const NOW = new Date("2026-07-14T03:00:00Z");

let idSeq = 0;
const nextId = () => `id-${idSeq++}`; // 결정적 고유 id (crypto 선례 없음)

function fact(overrides: Partial<MemoFact> = {}): MemoFact {
  return {
    id: nextId(),
    source: "text",
    category: null,
    createdAt: NOW,
    actionsExtractedAt: null,
    ...overrides,
  };
}
// KST 자정 기준 날짜의 정오 UTC Date 생성 (버킷 경계 안전).
function kstNoon(dateStr: string): Date {
  return new Date(`${dateStr}T03:00:00Z`); // 정오 KST
}

describe("buildActivityHeatmap", () => {
  it("빈 입력 — 26주 고정 그리드, 모든 카운트 0", () => {
    const h = buildActivityHeatmap([], NOW);
    expect(h.weeks.length).toBe(26);
    expect(h.weeks.every((w) => w.length === 7)).toBe(true);
    expect(h.windowCount).toBe(0);
    expect(h.totalCount).toBe(0);
    expect(h.currentStreak).toBe(0);
    expect(h.longestStreak).toBe(0);
    expect(h.dailyAvg).toBe(0);
  });

  it("오늘 미기록이면 streak을 0으로 만들지 않고 어제부터 센다", () => {
    // 어제·그저께 기록, 오늘 없음
    const facts = [
      fact({ createdAt: kstNoon("2026-07-13") }),
      fact({ createdAt: kstNoon("2026-07-12") }),
    ];
    const h = buildActivityHeatmap(facts, NOW);
    expect(h.currentStreak).toBe(2);
  });

  it("windowCount는 182일 창 내부만, totalCount는 전체", () => {
    const facts = [
      fact({ createdAt: kstNoon("2026-07-13") }), // 창 내
      fact({ createdAt: new Date("2020-01-01T03:00:00Z") }), // 창 밖(과거)
    ];
    const h = buildActivityHeatmap(facts, NOW);
    expect(h.totalCount).toBe(2);
    expect(h.windowCount).toBe(1);
    expect(h.dailyAvg).toBeCloseTo(1 / 182, 6);
  });
});

describe("buildDailyTrend", () => {
  it("빈 입력 — days개 연속 날짜 모두 count:0", () => {
    const t = buildDailyTrend([], NOW, 30);
    expect(t.length).toBe(30);
    expect(t.every((p) => p.count === 0)).toBe(true);
    expect(t[t.length - 1].date).toBe("2026-07-14"); // 마지막=오늘 KST
  });

  it("특정 날짜 카운트 집계", () => {
    const facts = [
      fact({ createdAt: kstNoon("2026-07-14") }),
      fact({ createdAt: kstNoon("2026-07-14") }),
      fact({ createdAt: kstNoon("2026-07-13") }),
    ];
    const t = buildDailyTrend(facts, NOW, 30);
    expect(t.find((p) => p.date === "2026-07-14")?.count).toBe(2);
    expect(t.find((p) => p.date === "2026-07-13")?.count).toBe(1);
  });
});

describe("buildCategoryDistribution", () => {
  const cats: MemoCategoryRow[] = [
    { id: "idea", labelKo: "아이디어", isSeed: true, createdAt: NOW },
    { id: "todo", labelKo: "할 일", isSeed: true, createdAt: NOW },
  ];
  it("빈 입력 — 전부 0", () => {
    const d = buildCategoryDistribution([], cats);
    expect(d.byCategory).toEqual([]);
    expect(d.voiceCount).toBe(0);
    expect(d.textCount).toBe(0);
    expect(d.unclassifiedCount).toBe(0);
  });
  it("카테고리·소스·미분류 집계 + labelKo 매핑", () => {
    const facts = [
      fact({ category: "idea", source: "voice" }),
      fact({ category: "idea", source: "text" }),
      fact({ category: null, source: "text" }),
    ];
    const d = buildCategoryDistribution(facts, cats);
    expect(d.byCategory).toContainEqual({ slug: "idea", labelKo: "아이디어", count: 2 });
    expect(d.voiceCount).toBe(1);
    expect(d.textCount).toBe(2);
    expect(d.unclassifiedCount).toBe(1);
  });
});

describe("buildActionConversion", () => {
  function ai(overrides: Partial<MemoActionItem>): MemoActionItem {
    return {
      id: nextId(),
      memoId: "m1",
      userId: "u1",
      kind: "todo",
      title: "t",
      dueAt: null,
      allDay: false,
      status: "proposed",
      remindedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    } as MemoActionItem;
  }
  it("빈 입력 — 퍼널 0, 상태 카운트 4키 모두 0", () => {
    const c = buildActionConversion([], [], []);
    expect(c.totalMemos).toBe(0);
    expect(c.processedMemos).toBe(0);
    expect(c.memosWithActions).toBe(0);
    expect(c.currentStatusCounts).toEqual({ proposed: 0, accepted: 0, dismissed: 0, done: 0 });
    expect(c.transformCount).toBe(0);
    expect(c.transformByPreset).toEqual([]);
  });
  it("퍼널 불변식 totalMemos >= processedMemos >= memosWithActions", () => {
    const facts = [
      fact({ id: "m1", actionsExtractedAt: NOW }), // processed + 액션 있음
      fact({ id: "m2", actionsExtractedAt: NOW }), // processed, 액션 없음
      fact({ id: "m3", actionsExtractedAt: null }), // 미처리
    ];
    const items = [ai({ memoId: "m1", status: "accepted" }), ai({ memoId: "m1", status: "accepted" })];
    const c = buildActionConversion(facts, items, []);
    expect(c.totalMemos).toBe(3);
    expect(c.processedMemos).toBe(2);
    expect(c.memosWithActions).toBe(1);
    expect(c.totalMemos).toBeGreaterThanOrEqual(c.processedMemos);
    expect(c.processedMemos).toBeGreaterThanOrEqual(c.memosWithActions);
  });
  it("액션-행 수는 메모 수를 초과할 수 있다 (accepted 2개)", () => {
    const facts = [fact({ id: "m1", actionsExtractedAt: NOW })];
    const items = [ai({ memoId: "m1", status: "accepted" }), ai({ memoId: "m1", status: "accepted" })];
    const c = buildActionConversion(facts, items, []);
    expect(c.currentStatusCounts.accepted).toBe(2); // 메모는 1개인데 accepted 2
    expect(c.memosWithActions).toBe(1);
  });
  it("변환본 slug 그룹화 — 최근 non-null presetLabel 대표, 빌트인 라벨 폴백", () => {
    function tr(overrides: Partial<MemoTransformation>): MemoTransformation {
      return {
        id: nextId(),
        memoId: "m1",
        preset: "tidy",
        model: "claude",
        content: "x",
        presetLabel: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      } as MemoTransformation;
    }
    const trs = [
      tr({ preset: "tidy", presetLabel: null, createdAt: kstNoon("2026-07-10") }),
      tr({ preset: "tidy", presetLabel: "정돈v2", createdAt: kstNoon("2026-07-12") }), // 최근
      tr({ preset: "c-custom", presetLabel: "내 프리셋", createdAt: kstNoon("2026-07-11") }),
    ];
    const c = buildActionConversion([], [], trs);
    expect(c.transformCount).toBe(3);
    const tidy = c.transformByPreset.find((p) => p.slug === "tidy");
    expect(tidy).toEqual({ slug: "tidy", label: "정돈v2", count: 2 }); // 최근 non-null 라벨
    const custom = c.transformByPreset.find((p) => p.slug === "c-custom");
    expect(custom).toEqual({ slug: "c-custom", label: "내 프리셋", count: 1 });
  });
});

describe("buildDigestTimeline", () => {
  function dg(overrides: Partial<MemoDigest>): MemoDigest {
    return {
      id: nextId(),
      userId: "u1",
      weekEnd: "2026-07-05",
      summary: "s",
      memoCount: 3,
      resurfacedMemoIds: [],
      createdAt: NOW,
      ...overrides,
    } as MemoDigest;
  }
  it("빈 입력 — 빈 배열", () => {
    expect(buildDigestTimeline([])).toEqual([]);
  });
  it("weekEnd·memoCount·재부상 수 매핑", () => {
    const digests = [
      dg({ weekEnd: "2026-06-28", memoCount: 2, resurfacedMemoIds: ["a"] }),
      dg({ weekEnd: "2026-07-05", memoCount: 5, resurfacedMemoIds: ["a", "b"] }),
    ];
    const t = buildDigestTimeline(digests);
    expect(t).toEqual([
      { weekEnd: "2026-06-28", memoCount: 2, resurfacedCount: 1 },
      { weekEnd: "2026-07-05", memoCount: 5, resurfacedCount: 2 },
    ]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && pnpm vitest run src/widgets/memo-insights/lib/aggregate.test.ts`
Expected: FAIL — `buildActivityHeatmap is not a function` (모듈 미존재).

- [ ] **Step 3: `lib/aggregate.ts` 구현**

`apps/dashboard/src/widgets/memo-insights/lib/aggregate.ts` 생성:

```typescript
// 인사이트 순수 집계 함수 — DOM/DB 의존 없음. 시간 의존 함수는 now를 주입받는다(순수성).
// 모든 일자 버킷은 KST(Asia/Seoul) 자정 경계. 각 함수는 빈 입력에서 안전한 기본값을 반환.
import type {
  MemoFact,
  MemoDigest,
  MemoActionItem,
  MemoTransformation,
  MemoCategoryRow,
  ActionItemStatus,
} from "@/entities/memo/server";
import { ACTION_ITEM_STATUSES, TRANSFORM_PRESET_LABELS } from "@/entities/memo/server";
import type { TransformPresetId } from "@/entities/memo/server";
import type {
  ActivityHeatmap,
  DailyTrendPoint,
  CategoryDistribution,
  ActionConversion,
  DigestTimelinePoint,
  DayCell,
} from "../model/types";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_WEEKS = 26;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7; // 182

/** Date → KST 자정 기준 'YYYY-MM-DD'. UTC로 9h 밀어 날짜 부품을 뽑는다(locale-free). */
function kstDateKey(d: Date): string {
  const shifted = new Date(d.getTime() + KST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD'(KST 자정)에 offsetDays를 더한 날짜 키. */
function addDaysKey(key: string, offsetDays: number): string {
  // KST 자정을 UTC 시각으로 복원해 산술 후 다시 키 추출.
  const utcMidnightKst = new Date(`${key}T00:00:00Z`).getTime() - KST_OFFSET_MS;
  return kstDateKey(new Date(utcMidnightKst + offsetDays * DAY_MS + KST_OFFSET_MS));
}

/** facts를 KST 날짜 키별 카운트 맵으로. */
function countByDate(facts: MemoFact[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of facts) {
    const k = kstDateKey(f.createdAt);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function buildActivityHeatmap(facts: MemoFact[], now: Date): ActivityHeatmap {
  const todayKey = kstDateKey(now);
  const counts = countByDate(facts);

  // 182일 연속 날짜 키 (과거 → 오늘). 첫 열이 가장 오래된 주.
  const startKey = addDaysKey(todayKey, -(HEATMAP_DAYS - 1));
  const days: DayCell[] = [];
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const date = addDaysKey(startKey, i);
    days.push({ date, count: counts.get(date) ?? 0 });
  }

  // 7일 단위로 주 그리드 구성 (26주 × 7일).
  const weeks: DayCell[][] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    weeks.push(days.slice(w * 7, w * 7 + 7));
  }

  const windowCount = days.reduce((s, c) => s + c.count, 0);
  const totalCount = facts.length;

  // currentStreak: 오늘부터 역방향 연속 기록일. 오늘 미기록이면 어제부터.
  let currentStreak = 0;
  let cursor = counts.get(todayKey) ? todayKey : addDaysKey(todayKey, -1);
  while (counts.get(cursor)) {
    currentStreak++;
    cursor = addDaysKey(cursor, -1);
  }

  // longestStreak: 26주 창 내 최장 연속(days 배열 스캔).
  let longestStreak = 0;
  let run = 0;
  for (const cell of days) {
    if (cell.count > 0) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  return {
    weeks,
    windowCount,
    totalCount,
    currentStreak,
    longestStreak,
    dailyAvg: windowCount / HEATMAP_DAYS,
  };
}

export function buildDailyTrend(facts: MemoFact[], now: Date, days = 30): DailyTrendPoint[] {
  const todayKey = kstDateKey(now);
  const counts = countByDate(facts);
  const startKey = addDaysKey(todayKey, -(days - 1));
  const out: DailyTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysKey(startKey, i);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

export function buildCategoryDistribution(
  facts: MemoFact[],
  categories: MemoCategoryRow[],
): CategoryDistribution {
  const labelBySlug = new Map(categories.map((c) => [c.id, c.labelKo]));
  const bySlug = new Map<string, number>();
  let voiceCount = 0;
  let textCount = 0;
  let unclassifiedCount = 0;

  for (const f of facts) {
    if (f.source === "voice") voiceCount++;
    else textCount++;
    if (f.category === null) unclassifiedCount++;
    else bySlug.set(f.category, (bySlug.get(f.category) ?? 0) + 1);
  }

  const byCategory = [...bySlug.entries()]
    .map(([slug, count]) => ({ slug, labelKo: labelBySlug.get(slug) ?? slug, count }))
    .sort((a, b) => b.count - a.count);

  return { byCategory, voiceCount, textCount, unclassifiedCount };
}

export function buildActionConversion(
  facts: MemoFact[],
  actionItems: MemoActionItem[],
  transformations: MemoTransformation[],
): ActionConversion {
  const totalMemos = facts.length;
  const processedMemos = facts.filter((f) => f.actionsExtractedAt !== null).length;

  const memoIdsWithActions = new Set<string>();
  const currentStatusCounts: Record<ActionItemStatus, number> = {
    proposed: 0,
    accepted: 0,
    dismissed: 0,
    done: 0,
  };
  for (const item of actionItems) {
    memoIdsWithActions.add(item.memoId);
    // status는 bare text()라 string — DB CHECK 보장 값이므로 ActionItemStatus로 좁힌다.
    const s = item.status as ActionItemStatus;
    if (s in currentStatusCounts) currentStatusCounts[s]++;
  }

  // 변환본 slug 그룹화 + 결정적 대표 라벨(가장 최근 non-null presetLabel).
  interface Group {
    count: number;
    labelAt: number | null; // 대표 라벨의 createdAt(ms), null=미정
    label: string | null;
  }
  const groups = new Map<string, Group>();
  for (const t of transformations) {
    const g = groups.get(t.preset) ?? { count: 0, labelAt: null, label: null };
    g.count++;
    if (t.presetLabel !== null) {
      const at = t.createdAt.getTime();
      if (g.labelAt === null || at > g.labelAt) {
        g.labelAt = at;
        g.label = t.presetLabel;
      }
    }
    groups.set(t.preset, g);
  }
  const transformByPreset = [...groups.entries()]
    .map(([slug, g]) => ({
      slug,
      label: g.label ?? TRANSFORM_PRESET_LABELS[slug as TransformPresetId] ?? slug,
      count: g.count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalMemos,
    processedMemos,
    memosWithActions: memoIdsWithActions.size,
    currentStatusCounts,
    transformCount: transformations.length,
    transformByPreset,
  };
}

export function buildDigestTimeline(digests: MemoDigest[]): DigestTimelinePoint[] {
  return digests.map((d) => ({
    weekEnd: d.weekEnd,
    memoCount: d.memoCount,
    resurfacedCount: d.resurfacedMemoIds.length,
  }));
}

// ACTION_ITEM_STATUSES를 참조해 상태 키 집합이 스키마와 동기임을 보증(미사용 방지 겸 문서화).
void ACTION_ITEM_STATUSES;
```

> **주의**: 위 마지막 `void ACTION_ITEM_STATUSES;`는 import를 살려두려는 것인데, 실제로는 `currentStatusCounts` 리터럴이 4키를 하드코딩하므로 `ACTION_ITEM_STATUSES` import가 불필요하다. **import 목록에서 `ACTION_ITEM_STATUSES`를 빼고 이 `void` 줄도 삭제**하라 (미사용 import는 lint 에러). `TRANSFORM_PRESET_LABELS`만 값 import로 남긴다.

- [ ] **Step 4: 미사용 import 정리**

`import { ACTION_ITEM_STATUSES, TRANSFORM_PRESET_LABELS } from "@/entities/memo/server";` 를 `import { TRANSFORM_PRESET_LABELS } from "@/entities/memo/server";` 로 바꾸고, 파일 끝 `void ACTION_ITEM_STATUSES;` 줄을 삭제.

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && pnpm vitest run src/widgets/memo-insights/lib/aggregate.test.ts`
Expected: 모든 케이스 PASS (DB 불필요 — 순수 함수). `Test Files 1 passed`, 개별 케이스 수 확인 (vitest include 밖 조용한 스킵 방지).

- [ ] **Step 6: `server.ts` 진입점 작성**

`apps/dashboard/src/widgets/memo-insights/server.ts` 생성:

```typescript
// widgets/memo-insights — server entrypoint (RSC 전용). 순수 집계 함수 re-export.
// RSC 페이지는 이 경로로만 집계 함수를 import한다 (deep import 금지, spec §7).
export {
  buildActivityHeatmap,
  buildDailyTrend,
  buildCategoryDistribution,
  buildActionConversion,
  buildDigestTimeline,
} from "./lib/aggregate";
export type {
  ActivityHeatmap,
  DailyTrendPoint,
  CategoryDistribution,
  ActionConversion,
  DigestTimelinePoint,
  DayCell,
} from "./model/types";
```

- [ ] **Step 7: 타입 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 8: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-insights/lib/aggregate.ts apps/dashboard/src/widgets/memo-insights/lib/aggregate.test.ts apps/dashboard/src/widgets/memo-insights/server.ts
git commit -m "feat: 메모 인사이트 순수 집계 함수 5개 + 단위 테스트"
```

---

## Task 4: 클라이언트 뷰 스캐폴드 + 블록 A (활동/히트맵)

**Files:**
- Create: `apps/dashboard/src/widgets/memo-insights/ui/ActivityBlock.tsx`
- Create: `apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx`
- Create: `apps/dashboard/src/widgets/memo-insights/index.ts`

**Interfaces:**
- Consumes: `ActivityHeatmap`, `DailyTrendPoint`, `CategoryDistribution`, `ActionConversion`, `DigestTimelinePoint` (from `../model/types`). recharts `BarChart`.
- Produces (Task 5 라우트가 import):
  - `MemoInsightsView` (from `widgets/memo-insights` index.ts) — props `MemoInsightsViewProps`
  - `MemoInsightsViewProps = { heatmap: ActivityHeatmap; trend: DailyTrendPoint[]; category: CategoryDistribution; conversion: ActionConversion; digestTimeline: DigestTimelinePoint[] }`

- [ ] **Step 1: `ActivityBlock.tsx` 작성 (CSS grid 히트맵 + recharts 추이 바)**

`apps/dashboard/src/widgets/memo-insights/ui/ActivityBlock.tsx` 생성:

```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ActivityHeatmap, DailyTrendPoint } from "../model/types";

interface Props {
  heatmap: ActivityHeatmap;
  trend: DailyTrendPoint[];
}

// 단색 명도 스케일 — count 구간별 배경. 라이트 모드 고정.
function cellColor(count: number): string {
  if (count === 0) return "#f1f5f9"; // slate-100 (기록 없음)
  if (count === 1) return "#bbf7d0"; // green-200
  if (count <= 3) return "#4ade80"; // green-400
  if (count <= 6) return "#22c55e"; // green-500
  return "#15803d"; // green-700
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
    </div>
  );
}

export function ActivityBlock({ heatmap, trend }: Props) {
  const { weeks, totalCount, currentStreak, longestStreak, dailyAvg } = heatmap;
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">기록 활동 패턴</h2>

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label="전체 메모" value={String(totalCount)} />
        <Stat
          label="현재 연속 기록"
          value={currentStreak > 0 ? `${currentStreak}일` : "—"}
        />
        <Stat label="최장 연속" value={longestStreak > 0 ? `${longestStreak}일` : "—"} />
        <Stat label="최근 26주 일평균" value={dailyAvg.toFixed(2)} />
      </div>
      {currentStreak === 0 && (
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          아직 연속 기록이 없어요.
        </p>
      )}

      {/* 히트맵 — 26주 × 7일 고정 그리드. 열=주, 행=요일. */}
      <div className="mb-8 overflow-x-auto">
        <div className="flex gap-1" style={{ minWidth: "fit-content" }}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((cell) => (
                <div
                  key={cell.date}
                  title={`${cell.date}: ${cell.count}건`}
                  className="h-3 w-3 rounded-sm"
                  style={{ backgroundColor: cellColor(cell.count) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 일별 추이 — 최근 N일 바 차트. */}
      <h3 className="mb-2 text-sm font-medium text-[var(--color-text-muted)]">최근 30일 추이</h3>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={trend}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickFormatter={(d: string) => d.slice(5)} // MM-DD
            interval={4}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={24} />
          <Tooltip />
          <Bar dataKey="count" fill="#22c55e" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
```

- [ ] **Step 2: `MemoInsightsView.tsx` 스캐폴드 (블록 A만 렌더, 빈 상태 가드)**

`apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx` 생성:

```tsx
"use client";

import Link from "next/link";
import type {
  ActivityHeatmap,
  DailyTrendPoint,
  CategoryDistribution,
  ActionConversion,
  DigestTimelinePoint,
} from "../model/types";
import { ActivityBlock } from "./ActivityBlock";

export interface MemoInsightsViewProps {
  heatmap: ActivityHeatmap;
  trend: DailyTrendPoint[];
  category: CategoryDistribution;
  conversion: ActionConversion;
  digestTimeline: DigestTimelinePoint[];
}

export function MemoInsightsView({ heatmap, trend }: MemoInsightsViewProps) {
  // 전체 빈 상태 — 메모 0개면 차트 대신 안내.
  if (heatmap.totalCount === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center">
        <p className="text-[var(--color-text-muted)]">아직 분석할 메모가 없어요.</p>
        <Link href="/memos" className="mt-3 inline-block text-sm text-green-700 hover:underline">
          메모 작성하러 가기 →
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ActivityBlock heatmap={heatmap} trend={trend} />
    </div>
  );
}
```

- [ ] **Step 3: `index.ts` barrel 작성**

`apps/dashboard/src/widgets/memo-insights/index.ts` 생성:

```typescript
export { MemoInsightsView } from "./ui/MemoInsightsView";
export type { MemoInsightsViewProps } from "./ui/MemoInsightsView";
```

- [ ] **Step 4: 타입·lint 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 없음. (blocks B~D props는 아직 뷰가 destructure 안 하지만 타입엔 존재 — 미사용 매개변수 경고 없음, 객체 구조분해라 안 씀은 허용.)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-insights/ui/ActivityBlock.tsx apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx apps/dashboard/src/widgets/memo-insights/index.ts
git commit -m "feat: 메모 인사이트 뷰 스캐폴드 + 블록 A(활동/히트맵)"
```

---

## Task 5: 블록 B (카테고리 분포)

**Files:**
- Create: `apps/dashboard/src/widgets/memo-insights/ui/CategoryBlock.tsx`
- Modify: `apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx`

**Interfaces:**
- Consumes: `CategoryDistribution` (from `../model/types`). recharts `PieChart`, `Pie`, `Cell`.
- Produces: `CategoryBlock` 컴포넌트.

- [ ] **Step 1: `CategoryBlock.tsx` 작성 (도넛 + voice/text 바)**

`apps/dashboard/src/widgets/memo-insights/ui/CategoryBlock.tsx` 생성:

```tsx
"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CategoryDistribution } from "../model/types";

interface Props {
  category: CategoryDistribution;
}

// dataviz 검증 팔레트 — 카테고리 색 순환 (라이트 모드 고정).
const PALETTE = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444", "#64748b"];

export function CategoryBlock({ category }: Props) {
  const { byCategory, voiceCount, textCount, unclassifiedCount } = category;
  const total = voiceCount + textCount;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">카테고리 분포</h2>

      {byCategory.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">아직 분류된 메모가 없어요.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={byCategory}
              dataKey="count"
              nameKey="labelKo"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
            >
              {byCategory.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}

      {/* voice vs text 가로 바 + 미분류 수. */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>음성 {voiceCount}</span>
          <span>텍스트 {textCount}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
          {total > 0 && (
            <>
              <div className="bg-violet-400" style={{ width: `${(voiceCount / total) * 100}%` }} />
              <div className="bg-sky-400" style={{ width: `${(textCount / total) * 100}%` }} />
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">미분류 {unclassifiedCount}건</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: `MemoInsightsView.tsx`에 블록 B 연결**

`MemoInsightsView.tsx` 의 import에 `import { CategoryBlock } from "./CategoryBlock";` 추가. destructure 를 `{ heatmap, trend, category }` 로 확장. return 의 `<div className="flex flex-col gap-6">` 안 `<ActivityBlock … />` 아래에 추가:

```tsx
      <CategoryBlock category={category} />
```

- [ ] **Step 3: 타입·lint 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-insights/ui/CategoryBlock.tsx apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx
git commit -m "feat: 메모 인사이트 블록 B(카테고리 분포)"
```

---

## Task 6: 블록 C (메모→액션 전환 — 퍼널 + 상태 스냅샷 분리)

**Files:**
- Create: `apps/dashboard/src/widgets/memo-insights/ui/ConversionBlock.tsx`
- Modify: `apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx`

**Interfaces:**
- Consumes: `ActionConversion` (from `../model/types`). recharts `PieChart`(상태 도넛), 스탯 타일(퍼널·변환).
- Produces: `ConversionBlock` 컴포넌트.

- [ ] **Step 1: `ConversionBlock.tsx` 작성 (퍼널·상태 스냅샷·변환 3구획)**

`apps/dashboard/src/widgets/memo-insights/ui/ConversionBlock.tsx` 생성:

```tsx
"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ActionConversion } from "../model/types";

interface Props {
  conversion: ActionConversion;
}

const STATUS_LABEL: Record<string, string> = {
  proposed: "제안됨",
  accepted: "수락됨",
  done: "완료",
  dismissed: "무시됨",
};
const STATUS_COLOR: Record<string, string> = {
  proposed: "#94a3b8",
  accepted: "#3b82f6",
  done: "#22c55e",
  dismissed: "#e2e8f0",
};

function FunnelStat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex-1 rounded-xl bg-slate-50 p-4">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs font-medium">{label}</div>
      {note && <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{note}</div>}
    </div>
  );
}

export function ConversionBlock({ conversion }: Props) {
  const {
    totalMemos,
    processedMemos,
    memosWithActions,
    currentStatusCounts,
    transformCount,
    transformByPreset,
  } = conversion;

  const statusData = (["proposed", "accepted", "done", "dismissed"] as const)
    .map((s) => ({ status: s, label: STATUS_LABEL[s], count: currentStatusCounts[s] }))
    .filter((d) => d.count > 0);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">메모 → 액션 전환</h2>

      {/* 메모 퍼널 (단조 감소, 메모 수 단위) */}
      <div className="mb-6 flex gap-3">
        <FunnelStat label="전체 메모" value={totalMemos} />
        <FunnelStat label="추출 처리됨" value={processedMemos} note="액션 추출 시도 완료" />
        <FunnelStat label="액션 생김" value={memosWithActions} note="액션 1개 이상" />
      </div>

      {/* 액션 상태 분포 (퍼널과 별개 — 현재 상태 스냅샷, 액션-행 단위) */}
      <h3 className="mb-2 text-sm font-medium">액션 상태 (현재 스냅샷)</h3>
      {statusData.length === 0 ? (
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">아직 추출된 액션이 없어요.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={statusData} dataKey="count" nameKey="label" innerRadius={45} outerRadius={75}>
              {statusData.map((d) => (
                <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}

      {/* 변환본 통계 (slug 그룹) */}
      <h3 className="mb-2 mt-4 text-sm font-medium">변환본 ({transformCount}건)</h3>
      {transformByPreset.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">아직 생성된 변환본이 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {transformByPreset.map((p) => (
            <li key={p.slug} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate">{p.label}</span>
              <div className="h-2 flex-1 rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-emerald-400"
                  style={{ width: `${(p.count / transformCount) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-[var(--color-text-muted)]">
                {p.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: `MemoInsightsView.tsx`에 블록 C 연결**

import에 `import { ConversionBlock } from "./ConversionBlock";` 추가. destructure 를 `{ heatmap, trend, category, conversion }` 로 확장. `<CategoryBlock … />` 아래에 추가:

```tsx
      <ConversionBlock conversion={conversion} />
```

- [ ] **Step 3: 타입·lint 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-insights/ui/ConversionBlock.tsx apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx
git commit -m "feat: 메모 인사이트 블록 C(액션 전환 퍼널 + 상태 스냅샷)"
```

---

## Task 7: 블록 D (주간 회고 타임라인)

**Files:**
- Create: `apps/dashboard/src/widgets/memo-insights/ui/DigestTimelineBlock.tsx`
- Modify: `apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx`

**Interfaces:**
- Consumes: `DigestTimelinePoint[]` (from `../model/types`). recharts `LineChart`/`Bar` 조합(`ComposedChart`).
- Produces: `DigestTimelineBlock` 컴포넌트.

- [ ] **Step 1: `DigestTimelineBlock.tsx` 작성 (memoCount 바 + 재부상 라인 오버레이)**

`apps/dashboard/src/widgets/memo-insights/ui/DigestTimelineBlock.tsx` 생성:

```tsx
"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { DigestTimelinePoint } from "../model/types";

interface Props {
  digestTimeline: DigestTimelinePoint[];
}

export function DigestTimelineBlock({ digestTimeline }: Props) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">주간 회고 타임라인</h2>
      {digestTimeline.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          아직 주간 다이제스트가 없어요. 매주 일요일 자동 생성돼요.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={digestTimeline}>
            <XAxis dataKey="weekEnd" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={24} />
            <Tooltip />
            <Legend />
            <Bar dataKey="memoCount" name="메모 수" fill="#22c55e" radius={[2, 2, 0, 0]} />
            <Line dataKey="resurfacedCount" name="재부상" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
```

- [ ] **Step 2: `MemoInsightsView.tsx`에 블록 D 연결**

import에 `import { DigestTimelineBlock } from "./DigestTimelineBlock";` 추가. destructure 를 `{ heatmap, trend, category, conversion, digestTimeline }` 로 완성. `<ConversionBlock … />` 아래에 추가:

```tsx
      <DigestTimelineBlock digestTimeline={digestTimeline} />
```

- [ ] **Step 3: 타입·lint 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 없음. 이제 `MemoInsightsViewProps`의 5개 필드가 전부 소비됨.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-insights/ui/DigestTimelineBlock.tsx apps/dashboard/src/widgets/memo-insights/ui/MemoInsightsView.tsx
git commit -m "feat: 메모 인사이트 블록 D(주간 회고 타임라인)"
```

---

## Task 8: RSC 라우트 페이지 + `/memos` 헤더 링크

**Files:**
- Create: `apps/dashboard/src/app/(dashboard)/memos/insights/page.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/memos/page.tsx`

**Interfaces:**
- Consumes:
  - `entities/memo/server`: `listMemoFactsForInsights`, `listDigestsByUser`, `listActionItemsByUser`, `listTransformationsByUser`, `listCategories`
  - `widgets/memo-insights/server`: `buildActivityHeatmap`, `buildDailyTrend`, `buildCategoryDistribution`, `buildActionConversion`, `buildDigestTimeline`
  - `widgets/memo-insights`: `MemoInsightsView`
  - `shared/ui`: `PageContainer`, `PageHeader`; `shared/lib/auth`: `auth`

- [ ] **Step 1: RSC 페이지 작성**

`apps/dashboard/src/app/(dashboard)/memos/insights/page.tsx` 생성:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import {
  listMemoFactsForInsights,
  listDigestsByUser,
  listActionItemsByUser,
  listTransformationsByUser,
  listCategories,
} from "@/entities/memo/server";
import {
  buildActivityHeatmap,
  buildDailyTrend,
  buildCategoryDistribution,
  buildActionConversion,
  buildDigestTimeline,
} from "@/widgets/memo-insights/server";
import { MemoInsightsView } from "@/widgets/memo-insights";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemoInsightsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  // now를 한 번 캡처해 시간 의존 집계에 주입 (KST 산술 고정, 순수성 유지).
  const now = new Date();

  const [facts, digests, actionItems, transformations, categories] = await Promise.all([
    listMemoFactsForInsights(userId),
    listDigestsByUser(userId),
    // 상태 분포용 — 4개 상태 전부.
    listActionItemsByUser(userId, ["proposed", "accepted", "done", "dismissed"]),
    listTransformationsByUser(userId),
    listCategories(),
  ]);

  const heatmap = buildActivityHeatmap(facts, now);
  const trend = buildDailyTrend(facts, now, 30);
  const category = buildCategoryDistribution(facts, categories);
  const conversion = buildActionConversion(facts, actionItems, transformations);
  const digestTimeline = buildDigestTimeline(digests);

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="메모 인사이트"
        subtitle="쌓인 메모를 분석해 기록 습관·주제·전환·회고를 한눈에 봐요."
        actions={
          <Link href="/memos" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← 메모
          </Link>
        }
      />
      <MemoInsightsView
        heatmap={heatmap}
        trend={trend}
        category={category}
        conversion={conversion}
        digestTimeline={digestTimeline}
      />
    </PageContainer>
  );
}
```

- [ ] **Step 2: `/memos` 헤더에 `📊 인사이트` 링크 추가**

`apps/dashboard/src/app/(dashboard)/memos/page.tsx` 의 `actions` 슬롯 `<div className="flex items-center gap-3">` 안, `🗺 시스템 구조` Link 위에 추가:

```tsx
            <Link href="/memos/insights" className="text-sm text-neutral-500 hover:text-neutral-900">
              📊 인사이트
            </Link>
```

- [ ] **Step 3: 타입·lint 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add "apps/dashboard/src/app/(dashboard)/memos/insights/page.tsx" "apps/dashboard/src/app/(dashboard)/memos/page.tsx"
git commit -m "feat: 메모 인사이트 라우트(/memos/insights) + 헤더 링크"
```

---

## Task 9: 최종 검증 — build seam 가드 + 도그푸드 스모크

**Files:** (변경 없음 — 검증 전용. 문제 발견 시 해당 Task 파일 수정)

- [ ] **Step 1: 전체 단위/통합 테스트**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: `aggregate.test.ts` 순수 케이스 전부 PASS. repo 통합 테스트는 로컬 DB 기동 시 PASS, 미기동 시 `ECONNREFUSED` (신규 순수 테스트가 green이면 진행 가능).

- [ ] **Step 2: build seam 검증 (Gotcha #7 — typecheck/lint로 못 잡음)**

Run: `cd apps/dashboard && pnpm build`
Expected: 성공. 만약 `Module not found: Can't resolve 'tls' / 'perf_hooks' / 'net'` 이 나오면 client 뷰가 server-only 모듈을 끌어온 것 — `MemoInsightsView`(및 블록들)의 import가 `../model/types`(타입 only)와 recharts만 참조하는지, `@/entities/memo/server`(server-only)를 값으로 import하지 않는지 확인. 집계 함수는 라우트(RSC)에서만 호출되어야 한다.

- [ ] **Step 3: 도그푸드 스모크 (dev 서버)**

Run: `pnpm dev` (백그라운드). 브라우저로 `http://localhost:3020/memos/insights` 접속.
확인:
- 헤더 "메모 인사이트" + `← 메모` 링크
- 메모가 있으면 4개 블록 렌더, hydration 에러 없음(콘솔 확인 — locale-free 날짜 덕에 mismatch 없어야 함)
- 메모가 0개면 "아직 분석할 메모가 없어요" 빈 상태 카드
- `/memos` 페이지 헤더에 `📊 인사이트` 링크 노출·클릭 시 이동

> **주의 (dev-server-prod-db-blocks-dogfood)**: localhost dev가 운영 DB를 볼 수 있다. 인사이트는 **읽기 전용**이라 데이터 변경 위험은 없다. 단 실제 개인 메모가 보일 수 있음을 인지.

- [ ] **Step 4: 최종 확인 커밋 (필요 시)**

빈 상태·seam 문제로 수정이 있었다면 커밋:

```bash
git add -A
git commit -m "fix: 메모 인사이트 build seam/빈 상태 마감"
```

검증 통과 후 브랜치 완료 처리는 `superpowers:finishing-a-development-branch` 로 진행.

---

## Self-Review (작성자 체크 완료)

**1. 스펙 커버리지:**
- §2 배치/아키텍처(라우트·위젯 seam·헤더 링크) → Task 4·8 ✓
- §3.2 신규 조회 2건(캡 없음·source 좁히기) → Task 1 ✓
- §3.3 기존 재사용(4개 상태·slug 그룹·categories) → Task 3·8 ✓
- §3.4 순수 집계 5개(now 주입·26주 그리드·streak·퍼널 분리) → Task 3 ✓
- §4 시각화 4블록(히트맵 CSS grid·recharts) → Task 4~7 ✓
- §5 빈 상태(전체·블록별·고정 그리드) → Task 4~7 각 블록 + Task 9 스모크 ✓
- §6 테스트(순수 5함수·201건 캡 회귀·now 고정·퍼널 불변식·build seam) → Task 1·3·9 ✓
- §7 FSD seam(server.ts 경유·index.ts 노출·중립 types) → Task 2·3·4 ✓
- §8 구현 단계 순서 → Task 1~9가 그대로 매핑 ✓

**2. 플레이스홀더 스캔:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음. (Task 3 Step 3의 `void` 줄은 의도적 함정 + Step 4에서 즉시 정리 — 실행자가 미사용 import lint를 만나지 않도록 명시.)

**3. 타입 일관성:** `MemoFact`·`ActivityHeatmap` 등 타입명이 Task 1~8에서 일관. `MemoInsightsViewProps` 5개 필드(`heatmap/trend/category/conversion/digestTimeline`)가 Task 4에서 정의되고 Task 8 라우트에서 동일 이름으로 전달됨. 집계 함수 시그니처(`buildActivityHeatmap(facts, now)` 등)가 Task 3 정의 = Task 8 호출 일치.
