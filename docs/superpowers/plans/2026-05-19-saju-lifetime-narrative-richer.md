# Saju Lifetime Narrative v0.2 — Richer Edition 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4학파 평생 운세 narrative 를 1500~2000자 / 인라인 용어 풀이 / 섹션별 3층 실전성 / 학파 차별화로 확장.

**Architecture:** B 안 채택 — 출력 스키마를 학파별로 다르게 확장 (`schoolSpecific` 필드) + 학파별 system prompt 30~50줄로 강화. PROMPT_VERSION 키를 캐시 키에 추가해 기존 v1 캐시를 그대로 두고 v2 를 자동 적재. UI 는 신규 RSC 컴포넌트 6개 (KeyTermsStrip / NarrativeSection / CitationsFootnote / SchoolSpecificCard + 학파별 4종) 로 lifetime 카드 본문을 재조립.

**Tech Stack:** Next.js 16 (App Router, RSC) · Drizzle ORM · PostgreSQL · Zod · Anthropic SDK (claude-opus-4-7, cli-proxy 경유) · Vitest · Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-05-19-saju-lifetime-narrative-richer-design.md`

---

## File Structure

### 신규 (Create)
- `apps/dashboard/src/features/saju-lifetime-tri/api/prompts.ts` — PROMPT_VERSION 상수 + 공통 헤더 + 학파별 system prompt 4종
- `apps/dashboard/src/features/saju-lifetime-tri/api/schemas.ts` — Zod 스키마 (공통 + 학파별 discriminated) + TypeScript 타입 export
- `apps/dashboard/src/features/saju-lifetime-tri/api/schemas.test.ts` — 학파별 스키마 검증 단위 테스트
- `apps/dashboard/src/features/saju-lifetime-tri/ui/KeyTermsStrip.tsx` — 핵심 용어 칩 (client, hover tooltip)
- `apps/dashboard/src/features/saju-lifetime-tri/ui/NarrativeSection.tsx` — 단일 섹션 (h4 + body, RSC 호환)
- `apps/dashboard/src/features/saju-lifetime-tri/ui/CitationsFootnote.tsx` — 출처 인용 (RSC 호환)
- `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/SchoolSpecificCard.tsx` — 학파별 분기 dispatcher
- `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/KoSchoolDetail.tsx`
- `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/ZipingSchoolDetail.tsx`
- `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/MangpaiSchoolDetail.tsx`
- `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/JpSchoolDetail.tsx`
- `apps/dashboard/drizzle/0013_<random>_richer_narrative.sql` — pnpm db:generate 산출물

### 수정 (Modify)
- `apps/dashboard/src/shared/lib/db/schema.ts:560-607` — `NarrativeSections` 에 keyTerms/cautions 추가, `sajuLifetimeNarrative` 테이블에 `promptVersion`/`schoolSpecificJsonb` 컬럼, unique index 갱신
- `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts` — system prompt 교체, max_tokens 8192, 학파별 schema 검증, 캐시 키에 promptVersion 포함, 반환값 확장
- `apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameView.tsx:16-23, 59-60` — props 확장 (sections / schoolSpecific / citations / keyTerms), narrative 단순 prose 렌더링을 신규 컴포넌트 조립으로 교체
- `apps/dashboard/src/features/saju-lifetime-tri/ui/TriNationTabs.tsx:44-65` — `NarrativeState` 에 sections/schoolSpecific/citations/keyTerms 필드 추가, fetch 응답 파싱 갱신
- `apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx:30-32, 95-96` — fetch 응답 전체를 state 로 저장 (현재는 narrativeText 만)

### Test
- `apps/dashboard/src/features/saju-lifetime-tri/api/schemas.test.ts` (신규)
- `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.test.ts` (기존, 변경 없음 — extractJsonObject 만 테스트, 신규 schema 검증은 schemas.test.ts 로 분리)

### 의존성 방향 확인
모든 신규/수정 파일이 FSD 의존성 규칙 (`features → shared`) 을 지킴. UI 컴포넌트는 `@gons/saju` 의 LifetimeFrame 타입을 import 하지 않고 모두 narrative 응답 타입 (`schemas.ts` 정의) 에만 의존.

---

## Phase 1: DB Schema + Migration

### Task 1.1: NarrativeSections 타입 확장 + sajuLifetimeNarrative 테이블 컬럼 추가

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts:560-607`

- [ ] **Step 1: schema.ts 의 NarrativeSections + sajuLifetimeNarrative 영역을 다음으로 교체**

```typescript
// schema.ts:567-573 (NarrativeSections) 를 아래로 교체
export interface NarrativeKeyTerm {
  term: string;
  gloss: string;
}

export interface NarrativeSections {
  personality: string;
  career: string;
  relationship: string;
  health: string;
  daeunSummary: string;
  keyTerms: NarrativeKeyTerm[];
  cautions: string[];
}

// 학파별 schoolSpecific 의 union. v0.2 도입.
// (서버에서 zod 검증을 통과한 값만 컬럼에 저장하므로 UI 는 학파에 따라 narrowing 가능)
export type SchoolSpecificKo = {
  joohuFocus: string;
  shinsalNotes: string[];
};
export type SchoolSpecificZiping = {
  gyeokgukRationale: string;
  yongshinAnalysis: string;
};
export type SchoolSpecificMangpai = {
  eventTimings: Array<{ period: string; event: string }>;
};
export type SchoolSpecificJp = {
  palaceMap: Array<{ palace: string; note: string }>;
};
export type SchoolSpecific =
  | SchoolSpecificKo
  | SchoolSpecificZiping
  | SchoolSpecificMangpai
  | SchoolSpecificJp;
```

```typescript
// schema.ts:575-607 (sajuLifetimeNarrative) 를 아래로 교체
export const sajuLifetimeNarrative = pgTable(
  "saju_lifetime_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    frameHash: text("frame_hash").notNull(),
    modelId: text("model_id").notNull(),
    // v0.2 — 프롬프트 스키마 버전. PROMPT_VERSION bump 시 자동으로 캐시 무효화.
    // 기존 row 는 default 1 로 채워지고, 신규 코드는 PROMPT_VERSION=2 로 적재.
    promptVersion: integer("prompt_version").notNull().default(1),
    narrativeText: text("narrative_text").notNull(),
    sectionsJsonb: jsonb("sections_jsonb").$type<NarrativeSections>().notNull(),
    // v0.2 — 학파별로 다른 구조. v1 row 는 null.
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
    index("saju_lifetime_narrative_profile_idx").on(t.profileId),
    uniqueIndex("saju_lifetime_narrative_cache_key").on(
      t.profileId,
      t.school,
      t.frameHash,
      t.modelId,
      t.promptVersion,
    ),
  ],
);
```

- [ ] **Step 2: `integer` import 가 이미 있는지 확인**

Run: `head -20 apps/dashboard/src/shared/lib/db/schema.ts`
Expected: `import { ... integer ... } from "drizzle-orm/pg-core"` 가 있어야 함. 없으면 추가.

- [ ] **Step 3: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 에러.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts
git commit -m "feat(saju-tri): NarrativeSections 확장 + sajuLifetimeNarrative v0.2 컬럼

- keyTerms / cautions 를 NarrativeSections 에 추가
- promptVersion 컬럼 (default 1) 으로 v1/v2 캐시 공존
- schoolSpecificJsonb 컬럼 (nullable, v1 row 는 null)
- unique index 에 promptVersion 포함

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Drizzle 마이그레이션 생성 + 검토

**Files:**
- Create: `apps/dashboard/drizzle/0013_<random>_*.sql`
- Create: `apps/dashboard/drizzle/meta/0013_snapshot.json` (자동 생성)

- [ ] **Step 1: 마이그레이션 생성**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: `drizzle/0013_<random_name>.sql` 파일이 생성됨.

- [ ] **Step 2: 생성된 SQL 검토**

Run: `cat apps/dashboard/drizzle/0013_*.sql`
Expected 핵심 변경 (drizzle 자동 생성, 형태는 약간 다를 수 있음):

```sql
ALTER TABLE "saju_lifetime_narrative"
  ADD COLUMN "prompt_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "saju_lifetime_narrative"
  ADD COLUMN "school_specific_jsonb" jsonb;

DROP INDEX IF EXISTS "saju_lifetime_narrative_cache_key";
CREATE UNIQUE INDEX "saju_lifetime_narrative_cache_key"
  ON "saju_lifetime_narrative"
  USING btree ("profile_id","school","frame_hash","model_id","prompt_version");
```

**컬럼 추가가 unique index 재생성보다 먼저 와야 함**. 순서가 뒤바뀌어 있으면 수동 편집.

- [ ] **Step 3: 로컬 테스트 DB 에 적용**

테스트 DB 가 없으면:
```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine
```

마이그레이션 적용:
```bash
DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard db:migrate
```

Expected: 모든 0001~0013 마이그레이션 적용. 에러 없음.

- [ ] **Step 4: 새 컬럼 존재 확인**

```bash
docker exec gons-test-db psql -U test -d test_dummy -c \
  "\d saju_lifetime_narrative" 2>&1 | grep -E "prompt_version|school_specific"
```
Expected: 두 컬럼이 모두 출력.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/drizzle/0013_*.sql apps/dashboard/drizzle/meta/0013_snapshot.json apps/dashboard/drizzle/meta/_journal.json
git commit -m "feat(saju-tri): v0.2 narrative migration — promptVersion + schoolSpecific

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: 학파별 Prompts + Zod Schemas

### Task 2.1: prompts.ts 작성

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/api/prompts.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// 학파별 system prompt 와 PROMPT_VERSION 상수.
//
// PROMPT_VERSION 정책:
// - 캐시 키 (profile_id, school, frame_hash, model_id, prompt_version) 의 일부.
// - 프롬프트 또는 출력 스키마 변경 시 bump → 자동 캐시 무효화.
// - 기존 row 는 그대로 두고 신규 row 가 새 버전으로 적재 (감사용 보존).
export const PROMPT_VERSION = 2;

export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

const COMMON_HEADER = `당신은 30년 경력의 사주 명리학 전문가입니다. 비전문가 사용자에게 자신의 명조를 깊이 이해시키는 것이 목표입니다.

[작성 원칙]
1. 분량: narrativeText 전체 1500~2000자 (5문단). 각 sections 필드는 200~350자.
2. 용어 풀이: 한자 용어·명리 전문어가 처음 등장할 때 인라인 괄호로 풀어 설명. 예: 傷官格(상관격 — 자신의 재능을 밖으로 표출하려는 기질), 怪罡(괴강 — 강한 자존심과 결단력을 가진 살). 두 번째 등장부터는 풀이 생략.
3. 섹션별 3층 구조:
   - personality: 경향성·기질 (일반론, "당신은 ~한 사람입니다")
   - career: 직업 장면 구체 행동 ("회의에서 ~할 때 ~하세요")
   - relationship: 관계 장면 구체 행동
   - health: 건강 관리 구체 행동·계절성·식단
   - daeunSummary: 대운 흐름의 시간대별 타이밍
4. 행동 지침은 "그래서 어떻게" 의 수준까지. 추상적 조언("균형 잡으세요") 금지. 상황·시간·대상을 명시.
5. citations: 인용한 고전/전적의 편명까지 명시. 최소 2개.`;

const KO_BODY = `[학파 고유 관점 — 한국식 자평+조후+신살]

한국식 사주의 특징:
- 자평진전의 격국론을 기본으로 하되, 조후(調候 — 명조의 기온·습도 조절)와 신살(神煞 — 특정 간지 조합이 만들어내는 길흉 표지)을 서구식 자평보다 비중 있게 활용.
- 박재완·박청화 계열의 임상 사주: 격국이 성립해도 조후가 무너지면 '격은 있으나 쓸 수 없는 명' 으로 본다.
- 신살은 단순 길흉 라벨이 아니라 성격·사건의 결을 묘사하는 도구.

[작성 시 강조점]
- 조후 분석을 본문에서 한 문단 이상 다룬다. "이 명조는 봄철에 태어나 木이 왕성하고 水도 강해 한기·습기가 짙다. 火土로 따뜻하게 보완해야 한다" 식으로 명조의 기후 상태를 계절·오행 언어로 설명.
- 등장 신살 (괴강·도화·역마·화개 등) 은 단순 나열 금지. 각 신살이 사용자의 일상에서 어떻게 드러나는지 1~2문장씩.
- schoolSpecific.joohuFocus 에 보완해야 할 오행과 그 근거를 70~120자.
- schoolSpecific.shinsalNotes 에 명조에 실제 등장한 신살별 해석을 각 1~2문장씩.

[금지]
- 자평진전 원전 인용 ("적천수 운운"). 그건 cn-ziping 의 영역.
- 응기 시점 단정 ("38세에 변동"). 그건 cn-mangpai 의 영역.`;

const ZIPING_BODY = `[학파 고유 관점 — 중국 자평진전·적천수]

자평진전 사주의 특징:
- 격국(格局 — 월지 기준의 명조 골격)과 용신(用神 — 명조의 균형을 맞추는 핵심 오행) 의 철학적 분석 중심.
- 적천수·자평진전 원전의 논리 구조 ("身強身弱, 從格 不從格") 를 따라가며 명조의 본질을 추론.
- 신살은 부차적, 응기 시점은 다루지 않음.

[작성 시 강조점]
- 격국이 성립하는 조건과 파괴되는 조건을 모두 설명. 단순히 "격국=X 입니다" 가 아니라 "월지 X 가 천간 Y 와 결합해 Z 격이 성립하지만, 동시에 W 가 격을 깨뜨릴 위험이 있다".
- 용신을 채택할 때는 후보 2개 이상을 비교한 뒤 채택 이유를 제시.
- 적천수·자평진전·삼명통회 등 원전 인용을 본문에 자연스럽게 녹임.
- schoolSpecific.gyeokgukRationale 에 격국 성립/파괴의 철학적 근거.
- schoolSpecific.yongshinAnalysis 에 용신 후보 비교와 채택 이유.

[금지]
- 신살을 메인으로 다루기. 그건 ko 의 영역.
- 응기 시점 단정. 그건 cn-mangpai 의 영역.`;

const MANGPAI_BODY = `[학파 고유 관점 — 중국 맹파 단건업]

맹파 사주의 특징:
- 응기(應期 — 사건이 일어나는 시점) 와 사건성(事件性) 중심. "언제 무엇이 일어나는가" 를 단정적으로 본다.
- 격국 철학·신살 해석은 깊게 다루지 않음. 대신 명조 내 글자 간 관계가 어떤 사건을 만들어내는지에 집중.
- 단건업(段建業) 계열 톤: 직설적이고 단정적. "할 가능성이 있다" 보다 "한다" 에 가까운 어조.

[작성 시 강조점]
- 대운·세운 구간을 구체적으로 명시 ("30~35세 戊辰 대운", "45세 庚午 년"). 추상적 "중년" 금지.
- 사건의 결을 단어로 표현 (재물 변동, 가족 변고, 이동·이사, 결혼·이혼, 직장 변경). 모호한 "변화" 금지.
- daeunSummary 는 시간대별 사건 예측에 집중.
- schoolSpecific.eventTimings 에 응기 시점 3~6개를 (period, event) 쌍으로 명시.

[금지]
- "~할 가능성이 높다" 류의 약화 표현 빈출 (맹파 톤 손상). 단정형 우선.
- 격국 철학 토론. 그건 cn-ziping 의 영역.`;

const JP_BODY = `[학파 고유 관점 — 일본 추명학]

일본 추명학의 특징:
- 12궁(命宮·財帛宮·兄弟宮·田宅宮·男女宮·奴僕宮·妻妾宮·疾厄宮·遷移宮·官祿宮·福德宮·父母宮) 단위로 인생 영역을 나누고 각 궁의 처세를 분석.
- 통변성(通變星 — 일간을 기준으로 다른 글자가 어떤 의미를 띠는지: 正官·偏財·食神 등) 을 비중 있게 다룸.
- 高木乘 계열 톤: 차분하고 실용적. 격국·신살보다 처세·관계 조언 중심.

[작성 시 강조점]
- 12궁 중 명조에 의미 있는 5~8개를 골라 각각의 처세 요지를 다룸.
- 통변성으로 일간 주변 글자의 의미를 해설 (예: "월간이 정관이라 사회적 책임감과 규율을 자연스럽게 받아들인다").
- 일본 추명학 특유의 용어 (12궁 명칭, 통변성) 는 첫 등장 시 한자 + 한글 풀이 + 의미 1줄.
- schoolSpecific.palaceMap 에 의미 있는 5~8개 궁을 (palace, note) 쌍으로 명시.

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

- [ ] **Step 2: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 에러.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/api/prompts.ts
git commit -m "feat(saju-tri): 학파별 prompt 모듈 신설 (PROMPT_VERSION=2)

- COMMON_HEADER + 4학파 본문 (각 30~50줄)
- ko/ziping/mangpai/jp 각 학파 강조점 + 금지 영역 명시

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: schemas.ts — 학파별 Zod 스키마 + 타입 export

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/api/schemas.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// 학파별 LLM 출력 zod 스키마.
//
// 공통 sections (5필드 + keyTerms + cautions) 위에 학파별 schoolSpecific 을 union.
// narrative-server.ts 가 school 에 따라 SCHOOL_SCHEMAS[school].parse() 호출.
import { z } from "zod";
import type { NarrativeSchool } from "./prompts";
import type {
  NarrativeSections,
  SchoolSpecific,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
} from "@/shared/lib/db/schema";

// 공통 sections 스키마. 분량 하한 (min) 은 LLM 일탈을 막는 안전판.
// max 는 두지 않음 — 분량 과다 시 cli-proxy 가 잘라낼 수 있고 그건 zod 가 아니라
// 운영 모니터링으로 봐야 함.
const sectionsSchema = z.object({
  personality: z.string().min(200),
  career: z.string().min(200),
  relationship: z.string().min(200),
  health: z.string().min(200),
  daeunSummary: z.string().min(200),
  keyTerms: z
    .array(
      z.object({
        term: z.string().min(1),
        gloss: z.string().min(1),
      }),
    )
    .min(3)
    .max(10),
  cautions: z.array(z.string().min(1)).max(5),
}) satisfies z.ZodType<NarrativeSections>;

const baseOutputSchema = z.object({
  narrativeText: z.string().min(1500).max(2500),
  sections: sectionsSchema,
  citations: z.array(z.string().min(1)).min(2),
});

const koSpecificSchema = z.object({
  joohuFocus: z.string().min(70),
  shinsalNotes: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<SchoolSpecificKo>;

const zipingSpecificSchema = z.object({
  gyeokgukRationale: z.string().min(100),
  yongshinAnalysis: z.string().min(100),
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
    .max(8),
}) satisfies z.ZodType<SchoolSpecificMangpai>;

const jpSpecificSchema = z.object({
  palaceMap: z
    .array(
      z.object({
        palace: z.string().min(1),
        note: z.string().min(1),
      }),
    )
    .min(5)
    .max(12),
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

// narrative-server.ts 가 사용할 union output 타입.
export type NarrativeOutput = {
  narrativeText: string;
  sections: NarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
};
```

- [ ] **Step 2: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 에러. (`satisfies` 가 동작하려면 zod 최신 버전 필요. 에러 나면 `as z.ZodType<NarrativeSections>` 캐스팅으로 대체)

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/api/schemas.ts
git commit -m "feat(saju-tri): 학파별 narrative zod 스키마 신설

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: schemas.test.ts — 학파별 스키마 회귀 테스트

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/api/schemas.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
import { describe, expect, it } from "vitest";
import { SCHOOL_SCHEMAS } from "./schemas";

const dummy200 = "가".repeat(200);
const dummy1500 = "나".repeat(1500);

function baseOk() {
  return {
    narrativeText: dummy1500,
    sections: {
      personality: dummy200,
      career: dummy200,
      relationship: dummy200,
      health: dummy200,
      daeunSummary: dummy200,
      keyTerms: [
        { term: "傷官格", gloss: "상관격 — ..." },
        { term: "怪罡", gloss: "괴강 — ..." },
        { term: "桃花", gloss: "도화 — ..." },
      ],
      cautions: ["과로 주의"],
    },
    citations: ["적천수·통신론", "삼명통회·신살편"],
  };
}

describe("SCHOOL_SCHEMAS — ko", () => {
  it("유효 ko 페이로드 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["괴강 — 강한 자존심"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).not.toThrow();
  });

  it("joohuFocus 70자 미만 → throw", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: { joohuFocus: "짧음", shinsalNotes: ["x"] },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  it("cn-ziping schoolSpecific 을 ko 로 검증 → throw (분기 보장)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        gyeokgukRationale: "라".repeat(100),
        yongshinAnalysis: "마".repeat(100),
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — cn-ziping", () => {
  it("유효 ziping 페이로드 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        gyeokgukRationale: "라".repeat(100),
        yongshinAnalysis: "마".repeat(100),
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-ziping"].parse(payload)).not.toThrow();
  });
});

describe("SCHOOL_SCHEMAS — cn-mangpai", () => {
  it("eventTimings 3건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: [
          { period: "30~35세 戊辰 대운", event: "재물 변동" },
          { period: "45세 庚午 년", event: "가족 변고" },
          { period: "50대 초반", event: "이동·이사" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).not.toThrow();
  });

  it("eventTimings 2건 → throw (min 3)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        eventTimings: [
          { period: "a", event: "b" },
          { period: "c", event: "d" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS["cn-mangpai"].parse(payload)).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — jp", () => {
  it("palaceMap 5건 통과", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "命宮(명궁)", note: "..." },
          { palace: "財帛宮(재백궁)", note: "..." },
          { palace: "兄弟宮(형제궁)", note: "..." },
          { palace: "田宅宮(전택궁)", note: "..." },
          { palace: "官祿宮(관록궁)", note: "..." },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).not.toThrow();
  });

  it("palaceMap 4건 → throw (min 5)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: {
        palaceMap: [
          { palace: "a", note: "1" },
          { palace: "b", note: "2" },
          { palace: "c", note: "3" },
          { palace: "d", note: "4" },
        ],
      },
    };
    expect(() => SCHOOL_SCHEMAS.jp.parse(payload)).toThrow();
  });
});

describe("SCHOOL_SCHEMAS — 공통 base 검증", () => {
  it("narrativeText 1500자 미만 → throw", () => {
    const payload = {
      ...baseOk(),
      narrativeText: "짧음",
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["x"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  it("citations 1개 → throw (min 2)", () => {
    const payload = {
      ...baseOk(),
      citations: ["단일 출처"],
      schoolSpecific: {
        joohuFocus: "다".repeat(70),
        shinsalNotes: ["x"],
      },
    };
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });

  it("keyTerms 2개 → throw (min 3)", () => {
    const payload = {
      ...baseOk(),
      schoolSpecific: { joohuFocus: "다".repeat(70), shinsalNotes: ["x"] },
    };
    payload.sections.keyTerms = [
      { term: "a", gloss: "1" },
      { term: "b", gloss: "2" },
    ];
    expect(() => SCHOOL_SCHEMAS.ko.parse(payload)).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test --run features/saju-lifetime-tri/api/schemas.test.ts`
Expected: 12개 케이스 모두 PASS.

설명: 스키마가 이미 작성된 상태에서의 회귀 방어용. TDD 의 엄격한 RED-GREEN 이 아니라 schemas.ts 변경 시 안전망 역할.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/api/schemas.test.ts
git commit -m "test(saju-tri): 학파별 narrative schema 단위 테스트 12 케이스

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: narrative-server.ts 갱신

### Task 3.1: narrative-server.ts 갱신

**Files:**
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts`

- [ ] **Step 1: import 추가**

파일 최상단 import 영역에 추가:
```typescript
import { PROMPT_VERSION, SCHOOL_PROMPTS } from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";
import type { SchoolSpecific } from "@/shared/lib/db/schema";
```

`z` import 가 더 이상 직접 사용되지 않으면 (narrativeOutputSchema 제거됨) 삭제.

- [ ] **Step 2: MAX_NARRATIVE_TOKENS 변경**

```typescript
const MAX_NARRATIVE_TOKENS = 8192; // 4096 → 8192 (v0.2 1500~2000자 분량)
```

- [ ] **Step 3: 기존 narrativeOutputSchema (line 70~80) 와 SCHOOL_PROMPT (line 82~87) 삭제**

기존 코드 삭제:
```typescript
const narrativeOutputSchema = z.object({...});
const SCHOOL_PROMPT: Record<NarrativeSchool, string> = {...};
```

`SCHOOL_PROMPTS` (prompts.ts) 와 `SCHOOL_SCHEMAS` (schemas.ts) 가 대체.

- [ ] **Step 4: NarrativeResult interface 확장**

기존:
```typescript
export interface NarrativeResult {
  school: NarrativeSchool;
  narrativeText: string;
  sections: NarrativeSections;
  citations: string[];
  modelId: string;
  generatedAt: string;
  fromCache: boolean;
}
```

교체:
```typescript
export interface NarrativeResult {
  school: NarrativeSchool;
  narrativeText: string;
  sections: NarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
  modelId: string;
  promptVersion: number;
  generatedAt: string;
  fromCache: boolean;
}
```

- [ ] **Step 5: getOrBuildNarrative 함수 — 캐시 조회 갱신**

기존 (line 113~132 부근) 교체:
```typescript
const cached = await db.query.sajuLifetimeNarrative.findFirst({
  where: and(
    eq(sajuLifetimeNarrative.profileId, profileId),
    eq(sajuLifetimeNarrative.school, school),
    eq(sajuLifetimeNarrative.frameHash, frameHash),
    eq(sajuLifetimeNarrative.modelId, MODEL_ID),
    eq(sajuLifetimeNarrative.promptVersion, PROMPT_VERSION),
  ),
});
if (cached) {
  if (!cached.schoolSpecificJsonb) {
    // 이론상 도달 불가 (PROMPT_VERSION=2 필터로 v1 row 제외).
    // 방어용 로그 + miss 처리 fall-through.
    console.warn(
      "[saju/narrative] v2 row with null schoolSpecific — falling through to regen",
      { profileId, school, promptVersion: cached.promptVersion },
    );
  } else {
    return {
      school,
      narrativeText: cached.narrativeText,
      sections: cached.sectionsJsonb,
      schoolSpecific: cached.schoolSpecificJsonb,
      citations: cached.citations,
      modelId: cached.modelId,
      promptVersion: cached.promptVersion,
      generatedAt: cached.generatedAt.toISOString(),
      fromCache: true,
    };
  }
}
```

- [ ] **Step 6: LLM 호출 부분 — systemPrompt 와 userContent 갱신**

기존 systemPrompt (1줄짜리) 와 userContent 갱신:
```typescript
const systemPrompt = SCHOOL_PROMPTS[school];

const userContent = `명조 분석:\n${JSON.stringify(frame, null, 2)}

위 명조를 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"1500~2000자 5문단","sections":{"personality":"...","career":"...","relationship":"...","health":"...","daeunSummary":"...","keyTerms":[{"term":"...","gloss":"..."}],"cautions":["..."]},"schoolSpecific":{...학파별...},"citations":["출처1","출처2"]}`;

const response = await anthropic.messages.create({
  model: MODEL_ID,
  max_tokens: MAX_NARRATIVE_TOKENS,
  system: systemPrompt,
  messages: [{ role: "user", content: userContent }],
});
```

- [ ] **Step 7: parse + 캐시 저장 갱신**

기존:
```typescript
const json = JSON.parse(extractJsonObject(text));
const parsed = narrativeOutputSchema.parse(json);
```

교체:
```typescript
const json = JSON.parse(extractJsonObject(text));
const parsed = SCHOOL_SCHEMAS[school].parse(json) as NarrativeOutput;
```

캐시 저장 부분 (line 174~187 부근):
```typescript
await db
  .insert(sajuLifetimeNarrative)
  .values({
    profileId,
    school,
    frameHash,
    modelId: MODEL_ID,
    promptVersion: PROMPT_VERSION,
    narrativeText: parsed.narrativeText,
    sectionsJsonb: parsed.sections,
    schoolSpecificJsonb: parsed.schoolSpecific,
    citations: parsed.citations,
  })
  .onConflictDoNothing();

return {
  school,
  narrativeText: parsed.narrativeText,
  sections: parsed.sections,
  schoolSpecific: parsed.schoolSpecific,
  citations: parsed.citations,
  modelId: MODEL_ID,
  promptVersion: PROMPT_VERSION,
  generatedAt: new Date().toISOString(),
  fromCache: false,
};
```

- [ ] **Step 8: 타입 체크 + 린트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 0 에러, 0 issue.

만약 typecheck 가 SchoolSpecific 캐스팅에서 에러:
- `cached.schoolSpecificJsonb` 는 Step 5 의 null 체크 분기로 narrow 됨
- `parsed.schoolSpecific` 가 정확히 좁혀지지 않으면 `as NarrativeOutput["schoolSpecific"]` 명시

- [ ] **Step 9: 기존 extractJsonObject 회귀 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test --run features/saju-lifetime-tri/api/narrative-server.test.ts`
Expected: 기존 11 케이스 모두 PASS.

- [ ] **Step 10: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts
git commit -m "feat(saju-tri): narrative-server v0.2 — PROMPT_VERSION + 학파별 schema

- SCHOOL_PROMPTS (prompts.ts) + SCHOOL_SCHEMAS (schemas.ts) import
- max_tokens 4096 → 8192
- 캐시 키에 promptVersion 추가
- 반환값에 schoolSpecific + promptVersion 포함

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: UI 본문 컴포넌트

### Task 4.1: KeyTermsStrip 컴포넌트

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/KeyTermsStrip.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
"use client";

// 본문 인라인 풀이의 보조 — 핵심 용어 칩 + hover tooltip.
import { useState } from "react";
import type { NarrativeKeyTerm } from "@/shared/lib/db/schema";

interface Props {
  keyTerms: NarrativeKeyTerm[];
}

export function KeyTermsStrip({ keyTerms }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (keyTerms.length === 0) return null;

  return (
    <div className="border-b border-[var(--color-hairline)] py-3">
      <div className="mb-2 text-xs text-[var(--color-text-secondary)]">
        핵심 용어
      </div>
      <ul role="list" className="flex flex-wrap gap-2">
        {keyTerms.map((kt, idx) => (
          <li key={`${kt.term}-${idx}`} role="listitem" className="relative">
            <button
              type="button"
              className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-sm hover:bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onFocus={() => setHoveredIdx(idx)}
              onBlur={() => setHoveredIdx(null)}
              aria-describedby={`keyterm-tooltip-${idx}`}
            >
              {kt.term}
            </button>
            {hoveredIdx === idx && (
              <div
                id={`keyterm-tooltip-${idx}`}
                role="tooltip"
                className="absolute left-0 top-full z-10 mt-1 max-w-xs rounded border border-[var(--color-hairline)] bg-white p-2 text-xs shadow-lg"
              >
                {kt.gloss}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: 0 에러.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/ui/KeyTermsStrip.tsx
git commit -m "feat(saju-tri): KeyTermsStrip — 핵심 용어 hover tooltip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: NarrativeSection 컴포넌트

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/NarrativeSection.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
// 단일 narrative 섹션 (personality / career / relationship / health / daeunSummary).
// RSC 호환. 부모가 5번 호출.
interface Props {
  title: string;
  body: string;
}

export function NarrativeSection({ title, body }: Props) {
  return (
    <section className="py-3">
      <h4
        aria-level={4}
        className="mb-2 text-sm font-semibold text-[var(--color-text)]"
      >
        {title}
      </h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
        {body}
      </p>
    </section>
  );
}
```

- [ ] **Step 2: 타입 체크 + 커밋**

```bash
cd apps/dashboard && pnpm typecheck
git add apps/dashboard/src/features/saju-lifetime-tri/ui/NarrativeSection.tsx
git commit -m "feat(saju-tri): NarrativeSection — h4 + body 한 섹션

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.3: CitationsFootnote 컴포넌트

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/CitationsFootnote.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
// 출처 인용 — 명조 narrative 하단 footer.
interface Props {
  citations: string[];
}

export function CitationsFootnote({ citations }: Props) {
  if (citations.length === 0) return null;

  return (
    <footer className="border-t border-[var(--color-hairline)] py-3">
      <div className="mb-1 text-xs text-[var(--color-text-secondary)]">출처</div>
      <ul className="space-y-1">
        {citations.map((c, idx) => (
          <li
            key={`citation-${idx}`}
            className="text-xs text-[var(--color-text-secondary)]"
          >
            · {c}
          </li>
        ))}
      </ul>
    </footer>
  );
}
```

- [ ] **Step 2: 타입 체크 + 린트 + 커밋**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
git add apps/dashboard/src/features/saju-lifetime-tri/ui/CitationsFootnote.tsx
git commit -m "feat(saju-tri): CitationsFootnote — 출처 인용 footer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: UI 학파별 detail + 통합

### Task 5.1: KoSchoolDetail

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/KoSchoolDetail.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
// 한국식 (ko) 학파 detail — 조후 + 신살.
import type { SchoolSpecificKo } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificKo;
}

export function KoSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        한국식 추가 분석 — 조후·신살
      </h4>
      <dl className="space-y-2">
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            조후 포커스
          </dt>
          <dd className="text-sm leading-relaxed">{data.joohuFocus}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            신살 해석
          </dt>
          <dd>
            <ul className="space-y-1">
              {data.shinsalNotes.map((note, idx) => (
                <li key={idx} className="text-sm leading-relaxed">
                  · {note}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/KoSchoolDetail.tsx
git commit -m "feat(saju-tri): KoSchoolDetail — 조후·신살 상세

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.2: ZipingSchoolDetail

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/ZipingSchoolDetail.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
// 중자평 (cn-ziping) 학파 detail — 격국·용신 철학적 근거.
import type { SchoolSpecificZiping } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificZiping;
}

export function ZipingSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        中자평 추가 분석 — 격국·용신
      </h4>
      <dl className="space-y-2">
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            격국 성립/파괴 근거
          </dt>
          <dd className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.gyeokgukRationale}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-secondary)] mb-1">
            용신 후보 분석
          </dt>
          <dd className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.yongshinAnalysis}
          </dd>
        </div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/ZipingSchoolDetail.tsx
git commit -m "feat(saju-tri): ZipingSchoolDetail — 격국·용신 상세

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.3: MangpaiSchoolDetail

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/MangpaiSchoolDetail.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
// 中맹파 (cn-mangpai) 학파 detail — 응기 시점 타임라인.
import type { SchoolSpecificMangpai } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificMangpai;
}

export function MangpaiSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        中맹파 추가 분석 — 응기(應期) 타임라인
      </h4>
      <table className="w-full text-sm">
        <caption className="sr-only">시점별 사건 예측</caption>
        <thead>
          <tr className="border-b border-[var(--color-hairline)]">
            <th scope="col" className="text-left py-2 text-xs text-[var(--color-text-secondary)]">
              시점
            </th>
            <th scope="col" className="text-left py-2 text-xs text-[var(--color-text-secondary)]">
              사건
            </th>
          </tr>
        </thead>
        <tbody>
          {data.eventTimings.map((t, idx) => (
            <tr key={idx} className="border-b border-[var(--color-hairline)] last:border-b-0">
              <th scope="row" className="py-2 pr-3 align-top font-medium">
                {t.period}
              </th>
              <td className="py-2 align-top">{t.event}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/MangpaiSchoolDetail.tsx
git commit -m "feat(saju-tri): MangpaiSchoolDetail — 응기 타임라인 table

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.4: JpSchoolDetail

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/JpSchoolDetail.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
// 日추명 (jp) 학파 detail — 12궁 처세.
import type { SchoolSpecificJp } from "@/shared/lib/db/schema";

interface Props {
  data: SchoolSpecificJp;
}

export function JpSchoolDetail({ data }: Props) {
  return (
    <section className="border border-[var(--color-hairline)] rounded p-3 space-y-3">
      <h4 aria-level={4} className="text-sm font-semibold">
        日추명 추가 분석 — 12궁 처세
      </h4>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.palaceMap.map((p, idx) => (
          <div
            key={idx}
            className="border-l-2 border-[var(--color-hairline)] pl-2"
          >
            <dt className="text-xs font-semibold mb-1">{p.palace}</dt>
            <dd className="text-sm leading-relaxed">{p.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/JpSchoolDetail.tsx
git commit -m "feat(saju-tri): JpSchoolDetail — 12궁 처세 grid

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.5: SchoolSpecificCard dispatcher

**Files:**
- Create: `apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/SchoolSpecificCard.tsx`

- [ ] **Step 1: 파일 작성**

```typescript
// 학파별 detail 컴포넌트 dispatcher.
import type {
  SchoolSpecific,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
} from "@/shared/lib/db/schema";
import type { NarrativeSchool } from "../../api/prompts";
import { KoSchoolDetail } from "./KoSchoolDetail";
import { ZipingSchoolDetail } from "./ZipingSchoolDetail";
import { MangpaiSchoolDetail } from "./MangpaiSchoolDetail";
import { JpSchoolDetail } from "./JpSchoolDetail";

interface Props {
  school: NarrativeSchool;
  schoolSpecific: SchoolSpecific;
}

export function SchoolSpecificCard({ school, schoolSpecific }: Props) {
  switch (school) {
    case "ko":
      return <KoSchoolDetail data={schoolSpecific as SchoolSpecificKo} />;
    case "cn-ziping":
      return (
        <ZipingSchoolDetail data={schoolSpecific as SchoolSpecificZiping} />
      );
    case "cn-mangpai":
      return (
        <MangpaiSchoolDetail data={schoolSpecific as SchoolSpecificMangpai} />
      );
    case "jp":
      return <JpSchoolDetail data={schoolSpecific as SchoolSpecificJp} />;
  }
}
```

- [ ] **Step 2: 타입 체크 + 린트 + 커밋**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
git add apps/dashboard/src/features/saju-lifetime-tri/ui/school-specific/SchoolSpecificCard.tsx
git commit -m "feat(saju-tri): SchoolSpecificCard dispatcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.6: LifetimeFrameView props 확장 + 본문 조립

**Files:**
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameView.tsx`

- [ ] **Step 1: 파일 전체 교체**

```typescript
"use client";

// LifetimeFrame 표시 + narrative 영역 (v0.2 — KeyTermsStrip / NarrativeSection ×5 /
// SchoolSpecificCard / CitationsFootnote 조립).
import type { LifetimeFrame } from "@gons/saju";
import type {
  NarrativeSections,
  SchoolSpecific,
} from "@/shared/lib/db/schema";
import type { NarrativeSchool } from "../api/prompts";
import { KeyTermsStrip } from "./KeyTermsStrip";
import { NarrativeSection } from "./NarrativeSection";
import { CitationsFootnote } from "./CitationsFootnote";
import { SchoolSpecificCard } from "./school-specific/SchoolSpecificCard";

interface NarrativePayload {
  narrativeText: string;
  sections: NarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
}

interface Props {
  frame: LifetimeFrame;
  school: NarrativeSchool;
  narrative: NarrativePayload | null;
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

const SECTION_LABELS = {
  personality: "성격·기질",
  career: "직업·진로",
  relationship: "인간관계",
  health: "건강 관리",
  daeunSummary: "대운 흐름",
} as const;

export function LifetimeFrameView({
  frame,
  school,
  narrative,
  loading,
  error,
  retryRemainingMs,
  onFetch,
}: Props) {
  const rateLimited = retryRemainingMs > 0;

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="font-bold">격국: {frame.formatGyeokguk.name}</div>
      <div className="text-sm text-gray-700">
        {frame.formatGyeokguk.reasoning}
      </div>
      {frame.yongshin && (
        <div className="text-sm">
          용신: {frame.yongshin.element} — {frame.yongshin.reasoning}
        </div>
      )}
      <div className="text-sm space-y-1">
        <div>직업: {frame.careerHints.join(" · ")}</div>
        <div>관계: {frame.relationshipHints.join(" · ")}</div>
        <div>건강: {frame.healthHints.join(" · ")}</div>
        <div>주의: {frame.cautions.join(" · ")}</div>
      </div>

      {narrative ? (
        <div className="space-y-3">
          <KeyTermsStrip keyTerms={narrative.sections.keyTerms} />
          <NarrativeSection
            title={SECTION_LABELS.personality}
            body={narrative.sections.personality}
          />
          <NarrativeSection
            title={SECTION_LABELS.career}
            body={narrative.sections.career}
          />
          <NarrativeSection
            title={SECTION_LABELS.relationship}
            body={narrative.sections.relationship}
          />
          <NarrativeSection
            title={SECTION_LABELS.health}
            body={narrative.sections.health}
          />
          <NarrativeSection
            title={SECTION_LABELS.daeunSummary}
            body={narrative.sections.daeunSummary}
          />
          <SchoolSpecificCard
            school={school}
            schoolSpecific={narrative.schoolSpecific}
          />
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
          분당 요청 한도 초과 — {formatRetryRemaining(retryRemainingMs)} 후 다시
          시도해주세요.
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

- [ ] **Step 2: 타입 체크 (호출부 변경 전이므로 lint 는 다음 task 후)**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: TriNationTabs / LifetimeFrameCard 가 변경된 props 를 안 넘기면 에러 발생. 다음 task 에서 해결되므로 일단 진행.

- [ ] **Step 3: 커밋 (호출부 동시 변경 전이라 PR 머지 전엔 빌드가 깨질 수 있음)**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameView.tsx
git commit -m "feat(saju-tri): LifetimeFrameView v0.2 — props 확장 + 조립

호출부 (TriNationTabs, LifetimeFrameCard) 갱신은 다음 commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.7: TriNationTabs — NarrativeState 확장 + fetch 응답 파싱

**Files:**
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/ui/TriNationTabs.tsx`

- [ ] **Step 1: NarrativeState 와 INITIAL_NARRATIVE_STATE 갱신**

기존 (line 44~58 부근):
```typescript
interface NarrativeState {
  text: string | null;
  loading: boolean;
  error: string | null;
  retryAt: number | null;
}

const INITIAL_NARRATIVE_STATE: NarrativeState = {
  text: null,
  loading: false,
  error: null,
  retryAt: null,
};
```

교체:
```typescript
import type {
  NarrativeSections,
  SchoolSpecific,
} from "@/shared/lib/db/schema";

interface NarrativePayload {
  narrativeText: string;
  sections: NarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
}

interface NarrativeState {
  payload: NarrativePayload | null;
  loading: boolean;
  error: string | null;
  retryAt: number | null;
}

const INITIAL_NARRATIVE_STATE: NarrativeState = {
  payload: null,
  loading: false,
  error: null,
  retryAt: null,
};
```

- [ ] **Step 2: fetch 응답 파싱 갱신**

`fetchNarrative` 안의 success 처리부 (기존 `setNarratives((prev) => ({ ..., text: data.narrativeText }))` 류) 를 다음으로:
```typescript
const data = (await res.json()) as NarrativePayload & {
  fromCache: boolean;
  modelId: string;
  promptVersion: number;
  generatedAt: string;
  school: SchoolKey;
};

setNarratives((prev) => ({
  ...prev,
  [schoolKey]: {
    ...prev[schoolKey],
    payload: {
      narrativeText: data.narrativeText,
      sections: data.sections,
      schoolSpecific: data.schoolSpecific,
      citations: data.citations,
    },
    loading: false,
  },
}));
```

- [ ] **Step 3: LifetimeFrameView 호출부 갱신**

기존:
```tsx
<LifetimeFrameView
  frame={frame}
  narrative={state.text}
  ...
/>
```

교체 (activeTab !== "compose" 분기 안에서):
```tsx
<LifetimeFrameView
  frame={frame}
  school={activeTab as SchoolKey}
  narrative={state.payload}
  loading={state.loading}
  error={state.error}
  retryRemainingMs={retryRemainingMs}
  onFetch={() => fetchNarrative(activeTab as SchoolKey)}
/>
```

`SchoolKey` 가 `NarrativeSchool` 과 동일한 union 이므로 추가 alias 불필요. 만약 type 충돌 시 `import type { NarrativeSchool } from "../api/prompts"` 후 SchoolKey 자리에 NarrativeSchool 사용.

- [ ] **Step 4: 타입 체크 + 린트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 0 에러, 0 issue. 만약 `react-hooks/error-boundaries` 룰 위반 (async setState 안의 try-catch 안 JSX) 이 나오면 [discriminated union 패턴 — `.then(success, failure)`] 적용.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/features/saju-lifetime-tri/ui/TriNationTabs.tsx
git commit -m "feat(saju-tri): TriNationTabs v0.2 — NarrativeState 에 full payload

text:string|null → payload:NarrativePayload|null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.8: LifetimeFrameCard — fetch 응답 전체 state

**Files:**
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx`

- [ ] **Step 1: state 와 fetch 응답 파싱 갱신**

기존 (line 30~32):
```typescript
const [narrative, setNarrative] = useState<string | null>(null);
```

교체:
```typescript
import type { NarrativeSections, SchoolSpecific } from "@/shared/lib/db/schema";

interface NarrativePayload {
  narrativeText: string;
  sections: NarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
}

const [narrative, setNarrative] = useState<NarrativePayload | null>(null);
```

기존 fetch success (line 95~96):
```typescript
const data = (await res.json()) as { narrativeText: string };
setNarrative(data.narrativeText);
```

교체:
```typescript
const data = (await res.json()) as NarrativePayload & {
  fromCache: boolean;
  modelId: string;
  promptVersion: number;
};
setNarrative({
  narrativeText: data.narrativeText,
  sections: data.sections,
  schoolSpecific: data.schoolSpecific,
  citations: data.citations,
});
```

- [ ] **Step 2: LifetimeFrameView 호출 갱신**

기존 (line 111~120):
```tsx
<LifetimeFrameView
  frame={frame}
  narrative={narrative}
  loading={loading}
  ...
/>
```

교체:
```tsx
<LifetimeFrameView
  frame={frame}
  school={schoolKey}
  narrative={narrative}
  loading={loading}
  error={error}
  retryRemainingMs={retryRemainingMs}
  onFetch={fetchNarrative}
/>
```

- [ ] **Step 3: 타입 체크 + 린트 + 커밋**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint
git add apps/dashboard/src/features/saju-lifetime-tri/ui/LifetimeFrameCard.tsx
git commit -m "feat(saju-tri): LifetimeFrameCard v0.2 — full payload state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6: 통합 검증

### Task 6.1: 전체 typecheck + lint + test 통과

- [ ] **Step 1: 전체 빌드 검증**

```bash
cd apps/dashboard && pnpm typecheck && pnpm lint && \
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test --run features/saju-lifetime-tri
```
Expected:
- typecheck: 0 에러
- lint: 0 issue
- test: schemas.test.ts 12개 + narrative-server.test.ts 11개 = 23개 PASS

- [ ] **Step 2: 운영 production build 검증**

```bash
pnpm build
```
Expected: build 성공.

```bash
grep -l "KeyTermsStrip\|NarrativeSection\|SchoolSpecificCard\|school_specific" \
  apps/dashboard/.next/server/chunks/*.js 2>/dev/null | head -5
```
Expected: 최소 1개 이상 chunk 에 새 식별자 포함.

### Task 6.2: 로컬 dev 시각 검증

- [ ] **Step 1: 로컬 DB 의 기존 narrative 캐시 제거 (테스트 DB)**

```bash
docker exec gons-test-db psql -U test -d test_dummy -c \
  "DELETE FROM saju_lifetime_narrative;"
```

- [ ] **Step 2: dev 서버 기동**

```bash
pnpm dev
```
`http://localhost:3020/fortune/<profile-id>` 접속.

- [ ] **Step 3: 4개 탭 각각 확인**

각 탭 (한국·中자평·中맹파·日추명) 에서:
- "더 자세히 보기" 클릭 → 분석 중 → narrative 표시
- KeyTermsStrip (핵심 용어 칩) 상단
- NarrativeSection 5개 (성격·기질 / 직업·진로 / 인간관계 / 건강 관리 / 대운 흐름)
- SchoolSpecificCard 학파별 분기:
  - ko: 조후·신살
  - cn-ziping: 격국·용신
  - cn-mangpai: 응기 타임라인 table
  - jp: 12궁 grid
- CitationsFootnote 하단
- 본문 분량이 기존 (400~500자) 대비 명백히 길어짐 (체감 3배)

- [ ] **Step 4: Network 탭 응답 검증**

DevTools Network 에서 `/api/saju/lifetime/<id>/narrative?school=ko` 응답:
- `promptVersion: 2` 존재
- `schoolSpecific.joohuFocus` 존재
- `sections.keyTerms` 배열 (3개 이상)
- `sections.cautions` 배열
- `citations` 배열 (2개 이상)

- [ ] **Step 5: 4탭 학파 차별 cross-check**

같은 명조 4탭이 학파별 강조점이 다른지 확인:
- ko: 조후 + 신살 명확
- ziping: 격국·용신 철학 분석 명확
- mangpai: 응기 시점 단정형 명확
- jp: 12궁 처세 명확

만약 4탭 톤이 비슷하면 → prompts.ts 의 [금지] 영역을 더 명시적으로 보강 (개발 중 반복 가능).

### Task 6.3: 운영 배포

**선결조건:** 모든 commit 이 main 으로 머지되어 GHA build 가 통과한 상태.

- [ ] **Step 1: PR 생성 + 머지**

```bash
gh pr create --title "feat(saju-tri): lifetime narrative v0.2 — 분량·용어풀이·실전성·학파차" \
  --body "spec: docs/superpowers/specs/2026-05-19-saju-lifetime-narrative-richer-design.md

## Summary
- 4학파 narrative 분량 3배 (400~500자 → 1500~2000자)
- 인라인 한자 용어 풀이 + KeyTermsStrip hover tooltip
- 섹션별 3층 (성향 / 장면 행동 / 운세 타이밍)
- 학파 차별화: schoolSpecific 필드 학파별로 다름
- PROMPT_VERSION 키로 자동 캐시 무효화

## Test plan
- [ ] typecheck + lint + 23 unit test pass
- [ ] 로컬 dev 4탭 visual 확인
- [ ] 운영 DB migration 적용
- [ ] 운영 배포 후 4탭 cache miss → v2 응답 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh run watch
gh pr merge --squash
```

- [ ] **Step 2: 운영 DB 마이그레이션 적용**

```bash
I_KNOW_THIS_IS_PROD=1 pnpm db:migrate
```
Expected: `0013_*_richer_narrative.sql` 적용.

운영 DB 컬럼 확인:
```bash
docker --context home-server exec gons-dashboard-postgres-1 psql -U gons -d gons -c \
  "\d saju_lifetime_narrative" | grep -E "prompt_version|school_specific"
```

- [ ] **Step 3: 도커 이미지 교체**

```bash
COMPOSE=/home/gon/projects/gon/gons-dashboard/docker-compose.yml
docker --context home-server compose -f $COMPOSE pull app cron
docker --context home-server compose -f $COMPOSE up -d app cron
```

- [ ] **Step 4: 헬스체크 + image SHA**

```bash
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"
docker --context home-server inspect gons-dashboard-app-1 --format='{{.Image}}'
```

- [ ] **Step 5: 사용자 브라우저 검증**

`https://gons.krdn.kr/fortune/<profile-id>` 로그인 후 4탭 모두 "더 자세히 보기" 클릭. cache miss → 약 30초 대기 → v2 narrative 표시.

- [ ] **Step 6: 운영 DB v2 row 확인**

```bash
docker --context home-server exec gons-dashboard-postgres-1 psql -U gons -d gons -c \
  "SELECT school, prompt_version, school_specific_jsonb IS NOT NULL AS has_school_specific, generated_at \
   FROM saju_lifetime_narrative \
   WHERE prompt_version = 2 \
   ORDER BY generated_at DESC LIMIT 8;"
```
Expected: 4학파 행 출력. `has_school_specific=t`.

---

## 참고 사항

### 운영 모니터링 (배포 후 1주)

- LLM 호출 실패율 — `console.error("[saju/narrative] LLM error")` 빈도. zod min 길이 미달 빈발 시 prompt 보강 또는 min 완화.
- 평균 응답 시간 — max_tokens 8192 로 늘어난 latency 가 30초 이내 유지되는지.
- v1 row 비율 — 기존 v1 캐시 잔존 확인 (감사 / 비교 목적).

### 롤백 절차

문제 발생 시 빠른 롤백:
1. `prompts.ts` 의 `PROMPT_VERSION = 2` 를 `PROMPT_VERSION = 1` 로 되돌리고 도커 재배포.
2. v1 row 자동 hit (DB schema 호환).
3. schema migration revert 는 컬럼 추가만이라 불필요.

### Spec 대비 의도적 단순화

- **E2E 테스트 미추가** — spec "범위 외" 명시 (v0.1 도 미추가).
- **anthropic SDK mock test 미추가** — narrative-server.test.ts 는 기존대로 `extractJsonObject` 만 테스트. schemas.test.ts 가 zod 검증 안전망 역할.

### 의존성 그래프

```
schema.ts (NarrativeSections + SchoolSpecific*)
   ↑
prompts.ts (PROMPT_VERSION + SCHOOL_PROMPTS)
   ↑
schemas.ts (SCHOOL_SCHEMAS + NarrativeOutput)
   ↑
narrative-server.ts (getOrBuildNarrative)
   ↑
route.ts (/api/saju/lifetime/[id]/narrative)
   ↑
TriNationTabs.tsx / LifetimeFrameCard.tsx  →  LifetimeFrameView.tsx
                                                       ↓
                          KeyTermsStrip + NarrativeSection*5 +
                          SchoolSpecificCard (→ Ko/Ziping/Mangpai/Jp) +
                          CitationsFootnote
```
