# 사주 삼국 일운(日運) 위젯 구현 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/fortune/[profileId]` 페이지에 `daily` 탭과 4학파 narrative widget을 monthly 1:1 미러로 추가하고, v0.2 옛 cron-prefill 일진 UI를 단계적으로 제거한다.

**Architecture:** Monthly 패턴 1:1 미러 (방안 A). 기존 `saju_daily_narrative` 테이블을 ALTER TABLE로 monthly 패턴 컬럼 4 개 보강, narrative-server는 plain text → JSON+zod+sections로 완전 재작성, 신규 prompts/schemas/UI/widget/route 추가, 페이지 통합 시 옛 `SajuDailyFortune` 섹션 제거. 옛 `saju_daily_fortunes` 테이블·코드는 Follow-up PR에서 깊은 정리.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), TypeScript strict, Drizzle ORM + PostgreSQL 16, NextAuth v5, Anthropic SDK + Claude Code CLI Proxy, Zod, TanStack Query, Vitest, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-05-20-saju-tri-daily-widget-design.md`

**선행 문서 참조:**
- monthly 미러 소스: `apps/dashboard/src/features/saju-monthly-tri/`, `apps/dashboard/src/widgets/saju-tri-monthly/`, `apps/dashboard/src/app/api/saju/monthly/[profileId]/narrative/route.ts`
- 옛 daily stub (재작성 대상): `apps/dashboard/src/features/saju-daily-tri/api/narrative-server.ts`
- 옛 v0.2 일진 (제거 대상): `apps/dashboard/src/widgets/saju-detail/ui/SajuDailyFortune.tsx`, `apps/dashboard/src/entities/saju-chart/api/dailyFortune.ts` (getTodayDailyFortune)

---

## File Structure (이번 PR-A 범위)

### 신규 작성
- `apps/dashboard/src/features/saju-daily-tri/api/prompts.ts`
- `apps/dashboard/src/features/saju-daily-tri/api/schemas.ts`
- `apps/dashboard/src/features/saju-daily-tri/api/schemas.test.ts`
- `apps/dashboard/src/features/saju-daily-tri/ui/DailyCrossCheckBadge.tsx`
- `apps/dashboard/src/features/saju-daily-tri/ui/DailyFrameView.tsx`
- `apps/dashboard/src/features/saju-daily-tri/ui/TriDailyTabs.tsx`
- `apps/dashboard/src/widgets/saju-tri-daily/ui/SajuTriDaily.tsx`
- `apps/dashboard/src/widgets/saju-tri-daily/index.ts`
- `apps/dashboard/src/app/api/saju/daily/[profileId]/narrative/route.ts`
- `apps/dashboard/drizzle/<next>_saju_daily_narrative_richer.sql` (drizzle-kit 생성 + 수동 append)

### 재작성
- `apps/dashboard/src/features/saju-daily-tri/api/narrative-server.ts` (plain text → JSON+zod+sections+schoolSpecific+citations+promptVersion)

### 미세 수정
- `apps/dashboard/src/features/saju-daily-tri/api/daily-server.ts` (`kstTodayDate` 제거 — shared helper로 이동)
- `apps/dashboard/src/features/saju-daily-tri/index.ts` (신규 export 추가, DailyNarrativeResult shape 변경 반영)
- `apps/dashboard/src/shared/lib/saju/resolveBirthInput.ts` (`currentKstDate` 추가)
- `apps/dashboard/src/shared/lib/saju/tab-key.ts` (`daily` 키 + 메타 추가)
- `apps/dashboard/src/shared/lib/db/schema.ts` (`sajuDailyNarrative` Drizzle 정의에 4 컬럼 추가)
- `apps/dashboard/src/app/fortune/[profileId]/page.tsx` (daily 탭 분기 추가 + reading 탭 옛 일진 섹션 제거 + import 정리)
- `apps/dashboard/src/widgets/saju-detail/index.ts` (`SajuDailyFortune` export 제거)

### 삭제
- `apps/dashboard/src/widgets/saju-detail/ui/SajuDailyFortune.tsx` (다른 호출자 grep 후)
- `apps/dashboard/tests/saju-cron-daily.integration.test.ts`

---

## Task 0: 사전 검증 (구현 시작 전)

**Files:** 검증만 — 변경 없음

- [ ] **Step 1: 최신 마이그레이션 번호 확인**

Run: `find apps/dashboard/drizzle -maxdepth 1 -name "*.sql" -type f | sort | tail -3`
Expected: 최신 파일이 `0018_silent_compose_fix.sql` 인지 확인. 다른 번호면 plan의 마이그레이션 번호도 조정.

- [ ] **Step 2: `SajuDailyFortune` 다른 호출자 grep**

Run: `grep -rn "SajuDailyFortune" apps/dashboard/src/ --include="*.ts" --include="*.tsx" | grep -v "widgets/saju-detail"`
Expected: 호출자 `apps/dashboard/src/app/fortune/[profileId]/page.tsx` 만 검색. 다른 곳에서 쓰면 plan 수정 필요.

- [ ] **Step 3: `getTodayDailyFortune` 다른 호출자 grep**

Run: `grep -rn "getTodayDailyFortune" apps/dashboard/src/ --include="*.ts" --include="*.tsx"`
Expected: `entities/saju-chart` 정의 + `app/fortune/[profileId]/page.tsx` 호출 외에는 없음.

- [ ] **Step 4: 옛 `saju_daily_narrative` row 개수 확인 (운영)**

이번 PR이 `DELETE FROM saju_daily_narrative` 를 포함하므로 실제 영향 파악.

Run: `ssh gon@192.168.0.5 "docker --context home-server exec -i \$(docker --context home-server ps --filter name=gons-dashboard-postgres --format '{{.Names}}') psql -U gons -d gons -c 'SELECT count(*) FROM saju_daily_narrative;'"`
Expected: 수치 메모 (참고용). 어떤 값이든 영향 받지 않고 진행 — daily는 매일 lazy regen.

> **Task 0 만 단독 commit 안 함** — 검증 결과를 plan의 다음 Task 작업에 반영하고 Task 1로.

---

## Task 1: Shared helper — `currentKstDate()`

**Files:**
- Modify: `apps/dashboard/src/shared/lib/saju/resolveBirthInput.ts` (export 추가)
- Test: `apps/dashboard/src/shared/lib/saju/resolveBirthInput.test.ts` (있다면 보강, 없다면 신규)

- [ ] **Step 1: 기존 `resolveBirthInput.ts` 의 `currentKstYear` / `currentKstMonth` 패턴 확인**

Read: `apps/dashboard/src/shared/lib/saju/resolveBirthInput.ts`
Expected: `currentKstYear`, `currentKstMonth` 두 export 존재. KST 변환 패턴 파악 (+9h offset 후 ISO slice 등).

- [ ] **Step 2: `currentKstDate()` 테스트 작성 (실패 확인)**

File: `apps/dashboard/src/shared/lib/saju/resolveBirthInput.test.ts` (없으면 신규)

```typescript
import { describe, it, expect } from "vitest";
import { currentKstDate } from "./resolveBirthInput";

describe("currentKstDate", () => {
  it("returns YYYY-MM-DD format", () => {
    const date = currentKstDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns KST date — 14:30 UTC = 23:30 KST → same day", () => {
    const utc = new Date("2026-05-20T14:30:00Z");
    expect(currentKstDate(utc)).toBe("2026-05-20");
  });

  it("returns KST date — 15:30 UTC = 00:30 KST next day → +1 day", () => {
    const utc = new Date("2026-05-20T15:30:00Z");
    expect(currentKstDate(utc)).toBe("2026-05-21");
  });

  it("returns KST date — 23:00 KST same day", () => {
    const utc = new Date("2026-05-20T14:00:00Z"); // 23:00 KST
    expect(currentKstDate(utc)).toBe("2026-05-20");
  });
});
```

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/shared/lib/saju/resolveBirthInput.test.ts`
Expected: FAIL — `currentKstDate is not a function` (export 없음).

- [ ] **Step 3: `currentKstDate()` 구현**

Modify: `apps/dashboard/src/shared/lib/saju/resolveBirthInput.ts`

기존 `currentKstYear`, `currentKstMonth` 옆에 추가:

```typescript
/**
 * KST(Asia/Seoul) 기준 오늘 날짜 — "YYYY-MM-DD" 형식.
 *
 * DST 없음 가정 (한국은 1988 이후 미적용). UTC +9h offset 후 ISO slice.
 * @param now - 테스트용 주입 가능. 기본 new Date().
 */
export function currentKstDate(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/shared/lib/saju/resolveBirthInput.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/shared/lib/saju/resolveBirthInput.ts apps/dashboard/src/shared/lib/saju/resolveBirthInput.test.ts
git -c commit.gpgsign=false commit -m "feat(saju): currentKstDate() shared helper 추가"
```

---

## Task 2: `daily-server.ts` — `kstTodayDate` 제거, shared helper 사용

**Files:**
- Modify: `apps/dashboard/src/features/saju-daily-tri/api/daily-server.ts`
- Modify: `apps/dashboard/src/features/saju-daily-tri/index.ts`

- [ ] **Step 1: `kstTodayDate` export 제거**

Modify: `apps/dashboard/src/features/saju-daily-tri/api/daily-server.ts`

다음 구문 제거 (`getOrBuildDaily` 정의는 그대로):

```typescript
// 제거 대상
/**
 * KST 기준 오늘 (YYYY-MM-DD) — cron route 와 widget 의 default.
 */
export function kstTodayDate(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: `index.ts` 에서 `kstTodayDate` re-export 제거**

Modify: `apps/dashboard/src/features/saju-daily-tri/index.ts`

```diff
 export {
   getOrBuildDaily,
   DailyBuildError,
   ProfileNotFoundError,
-  kstTodayDate,
   type GetDailyResult,
 } from "./api/daily-server";
```

- [ ] **Step 3: `kstTodayDate` 다른 호출자 grep 후 모두 `currentKstDate` 로 교체**

Run: `grep -rn "kstTodayDate" apps/dashboard/src/ --include="*.ts" --include="*.tsx"`
Expected: 호출자가 있다면 import 경로를 `@/shared/lib/saju/resolveBirthInput` 의 `currentKstDate` 로 교체. 호출자 없으면 skip.

- [ ] **Step 4: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/saju-daily-tri/api/daily-server.ts apps/dashboard/src/features/saju-daily-tri/index.ts
git -c commit.gpgsign=false commit -m "refactor(saju): daily-server kstTodayDate → currentKstDate shared helper"
```

---

## Task 3: `prompts.ts` — daily 학파별 system prompt 신규 작성

**Files:**
- Create: `apps/dashboard/src/features/saju-daily-tri/api/prompts.ts`

- [ ] **Step 1: monthly `prompts.ts` 참조 후 daily 톤 적용해 신규 파일 작성**

File: `apps/dashboard/src/features/saju-daily-tri/api/prompts.ts`

```typescript
// v0.3.x — daily narrative 학파별 system prompt + PROMPT_VERSION.
//
// monthly/api/prompts.ts 패턴 미러링. 차이: "오늘 하루" 관점 + 분량 800~1200자.
//
// PROMPT_VERSION 정책 (monthly/yearly/lifetime 과 동일):
// - 캐시 키 (profile_id, school, for_date, frame_hash, model_id,
//   prompt_version, algorithm_version) 의 일부.
// - 프롬프트 또는 출력 스키마 변경 시 bump → 자동 캐시 무효화.
// v=1: 신규 시작.
export const PROMPT_VERSION = 1;

import type { NarrativeSchool } from "@/shared/lib/db/schema";
export type { NarrativeSchool };

const COMMON_HEADER = `당신은 30년 경력의 사주 명리학 전문가입니다. 비전문가 사용자에게 오늘 하루의 흐름을 깊이 이해시키는 것이 목표입니다.

[작성 원칙]
1. 분량: narrativeText 전체 800~1200자 (3문단). 각 sections 필드는 150~200자.
2. 용어 풀이: 한자 용어·명리 전문어가 처음 등장할 때 인라인 괄호로 풀어 설명. 예: 일운(日運 — 오늘 하루의 운), 일진(日辰 — 오늘 하루의 간지). 두 번째 등장부터는 풀이 생략.
3. 섹션별 3층 구조:
   - personality: 오늘 드러나는 기질·태도
   - career: 직업·재물 장면 구체 행동 ("오늘 오전 회의에서 ~할 때 ~하세요")
   - relationship: 관계 장면 구체 행동
   - health: 건강 관리 구체 행동·계절성
   - daeunSummary: 오늘 흐름 요약 — 일진 간지가 명조 + 현재 대운/세운/월운과 어떻게 호응·충돌하는지
4. 행동 지침은 "그래서 어떻게" 의 수준까지. 추상적 조언("균형 잡으세요") 금지. 시간대·상황·대상을 명시.
5. citations: 인용한 고전/전적의 편명까지 명시. 최소 2개.`;

const KO_BODY = `[학파 고유 관점 — 한국식 자평+조후+신살, 오늘 하루 일운]

한국식 사주의 특징:
- 자평진전의 격국론을 기본으로 하되, 조후(調候)와 신살(神煞)을 비중 있게 활용.
- 박재완·박청화 계열의 임상 사주.
- 오늘 일진 간지가 명조의 조후·신살을 어떻게 흔드는지 본다.

[작성 시 강조점]
- 오늘 일진 간지가 명조의 조후를 어떻게 흔드는지 짧게라도 한 단락.
- 오늘 활성 신살의 발현 양상.
- schoolSpecific.joohuFocus 에 오늘 보완해야 할 오행과 근거.
- schoolSpecific.shinsalNotes 에 오늘 활성 신살.

[금지]
- 자평진전 원전 인용. 그건 cn-ziping 의 영역.
- 응기 시점 단정. 그건 cn-mangpai 의 영역.`;

const ZIPING_BODY = `[학파 고유 관점 — 중국 자평진전·적천수, 오늘 하루 일운]

자평진전 사주의 특징:
- 격국(格局)과 용신(用神) 의 철학적 분석 중심.
- 오늘 일진 간지가 격국·용신과 어떻게 상호작용하는지 본다.

[작성 시 강조점]
- 오늘 일진 간지가 격국에 미치는 영향 (보강 / 손상 / 중립).
- 용신과 일진 간지의 관계.
- schoolSpecific.gyeokgukRationale 에 격국 성립 조건과 오늘 일진 영향.
- schoolSpecific.yongshinAnalysis 에 용신과 오늘 일진의 작용.

[금지]
- 신살을 메인으로 다루기. 그건 ko 의 영역.
- 응기 시점 단정. 그건 cn-mangpai 의 영역.`;

const MANGPAI_BODY = `[학파 고유 관점 — 중국 맹파 단건업, 오늘 하루 일운]

맹파 사주의 특징:
- 응기(應期) 와 사건성 중심.
- 단건업 계열 톤: 직설적·단정적.

[작성 시 강조점]
- 오늘 하루 안의 시간대 응기 시점을 구체적으로 (오전/정오/오후/저녁).
- 사건의 결을 단어로 (재물 변동, 관계 갈등, 이동, 결정).
- schoolSpecific.eventTimings 에 오늘 시간대 응기 시점 3~5개 (period, event).

[금지]
- "~할 가능성이 높다" 류 약화 표현. 단정형 우선.
- 격국 철학 토론. 그건 cn-ziping 의 영역.`;

const JP_BODY = `[학파 고유 관점 — 일본 추명학, 오늘 하루 일운]

일본 추명학의 특징:
- 12궁 + 통변성 중심.
- 高木乘 계열 톤: 차분하고 실용적.

[작성 시 강조점]
- 오늘 활성화되는 12궁 3~5개 골라 처세.
- 통변성으로 일진 간지의 의미 해설.
- schoolSpecific.palaceMap 에 (palace, note) 쌍 3~6개.

[금지]
- 격국 성립/파괴 토론. 그건 cn-ziping 의 영역.
- 신살을 메인으로 다루기. 그건 ko 의 영역.`;

export const SCHOOL_PROMPTS: Record<NarrativeSchool, string> = {
  ko: `${COMMON_HEADER}\n\n${KO_BODY}`,
  "cn-ziping": `${COMMON_HEADER}\n\n${ZIPING_BODY}`,
  "cn-mangpai": `${COMMON_HEADER}\n\n${MANGPAI_BODY}`,
  jp: `${COMMON_HEADER}\n\n${JP_BODY}`,
};
```

- [ ] **Step 2: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/saju-daily-tri/api/prompts.ts
git -c commit.gpgsign=false commit -m "feat(saju): daily 4학파 system prompt v=1"
```

---

## Task 4: `schemas.ts` — 4학파 zod 스키마 신규 작성 + 테스트

**Files:**
- Create: `apps/dashboard/src/features/saju-daily-tri/api/schemas.ts`
- Create: `apps/dashboard/src/features/saju-daily-tri/api/schemas.test.ts`

- [ ] **Step 1: monthly `schemas.ts` 1:1 미러 — 신규 파일 작성**

File: `apps/dashboard/src/features/saju-daily-tri/api/schemas.ts`

```typescript
// v0.3.x — daily LLM 출력 zod 스키마.
//
// monthly/api/schemas.ts 1:1 미러. 차이 없음 — 분량 가이드(800~1200자)는
// prompts.ts 가 자연어로 유도하고, schema 의 narrativeText min/max 는 monthly와 동일.
//
// SchoolSpecific 4학파 union 은 lifetime/monthly/yearly 와 동일 재사용.
import { z } from "zod";
import type { NarrativeSchool } from "./prompts";
import type {
  MonthlyNarrativeSections,
  SchoolSpecific,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
} from "@/shared/lib/db/schema";

// LLM (특히 Gemini) 이 array-of-string 자리에 object/array-of-object 응답 흡수.
function normalizeStringArray(v: unknown): unknown {
  const toStr = (item: unknown): string => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.entries(item)
        .map(([k, val]) => `${k}: ${typeof val === "string" ? val : JSON.stringify(val)}`)
        .join(" / ");
    }
    return String(item);
  };
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(toStr);
  if (v && typeof v === "object") {
    return Object.entries(v).map(
      ([k, val]) => `${k}: ${typeof val === "string" ? val : JSON.stringify(val)}`,
    );
  }
  return v;
}

const sectionsSchema = z.object({
  personality: z.string().min(30),
  career: z.string().min(30),
  relationship: z.string().min(30),
  health: z.string().min(30),
  daeunSummary: z.string().min(30),
  keyTerms: z
    .array(
      z.object({
        term: z.string().min(1),
        gloss: z.string().min(1),
      }),
    )
    .max(6)
    .optional()
    .default([]),
  cautions: z.array(z.string().min(1)).max(3).optional().default([]),
}) satisfies z.ZodType<MonthlyNarrativeSections, z.ZodTypeDef, unknown>;

const baseOutputSchema = z.object({
  narrativeText: z.string().min(200).max(1500),
  sections: sectionsSchema,
  citations: z.array(z.string().min(1)).min(1),
});

const koSpecificSchema = z.object({
  joohuFocus: z.string().min(20),
  shinsalNotes: z.preprocess(normalizeStringArray, z.array(z.string().min(1)).min(1)),
}) satisfies z.ZodType<SchoolSpecificKo, z.ZodTypeDef, unknown>;

const zipingSpecificSchema = z.object({
  gyeokgukRationale: z.string().min(30),
  yongshinAnalysis: z.string().min(30),
}) satisfies z.ZodType<SchoolSpecificZiping>;

const mangpaiSpecificSchema = z.object({
  eventTimings: z
    .array(
      z.object({
        period: z.string().min(1),
        event: z.string().min(1),
      }),
    )
    .min(3)
    .max(5),
}) satisfies z.ZodType<SchoolSpecificMangpai>;

const jpSpecificSchema = z.object({
  palaceMap: z
    .array(
      z.object({
        palace: z.string().min(1),
        note: z.string().min(1),
      }),
    )
    .min(3)
    .max(6),
}) satisfies z.ZodType<SchoolSpecificJp>;

const koSchema = baseOutputSchema.extend({ schoolSpecific: koSpecificSchema });
const zipingSchema = baseOutputSchema.extend({
  schoolSpecific: zipingSpecificSchema,
});
const mangpaiSchema = baseOutputSchema.extend({
  schoolSpecific: mangpaiSpecificSchema,
});
const jpSchema = baseOutputSchema.extend({ schoolSpecific: jpSpecificSchema });

export const SCHOOL_SCHEMAS = {
  ko: koSchema,
  "cn-ziping": zipingSchema,
  "cn-mangpai": mangpaiSchema,
  jp: jpSchema,
} satisfies Record<NarrativeSchool, z.ZodType>;

export type NarrativeOutput = {
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
};
```

- [ ] **Step 2: schemas 테스트 작성**

File: `apps/dashboard/src/features/saju-daily-tri/api/schemas.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { SCHOOL_SCHEMAS } from "./schemas";

const baseValid = {
  narrativeText: "오늘 일운에 대한 충분히 긴 설명문장. ".repeat(20),
  sections: {
    personality: "오늘 성격 분석. ".repeat(5),
    career: "오늘 진로 조언. ".repeat(5),
    relationship: "오늘 관계 조언. ".repeat(5),
    health: "오늘 건강 조언. ".repeat(5),
    daeunSummary: "오늘 흐름 요약. ".repeat(5),
    keyTerms: [{ term: "일운", gloss: "오늘 하루의 운" }],
    cautions: ["오후에 무리한 결정 피하기"],
  },
  citations: ["적천수 권1", "자평진전 격국편"],
};

describe("SCHOOL_SCHEMAS — ko", () => {
  it("parses valid ko payload", () => {
    const result = SCHOOL_SCHEMAS.ko.parse({
      ...baseValid,
      schoolSpecific: {
        joohuFocus: "오늘은 火 부족 — 양기 보충 필요",
        shinsalNotes: ["천을귀인 활성"],
      },
    });
    expect(result.sections.keyTerms).toHaveLength(1);
  });

  it("fails when narrativeText < 200", () => {
    expect(() =>
      SCHOOL_SCHEMAS.ko.parse({
        ...baseValid,
        narrativeText: "짧음",
        schoolSpecific: {
          joohuFocus: "오늘은 火 부족 — 양기 보충 필요",
          shinsalNotes: ["천을귀인 활성"],
        },
      }),
    ).toThrow();
  });

  it("normalizes object shinsalNotes to string array (Gemini hotfix)", () => {
    const result = SCHOOL_SCHEMAS.ko.parse({
      ...baseValid,
      schoolSpecific: {
        joohuFocus: "오늘은 火 부족 — 양기 보충 필요",
        shinsalNotes: { 천을귀인: "활성" },
      },
    });
    expect(result.schoolSpecific.shinsalNotes).toEqual(["천을귀인: 활성"]);
  });

  it("defaults missing keyTerms to []", () => {
    const result = SCHOOL_SCHEMAS.ko.parse({
      ...baseValid,
      sections: { ...baseValid.sections, keyTerms: undefined },
      schoolSpecific: {
        joohuFocus: "오늘은 火 부족 — 양기 보충 필요",
        shinsalNotes: ["천을귀인 활성"],
      },
    });
    expect(result.sections.keyTerms).toEqual([]);
  });
});

describe("SCHOOL_SCHEMAS — cn-ziping", () => {
  it("parses valid ziping payload", () => {
    const result = SCHOOL_SCHEMAS["cn-ziping"].parse({
      ...baseValid,
      schoolSpecific: {
        gyeokgukRationale: "정관격 성립 — 월령에 정관 투출하여 격국 명확",
        yongshinAnalysis: "용신 木이 오늘 寅日을 만나 강화",
      },
    });
    expect(result.schoolSpecific.gyeokgukRationale).toBeTruthy();
  });

  it("fails when gyeokgukRationale < 30", () => {
    expect(() =>
      SCHOOL_SCHEMAS["cn-ziping"].parse({
        ...baseValid,
        schoolSpecific: {
          gyeokgukRationale: "짧음",
          yongshinAnalysis: "용신 木이 오늘 寅日을 만나 강화",
        },
      }),
    ).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — cn-mangpai", () => {
  it("parses valid mangpai payload (3 eventTimings)", () => {
    const result = SCHOOL_SCHEMAS["cn-mangpai"].parse({
      ...baseValid,
      schoolSpecific: {
        eventTimings: [
          { period: "오전 9-11시", event: "재물 입금" },
          { period: "정오", event: "관계 갈등" },
          { period: "저녁 19시 이후", event: "이동" },
        ],
      },
    });
    expect(result.schoolSpecific.eventTimings).toHaveLength(3);
  });

  it("fails when eventTimings < 3", () => {
    expect(() =>
      SCHOOL_SCHEMAS["cn-mangpai"].parse({
        ...baseValid,
        schoolSpecific: {
          eventTimings: [{ period: "오전", event: "단독" }],
        },
      }),
    ).toThrow();
  });

  it("fails when eventTimings > 5", () => {
    expect(() =>
      SCHOOL_SCHEMAS["cn-mangpai"].parse({
        ...baseValid,
        schoolSpecific: {
          eventTimings: Array.from({ length: 6 }, (_, i) => ({
            period: `period ${i}`,
            event: `event ${i}`,
          })),
        },
      }),
    ).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — jp", () => {
  it("parses valid jp payload (3 palaceMap)", () => {
    const result = SCHOOL_SCHEMAS.jp.parse({
      ...baseValid,
      schoolSpecific: {
        palaceMap: [
          { palace: "命宮", note: "자기 표현 강화" },
          { palace: "財帛宮", note: "재물 흐름 활성" },
          { palace: "官祿宮", note: "직장 안정" },
        ],
      },
    });
    expect(result.schoolSpecific.palaceMap).toHaveLength(3);
  });
});
```

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/features/saju-daily-tri/api/schemas.test.ts`
Expected: PASS — 9 tests passing.

- [ ] **Step 3: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/saju-daily-tri/api/schemas.ts apps/dashboard/src/features/saju-daily-tri/api/schemas.test.ts
git -c commit.gpgsign=false commit -m "feat(saju): daily 4학파 zod schemas — monthly 미러"
```

---

## Task 5: DB 마이그레이션 — `saju_daily_narrative` ALTER TABLE

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` (Drizzle 정의 갱신)
- Create: `apps/dashboard/drizzle/<next>_saju_daily_narrative_richer.sql` (drizzle-kit 생성 후 수동 append)

- [ ] **Step 1: Drizzle schema 정의 갱신**

Modify: `apps/dashboard/src/shared/lib/db/schema.ts`

기존 `sajuDailyNarrative` 정의 (line 916~947 근방) 를 다음으로 교체:

```typescript
export const sajuDailyNarrative = pgTable(
  "saju_daily_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    forDate: date("for_date").notNull(),
    frameHash: text("frame_hash").notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: integer("prompt_version").notNull().default(1),
    algorithmVersion: integer("algorithm_version").notNull().default(1),
    narrativeText: text("narrative_text").notNull(),
    sectionsJsonb: jsonb("sections_jsonb").$type<MonthlyNarrativeSections>(),
    schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),
    citations: text("citations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_daily_narrative_profile_idx").on(t.profileId, t.forDate),
    uniqueIndex("saju_daily_narrative_cache_key").on(
      t.profileId,
      t.school,
      t.forDate,
      t.frameHash,
      t.modelId,
      t.promptVersion,
      t.algorithmVersion,
    ),
  ],
);
```

> **참고**: `sectionsJsonb` 와 `schoolSpecificJsonb` 는 nullable (NOT NULL 제약 없음). monthly 와 동일한 자가 치유 패턴.

- [ ] **Step 2: drizzle-kit generate 실행**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: `apps/dashboard/drizzle/<next>_<random>.sql` 생성. ALTER TABLE + UNIQUE INDEX 변경 포함. 생성된 파일 이름 메모.

- [ ] **Step 3: 생성된 SQL 검토 + 수동 append**

생성된 SQL 파일을 열어 확인:

자동 생성 부분 (drizzle-kit):
- `ALTER TABLE saju_daily_narrative ADD COLUMN prompt_version integer NOT NULL DEFAULT 1`
- `ALTER TABLE saju_daily_narrative ADD COLUMN sections_jsonb jsonb`
- `ALTER TABLE saju_daily_narrative ADD COLUMN school_specific_jsonb jsonb`
- `ALTER TABLE saju_daily_narrative ADD COLUMN citations text[] NOT NULL DEFAULT '{}'::text[]`

수동 append (drizzle-kit 이 자동 생성 못 함):

생성 파일 끝에 다음 추가:

```sql
--> statement-breakpoint
-- v0.3.x daily narrative richer 보강: 기존 plain-text row 청소 후 새 모델로 lazy regen.
-- prompt_version=1 캐시 키 충돌 회피 (sections_jsonb NULL row 와 신규 row 가 같은 키를 만드는 것 차단).
DELETE FROM "saju_daily_narrative";
```

UNIQUE INDEX 재작성 — drizzle-kit 이 자동 처리했는지 검증:
- 처리됨 → 그대로 둠
- 미처리 → 다음 append:

```sql
--> statement-breakpoint
DROP INDEX IF EXISTS "saju_daily_narrative_cache_key";--> statement-breakpoint
CREATE UNIQUE INDEX "saju_daily_narrative_cache_key" ON "saju_daily_narrative"
  USING btree ("profile_id","school","for_date","frame_hash","model_id","prompt_version","algorithm_version");
```

- [ ] **Step 4: 로컬 DB 마이그레이션 검증 (가능하면)**

로컬에 `TEST_DATABASE_URL` DB 가 떠 있으면:

Run: `cd apps/dashboard && DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate`
Expected: 적용 성공. 에러 시 SQL 수정.

(로컬 DB 미기동 시 이 단계 skip — 운영 적용 단계에서 검증.)

- [ ] **Step 5: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors (`MonthlyNarrativeSections` / `SchoolSpecific` 타입이 `$type<>` 에 맞음).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git -c commit.gpgsign=false commit -m "feat(db): saju_daily_narrative ALTER — prompt_version + sections + schoolSpecific + citations"
```

---

## Task 6: `narrative-server.ts` 완전 재작성

**Files:**
- Modify: `apps/dashboard/src/features/saju-daily-tri/api/narrative-server.ts` (재작성)
- Modify: `apps/dashboard/src/features/saju-daily-tri/index.ts` (export 갱신)

- [ ] **Step 1: 기존 파일 재작성**

> 기존 narrative-server.ts 는 plain text 모델이라 *완전 재작성*. git history 가 백업.

File: `apps/dashboard/src/features/saju-daily-tri/api/narrative-server.ts`

```typescript
// v0.3.x — LLM daily narrative 빌더/캐시 서버 헬퍼.
//
// 정책 (monthly narrative-server.ts 1:1 미러):
//  - 캐시 키: (profile_id, school, for_date, frame_hash, model_id,
//             prompt_version, algorithm_version)
//  - frame_hash: DailyLiteFrame JSON.stringify 의 sha256
//  - miss 시 Anthropic SDK 호출 → JSON.parse + zod.parse 후 캐시 저장
//  - LLM/JSON/zod 실패는 throw → route 가 500 + console.error
//  - 동시 cache miss / null schoolSpecific 자가 치유: onConflictDoUpdate
//
// v0.3 초기 plain-text 모델에서 v0.3.x richer 모델로 완전 재작성. 마이그레이션은
// 기존 row 를 DELETE 하여 cache key 충돌 회피.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { ALGORITHM_VERSION, type DailyLiteFrame } from "@gons/saju";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuDailyNarrative,
  type MonthlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  PROMPT_VERSION,
  SCHOOL_PROMPTS,
  type NarrativeSchool,
} from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";

const MAX_NARRATIVE_TOKENS = 4096;

export type { NarrativeSchool } from "./prompts";

// monthly narrative-server.ts 와 동일 동작. cross-feature import 는 FSD boundary 위반 — 의도적 복제.
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("no JSON object found in LLM response");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error("unbalanced JSON object in LLM response");
}

export interface DailyNarrativeResult {
  school: NarrativeSchool;
  forDate: string;
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
  modelId: string;
  promptVersion: number;
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}

async function callDailyLlmAndParseWithRetry(
  school: NarrativeSchool,
  systemPrompt: string,
  baseUserContent: string,
  modelId: string,
): Promise<NarrativeOutput> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userContent =
      attempt === 1
        ? baseUserContent
        : `${baseUserContent}\n\n[중요 — 재시도] 이전 응답이 schema 검증에 실패했습니다. 모든 sections 필드를 충분한 분량으로 채우고, schoolSpecific 의 모든 필드를 빠짐없이 작성하세요. 출력은 JSON 본문만.\n\n검증 실패 상세: ${lastErr instanceof ZodError ? lastErr.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(lastErr)}`;

    let response;
    try {
      response = await anthropic.messages.create({
        model: modelId,
        max_tokens: MAX_NARRATIVE_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });
    } catch (err) {
      console.error(
        `[saju-daily-narrative] LLM_CALL_FAIL model=${modelId} school=${school} attempt=${attempt}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock ? textBlock.text : "";
    const stopReason = response.stop_reason;

    try {
      const json = JSON.parse(extractJsonObject(text));
      return SCHOOL_SCHEMAS[school].parse(json) as NarrativeOutput;
    } catch (err) {
      lastErr = err;
      if (err instanceof ZodError) {
        console.error(
          `[saju-daily-narrative] ZOD_FAIL model=${modelId} school=${school} attempt=${attempt} stop=${stopReason} text_len=${text.length}: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
        if (attempt === 2) throw err;
      } else {
        console.error(
          `[saju-daily-narrative] JSON_PARSE_FAIL model=${modelId} school=${school} attempt=${attempt} stop=${stopReason} text_len=${text.length} text_head=${JSON.stringify(text.slice(0, 200))}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }
  }
  throw lastErr ?? new Error("LLM retry loop exited without result");
}

export async function getOrBuildDailyNarrative(
  profileId: string,
  school: NarrativeSchool,
  forDate: string,
  frame: DailyLiteFrame,
  modelId: string,
): Promise<DailyNarrativeResult> {
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  // 1) 캐시 조회 — promptVersion 필터로 마이그레이션 직후 새 row 부터 시작.
  const cached = await db.query.sajuDailyNarrative.findFirst({
    where: and(
      eq(sajuDailyNarrative.profileId, profileId),
      eq(sajuDailyNarrative.school, school),
      eq(sajuDailyNarrative.forDate, forDate),
      eq(sajuDailyNarrative.frameHash, frameHash),
      eq(sajuDailyNarrative.modelId, modelId),
      eq(sajuDailyNarrative.promptVersion, PROMPT_VERSION),
      eq(sajuDailyNarrative.algorithmVersion, ALGORITHM_VERSION),
    ),
  });
  if (cached) {
    if (!cached.sectionsJsonb || !cached.schoolSpecificJsonb) {
      console.warn(
        "[saju/daily-narrative] cached row with null sections/schoolSpecific — falling through to regen",
        { profileId, school, forDate, promptVersion: cached.promptVersion },
      );
    } else {
      return {
        school,
        forDate,
        narrativeText: cached.narrativeText,
        sections: cached.sectionsJsonb,
        schoolSpecific: cached.schoolSpecificJsonb,
        citations: cached.citations,
        modelId: cached.modelId,
        promptVersion: cached.promptVersion,
        algorithmVersion: cached.algorithmVersion,
        generatedAt: cached.generatedAt.toISOString(),
        fromCache: true,
      };
    }
  }

  const systemPrompt = SCHOOL_PROMPTS[school];

  const baseUserContent = `${forDate} 일운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${forDate} 일운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"800~1200자 3문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별 필드...},"citations":["출처1","출처2"]}`;

  const parsed = await callDailyLlmAndParseWithRetry(
    school,
    systemPrompt,
    baseUserContent,
    modelId,
  );

  await db
    .insert(sajuDailyNarrative)
    .values({
      profileId,
      school,
      forDate,
      frameHash,
      modelId,
      promptVersion: PROMPT_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      narrativeText: parsed.narrativeText,
      sectionsJsonb: parsed.sections,
      schoolSpecificJsonb: parsed.schoolSpecific,
      citations: parsed.citations,
    })
    .onConflictDoUpdate({
      target: [
        sajuDailyNarrative.profileId,
        sajuDailyNarrative.school,
        sajuDailyNarrative.forDate,
        sajuDailyNarrative.frameHash,
        sajuDailyNarrative.modelId,
        sajuDailyNarrative.promptVersion,
        sajuDailyNarrative.algorithmVersion,
      ],
      set: {
        narrativeText: parsed.narrativeText,
        sectionsJsonb: parsed.sections,
        schoolSpecificJsonb: parsed.schoolSpecific,
        citations: parsed.citations,
        generatedAt: new Date(),
      },
    });

  return {
    school,
    forDate,
    narrativeText: parsed.narrativeText,
    sections: parsed.sections,
    schoolSpecific: parsed.schoolSpecific,
    citations: parsed.citations,
    modelId,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
```

- [ ] **Step 2: `index.ts` server-only export 추가**

Modify: `apps/dashboard/src/features/saju-daily-tri/index.ts`

```typescript
export {
  getOrBuildDaily,
  DailyBuildError,
  ProfileNotFoundError,
  type GetDailyResult,
} from "./api/daily-server";
export {
  getOrBuildDailyNarrative,
  type NarrativeSchool,
  type DailyNarrativeResult,
} from "./api/narrative-server";
export { PROMPT_VERSION } from "./api/prompts";
```

> **참고**: UI export 는 Task 9 step 2 에서 합쳐 추가.

- [ ] **Step 3: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/saju-daily-tri/api/narrative-server.ts apps/dashboard/src/features/saju-daily-tri/index.ts
git -c commit.gpgsign=false commit -m "feat(saju): daily narrative-server 재작성 — JSON+zod+sections+schoolSpecific (monthly 1:1)"
```

---

## Task 7: UI 컴포넌트 — `DailyCrossCheckBadge`

**Files:**
- Create: `apps/dashboard/src/features/saju-daily-tri/ui/DailyCrossCheckBadge.tsx`

`TriNationDailyLite` 는 monthly 의 `crossCheck { agreement, notes }` 가 없고 `overallVibe` ("auspicious"/"inauspicious"/"neutral") 만 있음. 그에 맞게 적응.

- [ ] **Step 1: 작성**

File: `apps/dashboard/src/features/saju-daily-tri/ui/DailyCrossCheckBadge.tsx`

```typescript
// daily 의 4학파 합의(overallVibe) 표시 — server-safe, no client hooks.
//
// monthly 의 MonthlyCrossCheckBadge 와 달리 TriNationDailyLite 는
// crossCheck 객체가 없고 overallVibe ("auspicious"/"inauspicious"/"neutral") 만 있음.
// 디자인 토큰: --color-hairline / --color-surface-2.
import type { TriNationDailyLite } from "@gons/saju";

interface Props {
  triNation: TriNationDailyLite;
}

const STATUS_AUSPICIOUS = "text-green-700";
const STATUS_NEUTRAL = "text-[var(--color-text-muted)]";
const STATUS_INAUSPICIOUS = "text-amber-700";

function ganjiKey(g: { stem: string; branch: string }): string {
  return `${g.stem}${g.branch}`;
}

export function DailyCrossCheckBadge({ triNation }: Props) {
  const { forDate, frames, overallVibe } = triNation;

  const label =
    overallVibe === "auspicious"
      ? { icon: "✓", text: "4학파 합의 — 길운", className: STATUS_AUSPICIOUS }
      : overallVibe === "inauspicious"
        ? { icon: "⚠", text: "4학파 합의 — 흉운", className: STATUS_INAUSPICIOUS }
        : { icon: "ⓘ", text: "4학파 합의 — 중립 또는 불일치", className: STATUS_NEUTRAL };

  const ganjiKeys = [
    ganjiKey(frames.ko.dayGanji),
    ganjiKey(frames.cnZiping.dayGanji),
    ganjiKey(frames.cnMangpai.dayGanji),
    ganjiKey(frames.jp.dayGanji),
  ];
  const uniqueGanji = Array.from(new Set(ganjiKeys));
  const ganjiDisplay = uniqueGanji.length === 1
    ? `일진: ${uniqueGanji[0]}`
    : `일진 학파별 차이: 한국 ${ganjiKeys[0]} / 中자평 ${ganjiKeys[1]} / 中맹파 ${ganjiKeys[2]} / 日추명 ${ganjiKeys[3]}`;

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-2)] p-3 text-sm space-y-1">
      <div className={label.className}>
        {label.icon} {forDate} — {label.text}
      </div>
      <div className="text-[var(--color-text-muted)]">{ganjiDisplay}</div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/saju-daily-tri/ui/DailyCrossCheckBadge.tsx
git -c commit.gpgsign=false commit -m "feat(saju): DailyCrossCheckBadge — overallVibe 기반 표시"
```

---

## Task 8: UI 컴포넌트 — `DailyFrameView` (학파별 frame + narrative slot)

**Files:**
- Create: `apps/dashboard/src/features/saju-daily-tri/ui/DailyFrameView.tsx`

`DailyLiteFrame` 은 단순화된 frame (`dayGanji`, `dayVibe`, `hints` 만 있음). monthly `MonthlyFrameView` 대비 충/합 분석·신살·schoolSpecificHints 모두 없음. narrative 부분은 monthly 와 동일하게 `shared/ui/saju-narrative` 4 컴포넌트 조합.

- [ ] **Step 1: 작성**

File: `apps/dashboard/src/features/saju-daily-tri/ui/DailyFrameView.tsx`

```typescript
"use client";

// DailyLiteFrame 표시 + narrative 영역.
//
// monthly 의 MonthlyFrameView 와 달리 daily frame 은 의도적 단순화 모델
// (dayGanji + dayVibe + hints) — 충/합 분석·신살·schoolSpecificHints 없음.
// narrative 부분만 monthly 와 동일하게 shared/ui/saju-narrative 4 컴포넌트 조합.
//
// state lift-up (monthly 와 동일): narrative 캐시/AbortController/카운트다운은 부모(TriDailyTabs).

import type { DailyLiteFrame } from "@gons/saju";
import type {
  MonthlyNarrativeSections,
  NarrativeSchool,
  SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  CitationsFootnote,
  KeyTermsStrip,
  ModelBadge,
  NarrativeSection,
  SchoolSpecificCard,
} from "@/shared/ui/saju-narrative";

export interface DailyNarrativePayload {
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  schoolSpecific: SchoolSpecific | null;
  citations: string[];
  modelId: string;
}

interface Props {
  frame: DailyLiteFrame;
  school: NarrativeSchool;
  narrative: DailyNarrativePayload | null;
  loading: boolean;
  error: string | null;
  retryRemainingMs: number;
  onFetch: () => void;
}

function formatRetryRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function vibeStyle(vibe: DailyLiteFrame["dayVibe"]): {
  label: string;
  className: string;
} {
  switch (vibe) {
    case "auspicious":
      return { label: "길운 (auspicious)", className: "text-green-700 font-bold" };
    case "inauspicious":
      return { label: "흉운 (inauspicious)", className: "text-red-700 font-bold" };
    case "neutral":
      return { label: "중립 (neutral)", className: "text-[var(--color-text-muted)] font-bold" };
  }
}

export function DailyFrameView({
  frame,
  school,
  narrative,
  loading,
  error,
  retryRemainingMs,
  onFetch,
}: Props) {
  const rateLimited = retryRemainingMs > 0;
  const vibe = vibeStyle(frame.dayVibe);

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className={`text-lg ${vibe.className}`}>{vibe.label}</div>
          {narrative && <ModelBadge modelId={narrative.modelId} />}
        </div>
        <div className="text-sm text-gray-700">
          {frame.forDate} 일진:{" "}
          <span className="font-medium">
            {frame.dayGanji.stem}{frame.dayGanji.branch}
          </span>
        </div>
      </div>

      {frame.hints.length > 0 && (
        <div className="text-sm space-y-0.5">
          <div className="text-[var(--color-text-muted)]">해석 힌트:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {frame.hints.map((h, idx) => (
              <li key={idx}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {narrative ? (
        <div className="border-t pt-3 space-y-3">
          <KeyTermsStrip keyTerms={narrative.sections.keyTerms} />
          <NarrativeSection title="성격·기질" body={narrative.sections.personality} />
          <NarrativeSection title="직업·재물" body={narrative.sections.career} />
          <NarrativeSection title="관계" body={narrative.sections.relationship} />
          <NarrativeSection title="건강" body={narrative.sections.health} />
          <NarrativeSection title="오늘 흐름 요약" body={narrative.sections.daeunSummary} />
          {narrative.schoolSpecific && (
            <SchoolSpecificCard
              school={school}
              schoolSpecific={narrative.schoolSpecific}
            />
          )}
          <CitationsFootnote citations={narrative.citations} />
        </div>
      ) : (
        <button
          type="button"
          onClick={onFetch}
          disabled={loading || rateLimited}
          className="text-blue-600 text-sm disabled:text-gray-400"
        >
          {loading
            ? "분석 중…"
            : rateLimited
              ? `${formatRetryRemaining(retryRemainingMs)} 후 재시도 가능`
              : "더 자세히 보기"}
        </button>
      )}
      {rateLimited && (
        <div className="text-amber-700 text-sm" role="status" aria-live="polite">
          분당 요청 한도 초과 — {formatRetryRemaining(retryRemainingMs)} 후 다시 시도해주세요.
        </div>
      )}
      {error && !rateLimited && (
        <div className="text-red-600 text-sm" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/features/saju-daily-tri/ui/DailyFrameView.tsx
git -c commit.gpgsign=false commit -m "feat(saju): DailyFrameView — DailyLiteFrame + narrative slot"
```

---

## Task 9: UI 컴포넌트 — `TriDailyTabs` (client, 4학파 탭 + lazy fetch)

**Files:**
- Create: `apps/dashboard/src/features/saju-daily-tri/ui/TriDailyTabs.tsx`
- Modify: `apps/dashboard/src/features/saju-daily-tri/index.ts` (UI export 추가)

monthly `TriMonthlyTabs` 미러. 차이:
- fetch URL: `/api/saju/daily/${profileId}/narrative?school=...&forDate=...&model=...`
- frame shape: `DailyLiteFrame` (단순)
- "통합 비교" 탭은 daily 에서 *제외* (frame이 단순하여 비교할 항목이 적음 — daily 는 4학파 탭만)

- [ ] **Step 1: 작성**

File: `apps/dashboard/src/features/saju-daily-tri/ui/TriDailyTabs.tsx`

```typescript
"use client";

// 4탭 (한국·中자평·中맹파·日추명) — 학파별 DailyFrameView 렌더.
//
// TriMonthlyTabs 패턴 미러. 차이:
//  - fetch URL 에 forDate 쿼리
//  - frame shape 가 DailyLiteFrame (단순화)
//  - "통합 비교" 탭 제외 (DailyLiteFrame 은 비교할 항목이 적음)
//
// state lift-up: narrative 캐시, AbortController, 429 retryAt 카운트다운.
// render 중 Date.now() 금지 + useEffect body 동기 setState 금지.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TriNationDailyLite } from "@gons/saju";
import { DailyFrameView, type DailyNarrativePayload } from "./DailyFrameView";
import { toUserMessage } from "../lib/errorMessage";
import type { SajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";

const TABS = [
  { key: "ko", label: "한국" },
  { key: "cn-ziping", label: "中자평" },
  { key: "cn-mangpai", label: "中맹파" },
  { key: "jp", label: "日추명" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const FRAME_KEY: Record<TabKey, keyof TriNationDailyLite["frames"]> = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
};

const tabId = (key: TabKey) => `tri-daily-tab-${key}`;
const panelId = (key: TabKey) => `tri-daily-panel-${key}`;

interface NarrativeState {
  payload: DailyNarrativePayload | null;
  loading: boolean;
  error: string | null;
  retryAt: number | null;
}

type NarrativeCache = Record<TabKey, NarrativeState>;

const INITIAL_NARRATIVE_STATE: NarrativeState = {
  payload: null,
  loading: false,
  error: null,
  retryAt: null,
};

const INITIAL_CACHE: NarrativeCache = {
  ko: INITIAL_NARRATIVE_STATE,
  "cn-ziping": INITIAL_NARRATIVE_STATE,
  "cn-mangpai": INITIAL_NARRATIVE_STATE,
  jp: INITIAL_NARRATIVE_STATE,
};

interface Props {
  profileId: string;
  forDate: string;
  triNation: TriNationDailyLite;
  modelKey: SajuModelKey;
}

export function TriDailyTabs({
  profileId,
  forDate,
  triNation,
  modelKey,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("ko");
  const [narratives, setNarratives] = useState<NarrativeCache>(INITIAL_CACHE);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    ko: null,
    "cn-ziping": null,
    "cn-mangpai": null,
    jp: null,
  });

  const anyRetryAt = (Object.values(narratives) as NarrativeState[]).reduce<
    number | null
  >((earliest, s) => {
    if (s.retryAt === null) return earliest;
    if (earliest === null) return s.retryAt;
    return Math.min(earliest, s.retryAt);
  }, null);

  useEffect(() => {
    if (anyRetryAt === null) return;
    tickRef.current = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setNarratives((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const k of Object.keys(prev) as TabKey[]) {
          if (prev[k].retryAt !== null && now >= prev[k].retryAt!) {
            next[k] = { ...prev[k], retryAt: null };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [anyRetryAt]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchNarrative = (school: TabKey) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setNarratives((prev) => ({
      ...prev,
      [school]: { ...prev[school], loading: true, error: null, retryAt: null },
    }));

    void (async () => {
      const startNow = Date.now();
      setNowMs(startNow);
      try {
        const res = await fetch(
          `/api/saju/daily/${profileId}/narrative?school=${school}&forDate=${forDate}&model=${modelKey}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const data = (await res.json()) as {
            error?: string;
            retryAfterMs?: number;
          };
          if (res.status === 429 && typeof data.retryAfterMs === "number") {
            const tNow = Date.now();
            setNowMs(tNow);
            setNarratives((prev) => ({
              ...prev,
              [school]: {
                ...prev[school],
                loading: false,
                error: null,
                retryAt: tNow + data.retryAfterMs!,
              },
            }));
            return;
          }
          throw new Error(data.error ?? "INTERNAL_ERROR");
        }
        const data = (await res.json()) as DailyNarrativePayload;
        setNarratives((prev) => ({
          ...prev,
          [school]: {
            payload: data,
            loading: false,
            error: null,
            retryAt: null,
          },
        }));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const rawCode = err instanceof Error ? err.message : null;
        setNarratives((prev) => ({
          ...prev,
          [school]: {
            ...prev[school],
            loading: false,
            error: toUserMessage(rawCode),
          },
        }));
      }
    })();
  };

  const remainingMs = (state: NarrativeState): number =>
    state.retryAt !== null && nowMs !== null
      ? Math.max(0, state.retryAt - nowMs)
      : 0;

  const focusTab = (key: TabKey) => {
    setActiveTab(key);
    tabRefs.current[key]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = TABS.findIndex((t) => t.key === activeTab);
    if (currentIndex < 0) return;
    switch (event.key) {
      case "ArrowRight": {
        event.preventDefault();
        focusTab(TABS[(currentIndex + 1) % TABS.length].key);
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        focusTab(TABS[(currentIndex - 1 + TABS.length) % TABS.length].key);
        break;
      }
      case "Home": {
        event.preventDefault();
        focusTab(TABS[0].key);
        break;
      }
      case "End": {
        event.preventDefault();
        focusTab(TABS[TABS.length - 1].key);
        break;
      }
    }
  };

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="삼국 학파 탭 (일운)" className="flex gap-2 border-b">
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              id={tabId(tab.key)}
              aria-selected={selected}
              aria-controls={panelId(tab.key)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={handleKeyDown}
              className={`px-3 py-2 ${
                selected ? "border-b-2 border-blue-600 font-bold" : ""
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {TABS.map((tab) => {
        const selected = activeTab === tab.key;
        if (!selected) {
          return (
            <div
              key={tab.key}
              role="tabpanel"
              id={panelId(tab.key)}
              aria-labelledby={tabId(tab.key)}
              hidden
            />
          );
        }
        return (
          <div
            key={tab.key}
            role="tabpanel"
            id={panelId(tab.key)}
            aria-labelledby={tabId(tab.key)}
            tabIndex={0}
          >
            <DailyFrameView
              frame={triNation.frames[FRAME_KEY[tab.key]]}
              school={tab.key}
              narrative={narratives[tab.key].payload}
              loading={narratives[tab.key].loading}
              error={narratives[tab.key].error}
              retryRemainingMs={remainingMs(narratives[tab.key])}
              onFetch={() => fetchNarrative(tab.key)}
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: index.ts UI export 추가**

Modify: `apps/dashboard/src/features/saju-daily-tri/index.ts`

`PROMPT_VERSION` re-export 아래에 추가:

```typescript
export { DailyCrossCheckBadge } from "./ui/DailyCrossCheckBadge";
export { TriDailyTabs } from "./ui/TriDailyTabs";
export type { DailyNarrativePayload } from "./ui/DailyFrameView";
```

- [ ] **Step 3: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 0 errors. (특히 react-hooks/error-boundaries 와 FSD boundary 통과.)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/saju-daily-tri/ui/TriDailyTabs.tsx apps/dashboard/src/features/saju-daily-tri/index.ts
git -c commit.gpgsign=false commit -m "feat(saju): TriDailyTabs — 4학파 lazy fetch"
```

---

## Task 10: API Route — `/api/saju/daily/[profileId]/narrative`

**Files:**
- Create: `apps/dashboard/src/app/api/saju/daily/[profileId]/narrative/route.ts`

monthly route 1:1 미러. 차이: `forDate` 쿼리 (year/month 대신).

- [ ] **Step 1: 작성**

File: `apps/dashboard/src/app/api/saju/daily/[profileId]/narrative/route.ts`

```typescript
// GET /api/saju/daily/[profileId]/narrative?school=ko|cn-ziping|cn-mangpai|jp&forDate=YYYY-MM-DD
//
// - auth 필수 (session.user.id 없으면 401)
// - school 쿼리 필수 (4가지 학파 외 값은 400 INVALID_SCHOOL)
// - forDate 쿼리 누락 시 KST 오늘. YYYY-MM-DD 외 → 400 INVALID_DATE
// - rate limit (5/min/user, keyPrefix='daily') → 초과 시 429 + retryAfterMs
// - getOrBuildDaily → frames[school] → getOrBuildDailyNarrative 체인
// - 에러 분기:
//   * ProfileNotFoundError → 404
//   * DailyBuildError      → 422 (입력 검증/만세력 합의 불일치 등)
//   * 그 외 (LLM/JSON/zod) → 500 + console.error
//
// monthly route 와의 차이: year/month → forDate 쿼리, keyPrefix='daily'.
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  getOrBuildDaily,
  DailyBuildError,
  ProfileNotFoundError,
} from "@/features/saju-daily-tri/api/daily-server";
import {
  getOrBuildDailyNarrative,
  type NarrativeSchool,
} from "@/features/saju-daily-tri/api/narrative-server";
import { currentKstDate } from "@/shared/lib/saju/resolveBirthInput";
import { checkRateLimit } from "@/shared/lib/llm/rateLimit";
import {
  SAJU_MODEL_REGISTRY,
  parseSajuModelKey,
} from "@/shared/lib/llm/saju-model-registry";

const SCHOOL_FRAME_KEY = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
} as const;

type SchoolParam = keyof typeof SCHOOL_FRAME_KEY;

function isSchoolParam(value: string | null): value is SchoolParam {
  return value !== null && value in SCHOOL_FRAME_KEY;
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId } = await ctx.params;
  const searchParams = new URL(req.url).searchParams;

  const schoolParam = searchParams.get("school");
  if (!isSchoolParam(schoolParam)) {
    return NextResponse.json({ error: "INVALID_SCHOOL" }, { status: 400 });
  }

  const forDateParam = searchParams.get("forDate");
  const forDate = forDateParam ?? currentKstDate();
  if (!isValidDate(forDate)) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  const rate = await checkRateLimit(session.user.id, "daily");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const daily = await getOrBuildDaily(profileId, session.user.id, forDate);
    const frame = daily.triNation.frames[SCHOOL_FRAME_KEY[schoolParam]];
    const school: NarrativeSchool = schoolParam;
    const modelKey = parseSajuModelKey(searchParams.get("model"));
    const modelId = SAJU_MODEL_REGISTRY[modelKey].id;
    const result = await getOrBuildDailyNarrative(
      profileId,
      school,
      forDate,
      frame,
      modelId,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json(
        { error: "PROFILE_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (err instanceof DailyBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[saju/daily/narrative] LLM error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
```

- [ ] **Step 2: rate-limit keyPrefix 'daily' 충돌 확인**

Run: `grep -rn "checkRateLimit" apps/dashboard/src/ --include="*.ts" | head`
Expected: `lifetime`, `yearly`, `monthly` 외에 `daily` 가 다른 곳에서 안 쓰임. 충돌 시 `daily-narrative` 등 prefix 명시.

- [ ] **Step 3: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/api/saju/daily/[profileId]/narrative/route.ts
git -c commit.gpgsign=false commit -m "feat(saju): /api/saju/daily/[profileId]/narrative GET — monthly route 미러"
```

---

## Task 11: Widget — `SajuTriDaily` (RSC)

**Files:**
- Create: `apps/dashboard/src/widgets/saju-tri-daily/ui/SajuTriDaily.tsx`
- Create: `apps/dashboard/src/widgets/saju-tri-daily/index.ts`

- [ ] **Step 1: SajuTriDaily.tsx 작성**

File: `apps/dashboard/src/widgets/saju-tri-daily/ui/SajuTriDaily.tsx`

```typescript
// 삼국 관점 일운 위젯 — server component.
//
// /fortune/[profileId] 페이지 daily 탭에 mount.
// getOrBuildDaily 캐시 hit/miss 처리 후 DailyCrossCheckBadge + TriDailyTabs 조립.
//
// forDate: 기본은 KST 현재 날짜. RSC props 로 외부 주입 가능 (향후 날짜 선택 UI 대비).
//
// 에러 처리: getOrBuildDaily 실패 시 .then(success, failure) discriminated union 으로
// 결과를 좁힌 뒤 JSX 분기. try/catch 안에서 JSX 를 생성하지 않는다 —
// react-hooks/error-boundaries lint 규칙 준수.
//
// narrative 는 client (TriDailyTabs) 가 lazy fetch — RSC 는 frame data 만 prefetch.
import {
  getOrBuildDaily,
  DailyCrossCheckBadge,
  TriDailyTabs,
} from "@/features/saju-daily-tri";
import { toUserMessage } from "@/features/saju-daily-tri/lib/errorMessage";
import { currentKstDate } from "@/shared/lib/saju/resolveBirthInput";
import type { SajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";

interface Props {
  profileId: string;
  userId: string;
  forDate?: string;
  modelKey: SajuModelKey;
}

export async function SajuTriDaily({
  profileId,
  userId,
  forDate,
  modelKey,
}: Props) {
  const date = forDate ?? currentKstDate();

  const result = await getOrBuildDaily(profileId, userId, date).then(
    ({ triNation }) => ({ ok: true as const, triNation }),
    (e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "INTERNAL_ERROR",
    }),
  );

  const headingId = "tri-daily-heading";

  if (result.ok) {
    return (
      <section
        aria-labelledby={headingId}
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2
          id={headingId}
          className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
        >
          삼국 관점 {date} 일운
        </h2>
        <div className="space-y-4">
          <DailyCrossCheckBadge triNation={result.triNation} />
          <TriDailyTabs
            profileId={profileId}
            forDate={date}
            triNation={result.triNation}
            modelKey={modelKey}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${headingId}-error`}
      className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
    >
      <h2
        id={`${headingId}-error`}
        className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
      >
        삼국 관점 {date} 일운
      </h2>
      <p className="text-sm text-red-600">{toUserMessage(result.error)}</p>
    </section>
  );
}
```

- [ ] **Step 2: widget index.ts 작성**

File: `apps/dashboard/src/widgets/saju-tri-daily/index.ts`

```typescript
export { SajuTriDaily } from "./ui/SajuTriDaily";
```

- [ ] **Step 3: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/saju-tri-daily/
git -c commit.gpgsign=false commit -m "feat(saju): SajuTriDaily widget — RSC + lazy narrative"
```

---

## Task 12: Tab 키 등록 (`tab-key.ts`)

**Files:**
- Modify: `apps/dashboard/src/shared/lib/saju/tab-key.ts`

- [ ] **Step 1: 기존 파일 확인**

Read: `apps/dashboard/src/shared/lib/saju/tab-key.ts`
Expected: `FORTUNE_TAB_KEYS` 와 `FORTUNE_TAB_META` 정의 확인. lifetime/yearly/monthly/chart/reading 의 정확한 label 확인.

- [ ] **Step 2: `daily` 키 + 메타 추가**

Modify: `apps/dashboard/src/shared/lib/saju/tab-key.ts`

`FORTUNE_TAB_KEYS` 배열에 monthly 다음, chart 앞에 `"daily"` 추가:

```diff
 export const FORTUNE_TAB_KEYS = [
   "lifetime",
   "yearly",
   "monthly",
+  "daily",
   "chart",
   "reading",
 ] as const;
```

`FORTUNE_TAB_META` 에 `daily: { label: "일운" }` 추가 (label 값은 기존 항목들 톤에 맞춰 작성):

```diff
 export const FORTUNE_TAB_META: Record<FortuneTabKey, { label: string }> = {
   lifetime: { label: <기존 label 그대로> },
   yearly: { label: <기존 label 그대로> },
   monthly: { label: <기존 label 그대로> },
+  daily: { label: "일운" },
   chart: { label: <기존 label 그대로> },
   reading: { label: <기존 label 그대로> },
 };
```

- [ ] **Step 3: tab-key.test.ts 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run src/shared/lib/saju/tab-key.test.ts`
Expected: PASS — `FORTUNE_TAB_KEYS` 순회 테스트가 `daily` 포함하여 자동 통과.

- [ ] **Step 4: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/lib/saju/tab-key.ts
git -c commit.gpgsign=false commit -m "feat(saju): tab-key 'daily' (일운) 등록"
```

---

## Task 13: 페이지 통합 (`app/fortune/[profileId]/page.tsx`)

> **2026-05-20 패치 — Path B**: spec §7.1 결정에 따라 `widgets/saju-detail/index.ts` 에서 `SajuDailyFortune` export 를 *제거하지 않는다* (FortuneCardClient 가 의존). 이 Task 의 step 5 는 제거됨.

**Files:**
- Modify: `apps/dashboard/src/app/fortune/[profileId]/page.tsx`

- [ ] **Step 1: import 정리**

Modify: `apps/dashboard/src/app/fortune/[profileId]/page.tsx`

```diff
-import { getTodayDailyFortune } from "@/entities/saju-chart";
 import {
   ensureChartAndReadings,
   generateYearlyReading,
 } from "@/features/saju-reading";
 import {
   SajuDetailHeader,
   SajuPillarsBoard,
   SajuElementsChart,
   SajuTenGodsTable,
   SajuPatternCard,
   SajuMajorFortuneTimeline,
   SajuYearlyReading,
-  SajuDailyFortune,
   SajuReadingSections,
 } from "@/widgets/saju-detail";
 import { SajuTriLifetime } from "@/widgets/saju-tri-lifetime";
 import { SajuTriYearly } from "@/widgets/saju-tri-yearly";
 import { SajuTriMonthly } from "@/widgets/saju-tri-monthly";
+import { SajuTriDaily } from "@/widgets/saju-tri-daily";
 import { parseSajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";
 import { SajuModelPicker } from "@/features/saju-model-picker";
 import { TabsNav, TabPanel, TabSkeleton } from "@/shared/ui/Tabs";
 import {
   FORTUNE_TAB_KEYS,
   FORTUNE_TAB_META,
   parseFortuneTabKey,
 } from "@/shared/lib/saju/tab-key";
 import type {
   Element,
   MajorFortune,
   Strength,
   TenGodAssignment,
   Stem,
   Branch,
-  DailyFortunePayload,
   SajuChart,
 } from "@gons/saju";
```

- [ ] **Step 2: `kstTodayDate` 함수 + `dailyRow` fetch 제거**

`kstTodayDate` 함수 정의 제거:

```diff
-function kstTodayDate(): string {
-  const now = new Date();
-  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
-  return kst.toISOString().slice(0, 10);
-}
```

`Promise.all` 단일 호출로 변경:

```diff
-  // 3. 세운 (lazy) + 일진 (cron이 채운 row) 병렬 + 부분 실패 허용
-  const [yearlyResult, dailyRow] = await Promise.all([
-    generateYearlyReading({
-      chart: sajuChart,
-      chartId: chart.id,
-      year: currentYear,
-    }).then(
-      (r) => ({ ok: true as const, body: r.body }),
-      (e: unknown) => ({
-        ok: false as const,
-        error: String(e instanceof Error ? e.message : e).slice(0, 200),
-      }),
-    ),
-    getTodayDailyFortune(chart.id, kstTodayDate()).catch(() => null),
-  ]);
+  // 3. 세운 (lazy) — daily 는 별도 탭으로 분리 (SajuTriDaily widget)
+  const yearlyResult = await generateYearlyReading({
+    chart: sajuChart,
+    chartId: chart.id,
+    year: currentYear,
+  }).then(
+    (r) => ({ ok: true as const, body: r.body }),
+    (e: unknown) => ({
+      ok: false as const,
+      error: String(e instanceof Error ? e.message : e).slice(0, 200),
+    }),
+  );
```

- [ ] **Step 3: `daily` 탭 분기 추가**

기존 `activeTab === "monthly"` 분기 다음에 추가:

```tsx
{activeTab === "daily" && (
  <TabPanel tabKey="daily" idPrefix={FORTUNE_TAB_PREFIX}>
    <Suspense fallback={<TabSkeleton />}>
      <SajuTriDaily
        profileId={profileId}
        userId={session.user.id}
        modelKey={modelKey}
      />
    </Suspense>
  </TabPanel>
)}
```

- [ ] **Step 4: `reading` 탭 안의 옛 일진 섹션 제거**

`reading` 탭 분기 안 `{dailyRow && (...)}` 블록 전체 제거:

```diff
       {activeTab === "reading" && (
         <TabPanel tabKey="reading" idPrefix={FORTUNE_TAB_PREFIX}>
           <section ...>대운 흐름</section>
           <section ...>{currentYear}년 세운 · 월운</section>
-          {dailyRow && (
-            <section
-              aria-labelledby="daily-heading"
-              className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
-            >
-              <h2 id="daily-heading" ...>오늘 일진</h2>
-              <SajuDailyFortune
-                payload={dailyRow.payload as DailyFortunePayload}
-                dayPillar={`${dailyRow.dayStem}${dailyRow.dayBranch}`}
-              />
-            </section>
-          )}
           <section aria-labelledby="readings-heading" className="mb-8">
             <h2 id="readings-heading">해설</h2>
             <SajuReadingSections readings={readings} errors={errors} />
           </section>
         </TabPanel>
       )}
```

- [ ] **Step 5: ~~`widgets/saju-detail/index.ts` 에서 `SajuDailyFortune` export 제거~~ (Path B — 보존)**

> **Path B 적용**: `widgets/saju-detail/index.ts` 의 `SajuDailyFortune` export 는 *유지*. FortuneCardClient.tsx (`widgets/fortune/ui/`) 가 의존. 이 step 은 *no-op*.

- [ ] **Step 6: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 0 errors.

> **만약 typecheck 에서 SajuDailyFortune 호출자 추가 발견** → 호출자도 같은 commit 에 정리.

- [ ] **Step 7: Commit**

```bash
git add "apps/dashboard/src/app/fortune/[profileId]/page.tsx"
git -c commit.gpgsign=false commit -m "feat(saju): daily 탭 페이지 통합 + reading 탭 옛 일진 섹션 제거"
```

---

## ~~Task 14~~: ~~옛 SajuDailyFortune 컴포넌트 파일 + 통합 테스트 제거~~ (Path B — 보존)

> **Path B 적용 (2026-05-20)**: 대시보드 `FortuneCardClient.tsx` 가 `SajuDailyFortune` 을 사용하고 있으므로 본 PR-A 에서 옛 컴포넌트 파일과 cron-prefill 통합 테스트를 *제거하지 않는다*. 이 Task 전체는 PR-B 로 이월. 단순 skip 후 Task 15 로 진행.

---

## Task 15: 회귀 검증 — typecheck / lint / test / build

**Files:** 없음 (검증만)

- [ ] **Step 1: typecheck**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 2: lint**

Run: `cd apps/dashboard && pnpm lint`
Expected: 0 errors. (특히 react-hooks/error-boundaries 와 FSD boundary 통과.)

- [ ] **Step 3: 단위 + 통합 테스트**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm vitest run`
Expected:
- 단위 테스트 모두 통과 (특히 `schemas.test.ts`, `resolveBirthInput.test.ts`, `tab-key.test.ts`)
- DB 통합 테스트는 로컬 DB 미기동 시 ECONNREFUSED — 정상 (memory `gons-dashboard CLAUDE.md` Gotcha #2)

- [ ] **Step 4: 운영 빌드 검증**

Run: `cd apps/dashboard && pnpm build`
Expected: 운영 빌드 성공. Next.js 16 RSC + Turbopack.

- [ ] **Step 5: commit 안 함** — 회귀 검증 단계는 commit 없음. 모두 통과 시 Task 16 으로.

---

## Task 16: 운영 배포 (PR 머지 후)

**Files:** 없음 (외부 시스템 변경)

- [ ] **Step 1: PR-A 생성 + GHA 통과 확인**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(saju): 일운(daily) tri-narrative 위젯 추가" --body "$(cat <<'EOF'
## Summary

- 사주 v0.3.x 일운(日運) 4학파 narrative widget 추가
- `lifetime / yearly / monthly / **daily** / chart / reading` 탭 구조
- 옛 `SajuDailyFortune` (cron-prefill) UI 제거
- `saju_daily_narrative` 에 monthly 패턴 4 컬럼 추가 (prompt_version, sections_jsonb, school_specific_jsonb, citations)
- 기존 plain-text row 는 마이그레이션에서 DELETE — lazy regen
- 옛 `saju_daily_fortunes` 테이블·코드는 PR-B 에서 깊은 정리

Spec: docs/superpowers/specs/2026-05-20-saju-tri-daily-widget-design.md
Plan: docs/superpowers/plans/2026-05-20-saju-tri-daily-widget-implementation.md

## Test plan

- [ ] CI 통과 (typecheck + lint + test + build)
- [ ] 운영 마이그레이션 적용 검증 (\`pnpm db:migrate --i-know-this-is-prod\`)
- [ ] Docker 배포 후 \`/fortune/[profileId]?tab=daily\` 4학파 lazy load
- [ ] daily 탭 → 한국 탭 narrative 800~1200자 + sections + schoolSpecific + citations 확인
- [ ] daily 탭 → cn-ziping 탭 narrative 정상
- [ ] daily 탭 → cn-mangpai 탭 narrative 정상
- [ ] daily 탭 → jp 탭 narrative 정상
- [ ] reading 탭 → 옛 일진 섹션 제거 확인
- [ ] reading 탭 → 대운/세운/해설 정상 유지
EOF
)"
```

- [ ] **Step 2: GHA Build & Push 완료 대기**

Run: `gh run watch`
Expected: Build & Push Docker Images job 통과.

- [ ] **Step 3: 운영 DB 마이그레이션 적용**

```bash
cd apps/dashboard
I_KNOW_THIS_IS_PROD=1 pnpm db:migrate
```

Expected: `Applied 1 migration` 메시지. `saju_daily_narrative` 테이블에 4 컬럼 추가 + 인덱스 재생성 + 기존 row DELETE.

- [ ] **Step 4: Docker 컨테이너 교체**

```bash
docker --context home-server compose -f /home/gon/projects/gon/gons-dashboard/docker-compose.yml pull app cron
docker --context home-server compose -f /home/gon/projects/gon/gons-dashboard/docker-compose.yml up -d app cron
```

Expected: 컨테이너 healthy.

- [ ] **Step 5: 배포 검증 — memory `docker-deploy-verify-pattern`**

```bash
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"
```
Expected: `{"status":"ok"}`.

API 라우트 검증 (인증 없이):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://gons.krdn.kr/api/saju/daily/00000000-0000-0000-0000-000000000000/narrative?school=ko"
```
Expected: `401`.

- [ ] **Step 6: 브라우저 검증**

`/fortune/[profileId]?tab=daily` 로그인 후 방문 → 4학파 lazy load 동작 확인.

각 학파 탭 narrative 분량 800~1200자 + sections grid + schoolSpecific 박스 + citations footer 표시 확인.

`reading` 탭 → 옛 일진 섹션 제거됐는지 확인.

PR-A 끝. PR-B (옛 `saju_daily_fortunes` 테이블 + `dailyFortune.ts` 깊은 정리) 는 며칠 운영 안정성 확인 후 별도 작업.

---

## Self-Review

**1. Spec coverage 점검:**

- §1 결정 (탭 신설, lazy fetch, 800~1200자, ALTER TABLE, 시간 키 forDate, Sections 재사용) → Task 3·5·6·8·11·13 으로 모두 다룸. ✓
- §2.1 모듈 트리 (features/, widgets/, app/api/, shared helper, tab-key, schema) → Task 1·2·3·4·5·6·7·8·9·10·11·12·13 매핑. ✓
- §3.1·§3.2 DB ALTER TABLE → Task 5. ✓
- §3.3 마이그레이션 분할 (PR-A only) → Task 5 + Task 16. ✓
- §4 UI 컴포넌트 (DailyCrossCheckBadge / DailyFrameView / TriDailyTabs / SajuTriDaily) → Task 7·8·9·11. ✓
- §5 페이지 통합 + tab-key → Task 12·13. ✓
- §6 API Route → Task 10. ✓
- §7.1 옛 시스템 표면 제거 (PR-A) → Task 13·14. ✓
- §7.2 옛 시스템 깊은 정리 (PR-B) → 명시적 out-of-scope. ✓
- §8 에러 처리 → Task 6·10·11 안에 분기 처리. ✓
- §9 테스트 → Task 1·4·12·15. ✓
- §10 운영 배포 → Task 16. ✓

**2. Placeholder scan:** 없음 — 모든 코드 블록은 실행 가능한 완전한 코드. TBD/TODO 없음.

**3. Type consistency:**
- `DailyBuildError`, `ProfileNotFoundError`, `GetDailyResult`, `DailyNarrativeResult` (Task 6) — Task 10·11 에서 동일 이름 사용. ✓
- `NarrativeSchool` (Task 3 prompts) — Task 4·6·10 에서 동일. ✓
- `MonthlyNarrativeSections` / `SchoolSpecific` 재사용 (Task 4·5·6·8). ✓
- `TriNationDailyLite` / `DailyLiteFrame` (Task 7·8·9·11). ✓
- `currentKstDate` (Task 1 export) — Task 10·11 에서 사용. ✓
- `tab-key` `daily` (Task 12) — Task 13 페이지에서 분기. ✓

**4. 누락된 spec 요구사항 점검:** 없음 — 모든 결정이 Task 로 매핑됨.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-saju-tri-daily-widget-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 각 Task 마다 fresh subagent 가 처리. Task 간 리뷰. 빠른 반복.
2. **Inline Execution** — 본 세션에서 batch checkpoint 로 진행.

어느 방향으로 갈까요?
