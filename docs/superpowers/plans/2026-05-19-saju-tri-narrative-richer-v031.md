# Saju Tri Narrative v0.3.1 — Yearly/Monthly Richer Edition 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4학파 yearly + monthly narrative 를 lifetime v0.2 패턴 (prompts.ts 분리 + COMMON_HEADER + 학파별 800자+ BODY + PROMPT_VERSION + schoolSpecific + keyTerms/cautions) 으로 확장. cn-ziping 회귀 (587자 → 1200~1600자) 해소 + 4학파 차별화.

**Architecture:** B 안 채택 — yearly + monthly 의 출력 스키마를 학파별로 확장 (schoolSpecific union, lifetime v0.2 의 SchoolSpecificKo/Ziping/Mangpai/Jp 재사용), 학파별 system prompt 30~50줄로 강화, PROMPT_VERSION 캐시 키 추가로 자연스러운 무효화. lifetime UI 컴포넌트를 `shared/ui/saju-narrative/` 로 승격해 3 도메인이 공유. daily 는 비범위.

**Tech Stack:** Next.js 16 (App Router, RSC) · Drizzle ORM · PostgreSQL · Zod · Anthropic SDK (claude-opus-4-7, cli-proxy 경유) · Vitest · Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-05-19-saju-tri-narrative-richer-v031-design.md`

**Memory hints (재진입 시 빠른 컨텍스트):**
- `saju-yearly-wrapper-pattern.md` (체크포인트 5/6 memory) — yearly builder 와 lifetime 의 verifyConsensus 차이
- `anthropic-opus-temperature-deprecated.md` — opus 4.x 에 temperature 보내면 안 됨
- `react-error-boundaries-lint-rule.md` — server async + try/catch 안 JSX 금지
- `docker-deploy-verify-pattern.md` — PR 머지 후 운영 배포 4단계 검증

---

## File Structure

### 신규 (Create)

**yearly:**
- `apps/dashboard/src/features/saju-yearly-tri/api/prompts.ts` — PROMPT_VERSION 상수 + 공통 헤더 + 학파별 system prompt 4종 (yearly 톤)
- `apps/dashboard/src/features/saju-yearly-tri/api/schemas.ts` — Zod 스키마 (공통 + 학파별 discriminated) + TypeScript 타입 export
- `apps/dashboard/src/features/saju-yearly-tri/api/schemas.test.ts` — 학파별 스키마 검증 단위 테스트

**monthly:**
- `apps/dashboard/src/features/saju-monthly-tri/api/prompts.ts` — yearly 패턴 미러링, "이번 달" 톤
- `apps/dashboard/src/features/saju-monthly-tri/api/schemas.ts` — yearly 와 동일 구조 (MonthlyNarrativeSections 사용)
- `apps/dashboard/src/features/saju-monthly-tri/api/schemas.test.ts` — 학파별 스키마 검증

**shared UI 승격:**
- `apps/dashboard/src/shared/ui/saju-narrative/KeyTermsStrip.tsx` — features/saju-lifetime-tri/ui/ 에서 이동
- `apps/dashboard/src/shared/ui/saju-narrative/NarrativeSection.tsx` — 동
- `apps/dashboard/src/shared/ui/saju-narrative/CitationsFootnote.tsx` — 동
- `apps/dashboard/src/shared/ui/saju-narrative/CautionsBanner.tsx` — 신규 (v0.2 lifetime 에서 sections.cautions 직접 렌더링하던 부분을 추출)
- `apps/dashboard/src/shared/ui/saju-narrative/school-specific/SchoolSpecificCard.tsx` — features 에서 이동
- `apps/dashboard/src/shared/ui/saju-narrative/school-specific/KoSchoolDetail.tsx` — 동
- `apps/dashboard/src/shared/ui/saju-narrative/school-specific/ZipingSchoolDetail.tsx` — 동
- `apps/dashboard/src/shared/ui/saju-narrative/school-specific/MangpaiSchoolDetail.tsx` — 동
- `apps/dashboard/src/shared/ui/saju-narrative/school-specific/JpSchoolDetail.tsx` — 동
- `apps/dashboard/src/shared/ui/saju-narrative/index.ts` — barrel export

**Migration:**
- `apps/dashboard/drizzle/0017_<random>_richer_yearly_monthly.sql` — pnpm db:generate 산출물

### 수정 (Modify)

- `apps/dashboard/src/shared/lib/db/schema.ts:590-612` — `YearlyNarrativeSections` + `MonthlyNarrativeSections` 에 keyTerms/cautions 추가
- `apps/dashboard/src/shared/lib/db/schema.ts:723-759` — `sajuYearlyNarrative` 에 `promptVersion`/`schoolSpecificJsonb` 컬럼, unique index 갱신
- `apps/dashboard/src/shared/lib/db/schema.ts:813-855` — `sajuMonthlyNarrative` 에 동일 컬럼·인덱스
- `apps/dashboard/src/features/saju-yearly-tri/api/narrative-server.ts` — system prompt 교체, max_tokens 6144, 학파별 schema 검증, 캐시 키에 promptVersion 포함, 반환값 확장, onConflictDoUpdate 로 변경
- `apps/dashboard/src/features/saju-monthly-tri/api/narrative-server.ts` — 동일 (max_tokens 4096)
- `apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameView.tsx` — shared/ui/saju-narrative 의 컴포넌트 import 경로로 교체
- `apps/dashboard/src/features/saju-lifetime-tri/ui/TriNationTabs.tsx` — 동 (필요 시)
- `apps/dashboard/src/features/saju-lifetime-tri/index.ts` — UI 컴포넌트 re-export 제거 (이제 shared/ui)
- `apps/dashboard/src/features/saju-yearly-tri/ui/*.tsx` — narrative 렌더링 컴포넌트가 keyTerms/cautions/schoolSpecific 사용하도록 갱신 (정확한 파일은 Phase 4 시점에 식별)
- `apps/dashboard/src/features/saju-monthly-tri/ui/*.tsx` — 동
- API route 가 `prompt_version` + `school_specific` 를 응답에 포함하도록 갱신 (yearly: `app/api/saju/yearly/[profileId]/narrative/route.ts`, monthly: `app/api/saju/monthly/[profileId]/narrative/route.ts`)

### Test

- 신규 `schemas.test.ts` × 2
- 기존 `narrative-server.test.ts` × 2 — extractJsonObject 만 검증 (변경 없음)
- `tests/setup.ts` 가드 유지 — TEST_DATABASE_URL 환경변수로만 통합 테스트 실행

### 의존성 방향 확인

모든 신규/수정 파일이 FSD 의존성 규칙 (`features → shared`, `widgets → features`) 준수. shared/ui/saju-narrative 는 도메인 무관 stateless 컴포넌트로, 3 features (lifetime/yearly/monthly) 가 모두 import.

---

## Phase 1: DB Schema + Migration

### Task 1.1: YearlyNarrativeSections + MonthlyNarrativeSections 타입 확장

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts:590-612`

- [ ] **Step 1: YearlyNarrativeSections + MonthlyNarrativeSections 를 다음으로 교체**

```typescript
/** yearly 전용 — v0.3.1 에서 keyTerms + cautions 추가 */
export interface YearlyNarrativeSections {
  personality: string;
  career: string;
  relationship: string;
  health: string;
  daeunSummary: string;
  keyTerms: NarrativeKeyTerm[];   // v0.3.1 추가
  cautions: string[];             // v0.3.1 추가
}

/** v0.3.1 monthly — keyTerms + cautions 추가 */
export interface MonthlyNarrativeSections {
  personality: string;
  career: string;
  relationship: string;
  health: string;
  daeunSummary: string;
  keyTerms: NarrativeKeyTerm[];   // v0.3.1 추가
  cautions: string[];             // v0.3.1 추가
}
```

- [ ] **Step 2: typecheck 통과 확인** (`cd apps/dashboard && pnpm typecheck`)
- [ ] **Step 3: lint 통과 확인** (`cd apps/dashboard && pnpm lint`)

### Task 1.2: sajuYearlyNarrative 테이블에 promptVersion + schoolSpecificJsonb 컬럼 추가

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts:723-759`

- [ ] **Step 1: sajuYearlyNarrative 정의에 다음 추가**

```typescript
// 컬럼 추가 (narrativeText 위에)
promptVersion: integer("prompt_version").notNull().default(1),

// 컬럼 추가 (citations 위에)
schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),

// uniqueIndex 갱신 — promptVersion 포함
uniqueIndex("saju_yearly_narrative_cache_key").on(
  t.profileId,
  t.school,
  t.targetYear,
  t.frameHash,
  t.modelId,
  t.promptVersion,    // 신규
  t.algorithmVersion,
),
```

- [ ] **Step 2: typecheck + lint 통과 확인**

### Task 1.3: sajuMonthlyNarrative 테이블에 동일 컬럼·인덱스 추가

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts:813-855`

- [ ] **Step 1: sajuMonthlyNarrative 에 promptVersion + schoolSpecificJsonb 추가 + uniqueIndex 갱신** (Task 1.2 패턴 동일)
- [ ] **Step 2: typecheck + lint 통과 확인**

### Task 1.4: drizzle migration 0017 생성

- [ ] **Step 1: 마이그레이션 생성**

```bash
cd apps/dashboard && pnpm db:generate
```

- [ ] **Step 2: 생성된 SQL 확인** — `drizzle/0017_<random>_*.sql` 에 다음이 모두 있어야:
  - `ALTER TABLE saju_yearly_narrative ADD COLUMN prompt_version integer DEFAULT 1 NOT NULL;`
  - `ALTER TABLE saju_yearly_narrative ADD COLUMN school_specific_jsonb jsonb;`
  - `DROP INDEX saju_yearly_narrative_cache_key;`
  - `CREATE UNIQUE INDEX saju_yearly_narrative_cache_key ON saju_yearly_narrative ...` (promptVersion 포함)
  - monthly 동일 4 항목
- [ ] **Step 3: drizzle 메타 (`drizzle/meta/0017_snapshot.json` + `_journal.json`) 도 같이 커밋되는지 확인**

### Task 1.5: Phase 1 verification (Phase 1 종료 게이트)

- [ ] `cd apps/dashboard && pnpm typecheck` PASS
- [ ] `cd apps/dashboard && pnpm lint` PASS
- [ ] `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test` (실패 13개는 ECONNREFUSED 만 허용 — DB 미연결 통합 테스트 외 fail 0)
- [ ] commit: `feat(saju-tri): v0.3.1 Phase 1 — schema + migration 0017`

---

## Phase 2: Yearly prompts.ts + schemas.ts

### Task 2.1: features/saju-yearly-tri/api/prompts.ts 신설

**Files:**
- Create: `apps/dashboard/src/features/saju-yearly-tri/api/prompts.ts`

- [ ] **Step 1: spec §4.1 의 prompts.ts 본문을 그대로 작성** (`PROMPT_VERSION = 2`, COMMON_HEADER, KO_BODY, ZIPING_BODY, MANGPAI_BODY, JP_BODY, SCHOOL_PROMPTS).

  주의: spec 의 `...` 자리 (KO_BODY 본문 일부) 를 lifetime/api/prompts.ts:25-40 의 KO_BODY 첫 단락에서 "yearly 관점" 으로 변환해 채움. (lifetime 의 "평생 명조" → yearly 의 "올해 세운".) 4 학파 모두 동일 변환.

- [ ] **Step 2: typecheck + lint 통과 확인**

### Task 2.2: features/saju-yearly-tri/api/schemas.ts 신설

**Files:**
- Create: `apps/dashboard/src/features/saju-yearly-tri/api/schemas.ts`

- [ ] **Step 1: lifetime/api/schemas.ts 의 SCHOOL_SCHEMAS 패턴 미러링.** 차이점:
  - sections 는 `YearlyNarrativeSections` 사용 (lifetime 의 `LifetimeNarrativeSections` 와 동일 구조)
  - schoolSpecific 는 lifetime 과 동일 union 재사용

```typescript
import { z } from "zod";
import type { NarrativeSchool } from "./prompts";

const keyTermSchema = z.object({
  term: z.string(),
  gloss: z.string(),
});

const baseSectionsSchema = z.object({
  personality: z.string(),
  career: z.string(),
  relationship: z.string(),
  health: z.string(),
  daeunSummary: z.string(),
  keyTerms: z.array(keyTermSchema),
  cautions: z.array(z.string()),
});

const koSchema = z.object({
  narrativeText: z.string(),
  sections: baseSectionsSchema,
  schoolSpecific: z.object({
    joohuFocus: z.string(),
    shinsalNotes: z.array(z.string()),
  }),
  citations: z.array(z.string()),
});

const zipingSchema = z.object({
  narrativeText: z.string(),
  sections: baseSectionsSchema,
  schoolSpecific: z.object({
    gyeokgukRationale: z.string(),
    yongshinAnalysis: z.string(),
  }),
  citations: z.array(z.string()),
});

const mangpaiSchema = z.object({
  narrativeText: z.string(),
  sections: baseSectionsSchema,
  schoolSpecific: z.object({
    eventTimings: z.array(z.object({ period: z.string(), event: z.string() })),
  }),
  citations: z.array(z.string()),
});

const jpSchema = z.object({
  narrativeText: z.string(),
  sections: baseSectionsSchema,
  schoolSpecific: z.object({
    palaceMap: z.array(z.object({ palace: z.string(), note: z.string() })),
  }),
  citations: z.array(z.string()),
});

export const SCHOOL_SCHEMAS: Record<NarrativeSchool, z.ZodType> = {
  ko: koSchema,
  "cn-ziping": zipingSchema,
  "cn-mangpai": mangpaiSchema,
  jp: jpSchema,
};

export type NarrativeOutput =
  | z.infer<typeof koSchema>
  | z.infer<typeof zipingSchema>
  | z.infer<typeof mangpaiSchema>
  | z.infer<typeof jpSchema>;
```

- [ ] **Step 2: typecheck + lint 통과 확인**

### Task 2.3: features/saju-yearly-tri/api/schemas.test.ts 신설

**Files:**
- Create: `apps/dashboard/src/features/saju-yearly-tri/api/schemas.test.ts`

- [ ] **Step 1: lifetime/api/schemas.test.ts 패턴 미러링.** 4학파 × (valid / invalid) 각 1건씩 = 8 케이스 최소.
- [ ] **Step 2: test PASS** (`cd apps/dashboard && pnpm test -- saju-yearly-tri/api/schemas`)

### Task 2.4: Phase 2 verification

- [ ] typecheck + lint PASS
- [ ] schemas.test.ts PASS
- [ ] commit: `feat(saju-tri): v0.3.1 Phase 2 — yearly prompts + schemas`

---

## Phase 3: Yearly narrative-server.ts 교체

### Task 3.1: narrative-server.ts 의 imports + 상수 갱신

**Files:**
- Modify: `apps/dashboard/src/features/saju-yearly-tri/api/narrative-server.ts:14-33`

- [ ] **Step 1: imports + 상수 교체**

```typescript
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ALGORITHM_VERSION, type YearlyFrame } from "@gons/saju";
import { env } from "@/shared/config/env";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuYearlyNarrative,
  type YearlyNarrativeSections,
  type SchoolSpecific,
} from "@/shared/lib/db/schema";
import {
  PROMPT_VERSION,
  SCHOOL_PROMPTS,
  type NarrativeSchool,
} from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";

const MODEL_ID = env.SAJU_LLM_MODEL;
const MAX_NARRATIVE_TOKENS = 6144; // 4096 → 6144 (v0.3.1 1200~1600자)

export type { NarrativeSchool } from "./prompts";
```

- [ ] **Step 2: inline SCHOOL_PROMPT, NarrativeSchool 타입, narrativeOutputSchema 정의 삭제**

### Task 3.2: getOrBuildYearlyNarrative 함수 시그니처/캐시 키/반환 타입 갱신

- [ ] **Step 1: YearlyNarrativeResult 인터페이스 갱신**

```typescript
export interface YearlyNarrativeResult {
  school: NarrativeSchool;
  targetYear: number;
  narrativeText: string;
  sections: YearlyNarrativeSections;
  schoolSpecific: SchoolSpecific;   // 신규
  citations: string[];
  modelId: string;
  promptVersion: number;            // 신규
  algorithmVersion: number;
  generatedAt: string;
  fromCache: boolean;
}
```

- [ ] **Step 2: 캐시 조회 부분에 promptVersion 필터 추가**

```typescript
const cached = await db.query.sajuYearlyNarrative.findFirst({
  where: and(
    eq(sajuYearlyNarrative.profileId, profileId),
    eq(sajuYearlyNarrative.school, school),
    eq(sajuYearlyNarrative.targetYear, targetYear),
    eq(sajuYearlyNarrative.frameHash, frameHash),
    eq(sajuYearlyNarrative.modelId, MODEL_ID),
    eq(sajuYearlyNarrative.promptVersion, PROMPT_VERSION),   // 신규
    eq(sajuYearlyNarrative.algorithmVersion, ALGORITHM_VERSION),
  ),
});

if (cached) {
  if (!cached.schoolSpecificJsonb) {
    // 이론상 도달 불가 (PROMPT_VERSION=2 필터로 v1 row 제외).
    console.warn(
      "[saju/yearly-narrative] v2 row with null schoolSpecific — falling through to regen",
      { profileId, school, targetYear, promptVersion: cached.promptVersion },
    );
  } else {
    return {
      school,
      targetYear,
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
```

- [ ] **Step 3: LLM 호출 부분 갱신**

```typescript
const systemPrompt = SCHOOL_PROMPTS[school];

const userContent = `${targetYear}년 세운 분석:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 세운을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"1200~1600자 4~5문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별...},"citations":["출처1","출처2"]}`;

const response = await anthropic.messages.create({
  model: MODEL_ID,
  max_tokens: MAX_NARRATIVE_TOKENS,
  system: systemPrompt,
  messages: [{ role: "user", content: userContent }],
});

const firstBlock = response.content[0];
const text =
  firstBlock && firstBlock.type === "text" ? firstBlock.text : "";

const json = JSON.parse(extractJsonObject(text));
const parsed = SCHOOL_SCHEMAS[school].parse(json) as NarrativeOutput;
```

- [ ] **Step 4: 캐시 저장을 onConflictDoUpdate 로 변경**

```typescript
await db
  .insert(sajuYearlyNarrative)
  .values({
    profileId,
    school,
    targetYear,
    frameHash,
    modelId: MODEL_ID,
    promptVersion: PROMPT_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    narrativeText: parsed.narrativeText,
    sectionsJsonb: parsed.sections,
    schoolSpecificJsonb: parsed.schoolSpecific,
    citations: parsed.citations,
  })
  .onConflictDoUpdate({
    target: [
      sajuYearlyNarrative.profileId,
      sajuYearlyNarrative.school,
      sajuYearlyNarrative.targetYear,
      sajuYearlyNarrative.frameHash,
      sajuYearlyNarrative.modelId,
      sajuYearlyNarrative.promptVersion,
      sajuYearlyNarrative.algorithmVersion,
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
  targetYear,
  narrativeText: parsed.narrativeText,
  sections: parsed.sections,
  schoolSpecific: parsed.schoolSpecific,
  citations: parsed.citations,
  modelId: MODEL_ID,
  promptVersion: PROMPT_VERSION,
  algorithmVersion: ALGORITHM_VERSION,
  generatedAt: new Date().toISOString(),
  fromCache: false,
};
```

### Task 3.3: API route 갱신

**Files:**
- Modify: `apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts` (정확한 파일은 Phase 시작 시 확인)

- [ ] **Step 1: route 응답에 `promptVersion` + `schoolSpecific` 포함** (`getOrBuildYearlyNarrative` 반환을 그대로 직렬화하면 자연 추가)
- [ ] **Step 2: typecheck + lint PASS**

### Task 3.4: Phase 3 verification

- [ ] typecheck + lint PASS
- [ ] vitest yearly 관련 테스트 PASS (`cd apps/dashboard && pnpm test -- saju-yearly-tri`)
- [ ] commit: `feat(saju-tri): v0.3.1 Phase 3 — yearly narrative-server richer`

---

## Phase 4: Monthly prompts.ts + schemas.ts + narrative-server.ts

Phase 2 + Phase 3 패턴을 monthly 에 그대로 반복. 차이점:
- `prompts.ts` COMMON_HEADER 의 분량 800~1200자, 각 section 150~200자
- BODY 의 시제 "올해" → "이번 달", 분기 표현 "Q3" → "이번 달 중순"
- `narrative-server.ts` MAX_NARRATIVE_TOKENS = 4096
- 캐시 키에 targetMonth 추가 위치는 기존 그대로 유지하고 promptVersion 만 추가

### Task 4.1~4.4: yearly Phase 2~3 와 동일 task 시퀀스 반복

- [ ] **Task 4.1**: monthly/api/prompts.ts 신설
- [ ] **Task 4.2**: monthly/api/schemas.ts 신설
- [ ] **Task 4.3**: monthly/api/schemas.test.ts 신설
- [ ] **Task 4.4**: monthly/api/narrative-server.ts 교체
- [ ] **Task 4.5**: API route 응답 확장 (`app/api/saju/monthly/[profileId]/narrative/route.ts`)
- [ ] **Task 4.6**: Phase 4 verification (typecheck + lint + test PASS), commit `feat(saju-tri): v0.3.1 Phase 4 — monthly narrative-server richer`

---

## Phase 5: shared UI 컴포넌트 승격

### Task 5.1: features/saju-lifetime-tri/ui/ 의 8 컴포넌트를 shared/ui/saju-narrative/ 로 이동

**Files:**
- Move: `features/saju-lifetime-tri/ui/KeyTermsStrip.tsx` → `shared/ui/saju-narrative/KeyTermsStrip.tsx`
- Move: `features/saju-lifetime-tri/ui/NarrativeSection.tsx` → `shared/ui/saju-narrative/NarrativeSection.tsx`
- Move: `features/saju-lifetime-tri/ui/CitationsFootnote.tsx` → `shared/ui/saju-narrative/CitationsFootnote.tsx`
- Move: `features/saju-lifetime-tri/ui/school-specific/*.tsx` (5개) → `shared/ui/saju-narrative/school-specific/*.tsx`
- Create: `shared/ui/saju-narrative/index.ts` (barrel)

- [ ] **Step 1: git mv 로 이동 (히스토리 보존)**

```bash
mkdir -p apps/dashboard/src/shared/ui/saju-narrative/school-specific
git mv apps/dashboard/src/features/saju-lifetime-tri/ui/KeyTermsStrip.tsx \
       apps/dashboard/src/shared/ui/saju-narrative/KeyTermsStrip.tsx
# ... 7개 더
```

- [ ] **Step 2: 이동된 컴포넌트의 props 가 도메인 무관한지 확인**
  - sections.cautions / sections.keyTerms / schoolSpecific 만 받고 LifetimeFrame 타입 직접 import 안 함
  - 만약 LifetimeNarrativeSections 직접 import 가 있으면 generic interface (`{ heading: string; body: string }`) 로 좁힘

- [ ] **Step 3: shared/ui/saju-narrative/index.ts 작성**

```typescript
export { KeyTermsStrip } from "./KeyTermsStrip";
export { NarrativeSection } from "./NarrativeSection";
export { CitationsFootnote } from "./CitationsFootnote";
export { SchoolSpecificCard } from "./school-specific/SchoolSpecificCard";
```

### Task 5.2: lifetime UI 의 import 경로 갱신

**Files:**
- Modify: `features/saju-lifetime-tri/ui/LifetimeFrameView.tsx` + 그 외 import 사용처

- [ ] **Step 1: `from "./KeyTermsStrip"` 등을 `from "@/shared/ui/saju-narrative"` 로 일괄 교체**
- [ ] **Step 2: `features/saju-lifetime-tri/index.ts` 에서 옛 컴포넌트 re-export 제거**
- [ ] **Step 3: typecheck + lint PASS**

### Task 5.3: Phase 5 verification

- [ ] typecheck + lint PASS
- [ ] vitest 기존 lifetime 테스트 PASS (회귀 없음)
- [ ] commit: `refactor(saju-tri): v0.3.1 Phase 5 — narrative UI 를 shared/ui 로 승격`

---

## Phase 6: yearly + monthly UI 갱신

### Task 6.1: yearly UI 컴포넌트가 신규 sections + schoolSpecific 사용하도록 갱신

**Files:**
- Modify: `features/saju-yearly-tri/ui/*.tsx` (정확한 파일은 Phase 시작 시 식별 — `apps/dashboard/src/features/saju-yearly-tri/ui/` 디렉토리 ls 로 확인)

- [ ] **Step 1: narrative state/props 에 keyTerms/cautions/schoolSpecific 추가**
- [ ] **Step 2: shared/ui/saju-narrative 의 KeyTermsStrip / NarrativeSection / CitationsFootnote / SchoolSpecificCard 조립으로 렌더링**
- [ ] **Step 3: typecheck + lint PASS**

### Task 6.2: monthly UI 컴포넌트 갱신 — yearly 와 동일 패턴

- [ ] **Step 1~3 동일**

### Task 6.3: Phase 6 verification

- [ ] typecheck + lint PASS
- [ ] vitest 전체 PASS (yearly/monthly 회귀 없음)
- [ ] commit: `feat(saju-tri): v0.3.1 Phase 6 — yearly/monthly UI 갱신`

---

## Phase 7: PR + 운영 배포 + 검증

### Task 7.1: PR 생성

- [ ] **Step 1**: 전체 변경사항을 검토 (`git diff main...HEAD`)
- [ ] **Step 2**: 본 plan 패턴 (체크포인트 docker-deploy-verify 4단계) 의 PR 메시지 형식 사용
- [ ] **Step 3**: spec 링크 + Phase 별 commit 목록 + 운영 영향 (캐시 무효화) 명시

### Task 7.2: GHA build & push 대기

- [ ] `gh run watch` 로 GHA 통과 확인 (lint+typecheck+build)
- [ ] Docker 이미지 푸시 성공 (`ghcr.io/krdn/gons-dashboard:latest`)

### Task 7.3: 운영 DB migration 적용 (사용자 ack 필요)

- [ ] **Step 1: 사용자에게 운영 DB 가드 ack 확인 요청**
- [ ] **Step 2**: `I_KNOW_THIS_IS_PROD=1 pnpm --filter @gons/dashboard db:migrate` 실행
- [ ] **Step 3**: 운영 DB 에 0017 적용 확인 (drizzle 메타 row 추가)

### Task 7.4: 컨테이너 교체 + 헬스체크

- [ ] `docker --context home-server compose -f $COMPOSE pull app`
- [ ] `docker --context home-server compose -f $COMPOSE up -d app`
- [ ] `ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"` → `{"status":"ok"}`

### Task 7.5: 사용자 브라우저 검증

- [ ] **Step 1: 사용자에게 김석곤 lifetime + yearly cn-ziping/mangpai/jp + monthly 페이지 방문 요청**
- [ ] **Step 2: 운영 DB 분량 SQL (spec §8.3) 실행 → v2 row 1200~1600자 확인**
- [ ] **Step 3: 분량이 목표 미달 시 prompts.ts 의 BODY 부분만 추가 강화 → 재배포 → 재검증 루프**

### Task 7.6: v0.3.1 완료 선언

- [ ] docs/superpowers/specs/2026-05-19-saju-tri-narrative-richer-v031-design.md 헤더에 `STATUS: SHIPPED 2026-05-XX` 추가
- [ ] CLAUDE.md 의 v0.3 기록 옆에 v0.3.1 결과 한 줄 추가 (분량 회귀 해소 명시)
- [ ] commit: `docs(saju-tri): v0.3.1 종료 선언 — yearly/monthly narrative richer 운영 배포 완료`

---

## Phase 별 검증 게이트 요약

| Phase | typecheck | lint | vitest | 운영 검증 | commit |
|-------|-----------|------|--------|-----------|--------|
| 1 (schema) | ✓ | ✓ | ✓ (회귀 없음) | — | Phase 1 |
| 2 (yearly prompts/schemas) | ✓ | ✓ | ✓ (신규 test PASS) | — | Phase 2 |
| 3 (yearly narrative-server) | ✓ | ✓ | ✓ | — | Phase 3 |
| 4 (monthly 전체) | ✓ | ✓ | ✓ | — | Phase 4 |
| 5 (shared UI) | ✓ | ✓ | ✓ (lifetime 회귀 없음) | — | Phase 5 |
| 6 (yearly/monthly UI) | ✓ | ✓ | ✓ | — | Phase 6 |
| 7 (PR + 배포) | — | — | — | 분량 SQL + 헬스체크 | Phase 7 |

---

## 위험·회피

| 위험 | 회피 |
|------|------|
| shared/ui 승격 시 lifetime 회귀 | Phase 5 마지막에 lifetime 페이지 직접 방문 (운영 배포 전 dev 에서 확인) + vitest 회귀 |
| LLM 응답이 zod schema 위반 | extractJsonObject 그대로 + zod 실패는 route 500 처리 (lifetime 과 동일) |
| 운영 DB cache miss 폭주로 LLM 비용 | 4학파 × 5년 × $0.5 ≈ $10 / profile — 운영 사용자 적으니 무시 가능 |
| onConflictDoUpdate 가 다른 row 의 generatedAt 갱신 | target 컬럼 (uniqueIndex 6 필드) 일치 시에만 update — 의도 동작 |
| TEST_DATABASE_URL 미설정 시 통합 테스트 fail | 가드 그대로 — DB 미연결 통합 13개 ECONNREFUSED 는 허용, 순수 unit + schemas.test 만 PASS 필수 |
| Phase 4 monthly 의 narrative-server 가 yearly 와 file shape 다를 가능성 | Phase 4 시작 시 `apps/dashboard/src/app/api/saju/monthly/[profileId]/narrative/route.ts` 의 응답 직렬화 확인 |

---

## 사용자 ack 가 필요한 순간

1. **Phase 7.3 운영 DB migration** — `I_KNOW_THIS_IS_PROD=1` 가드 통과 필요. 사용자에게 명시적 승인 요청.
2. **Phase 7.5 브라우저 검증** — 사용자 직접 방문 필요 (자동화 불가). 어떤 페이지를 어떤 순서로 방문해야 하는지 명확히 안내.

그 외 모든 Phase 는 advisor 답변으로 자율 진행 가능.
