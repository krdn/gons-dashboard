# 사주 삼국 분석 v0.2 — 년운(歲運) + 용신 Implementation Plan

> **STATUS — code-complete 2026-05-18.** Phase 0~6 모두 main 머지 (PR #79, #80, #81, #82, #83, #84, #85). 운영 배포 완료 (image SHA `16e9a6fe`). **Phase 7 (Task 7.1 — 사용자 브라우저 UI 검증)** 만 pending. 진행 기록은 본 파일의 step 체크박스가 아닌 git log + PR 목록을 정본으로 한다 (체크박스는 빌드 시점 가이드라인).
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/saju` 에 4학파 용신(yongshin) 계산 + 현재 세운(歲運) 1년 결정형 frame 빌더를 추가하고, `/fortune/[profileId]` 안에 v0.1 평생운 아래 `<SajuTriYearly />` 위젯을 주입한다. LLM narrative 는 학파별 lazy + DB 영구 캐시.

**Architecture:** v0.1 평생운 파이프라인을 미러. 학파별 `yongshin.ts` (대표 알고리즘 1개) → 학파별 `yearly.ts` (yongShin + daeun + targetYear 입력 → YearlyFrame 결정형 출력) → `compose/yearly.ts` (TriNationYearly + crossCheck) → API 2종 + UI 위젯 + DB 캐시 테이블 2종. cli-proxy-api 호환 narrative 패턴은 PR #76 의 user-message JSON 지시 재사용.

**Tech Stack:** TypeScript / pnpm workspaces / Vitest / Drizzle ORM / Next.js 16 App Router / Anthropic SDK (`shared/lib/llm/anthropic.ts`) / Zod.

**Spec:** `docs/superpowers/specs/2026-05-18-saju-tri-yearly-design.md`

**Pre-flight 확인 메모:**

- 마이그레이션 디렉터리: `apps/dashboard/drizzle/` (직접 — `migrations/` 하위 아님). 최신 번호 `0011_dark_amazoness.sql` → 다음 `0012_*` 사용.
- DB 스키마: `apps/dashboard/src/shared/lib/db/schema.ts` — `sajuLifetimeTri` / `sajuLifetimeNarrative` 패턴 그대로 미러.
- 학파 어댑터: `packages/saju/src/adapters/{ko,cn-ziping,cn-mangpai,jp}/lifetime.ts` 옆에 `yongshin.ts` + `yearly.ts` 추가. lifetime.ts 의 `TODO(v0.2)` 주석은 후속 follow-up PR 에서 yongshin 결과를 lifetime frame 에 주입하면서 해소 (본 plan §종료 참고).
- v0.1 narrative 패턴은 `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts` 가 정답 (PR #76 `c1aa446` + `d9090af`). yearly narrative-server 는 이걸 복사 + 입력 frame 만 교체.
- 회귀 보호: 모든 PR 은 `cd apps/dashboard && pnpm typecheck && pnpm lint` 통과 필수 (memory: `react-error-boundaries-lint-rule.md`).

**Plan revisions (2026-05-18 patch — 구현 시작 전 발견된 결함 4건):**

1. **`Element` 타입은 영어 enum** — `packages/saju/src/hanja.ts` 에서 `"wood" | "fire" | "earth" | "metal" | "water"` 로 정의됨. plan 본문의 모든 `STEM_ELEMENT` / `BRANCH_ELEMENT` / `PRODUCES` / `PRODUCED_BY` / `CONTROLS` 매핑 값 + Record key 가 sed 일괄 교체 완료 (`"木"`→`"wood"` 등).

2. **`MajorFortune` 에 `endAge` 필드 없음** — 실제 type 은 `{ startAge, startYear, stem, branch }` 4개 필드만 존재. plan 코드 안의 `endAge` 사용처는 구현 시 다음 패턴으로 보정:

   ```ts
   // findCurrentDaeun 헬퍼: 다음 항목의 startAge 미만으로 범위 판정
   function findCurrentDaeun(daeun: MajorFortune[], age: number): { d: MajorFortune; endAge: number } {
     for (let i = 0; i < daeun.length; i++) {
       const startAge = daeun[i].startAge;
       const endAge = daeun[i + 1] ? daeun[i + 1].startAge - 1 : startAge + 9;  // 마지막은 10년 가정
       if (age >= startAge && age <= endAge) return { d: daeun[i], endAge };
     }
     return { d: daeun[0], endAge: daeun[0].startAge + 9 };
   }
   ```

   test fixture 의 `endAge: NN` 필드는 제거 + 필요 시 `startYear` 추가 (또는 `as unknown as SajuChart` 캐스트로 우회 — 기존 v0.1 패턴).

3. **`SajuChart` 구조** — pillars 가 한 단계 더 깊음:
   ```ts
   // 잘못된 plan 코드: chart.year.stem, chart.day.branch
   // 올바른 접근:     chart.pillars.year.stem, chart.pillars.day.branch
   ```

   plan 코드의 `chart.year`, `chart.month`, `chart.day`, `chart.hour` 모두 `chart.pillars.year` 등으로 보정. test fixture 도 `{ pillars: { year, month, day, hour }, majorFortunes }` 형식으로.

4. **`SajuChart.yongSin` 는 이미 `Element[]`** — plan §11 acceptance criterion 6 의 "v0.2 미적용 해소" 는 v0.1 시점에서 이미 빈 배열이 아닌 채워진 상태일 수 있음. 어댑터 lifetime.ts 의 `TODO(v0.2)` 주석은 v0.1 LifetimeFrame 의 `yongshin?: ...` 필드 (extendedTypes.ts) 가 `undefined` 인 것을 가리키며, plan §종료 follow-up Task 8.1 은 그 필드 주입 작업. yongSin 배열 자체와는 다른 수준.

**구현 정책:** 각 Task 의 코드 블록을 따라가되, 위 4건은 컴파일 시 자연스럽게 드러나므로 발견 즉시 해당 task 안에서 보정 (별도 plan 재revise 없이 진행).

---

## Task 0.1: DB 마이그레이션 — saju_yearly_tri + saju_yearly_narrative

**Files:**
- Create: `apps/dashboard/drizzle/0012_saju_tri_yearly.sql`
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` — `sajuYearlyTri`, `sajuYearlyNarrative` 추가 export

- [ ] **Step 1: 마이그레이션 번호 확인**

Run: `ls apps/dashboard/drizzle/*.sql | sort | tail -3`
Expected last: `0011_dark_amazoness.sql` (다음은 0012)

- [ ] **Step 2: 마이그레이션 SQL 작성**

`apps/dashboard/drizzle/0012_saju_tri_yearly.sql`:

```sql
CREATE TABLE saju_yearly_tri (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school          text NOT NULL CHECK (school IN ('ko','cn-ziping','cn-mangpai','jp','compose')),
  target_year     integer NOT NULL,
  input_hash      text NOT NULL,
  schema_version  integer NOT NULL,
  frame_jsonb     jsonb NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saju_yearly_tri_cache_key UNIQUE (profile_id, school, target_year, input_hash, schema_version)
);

CREATE INDEX saju_yearly_tri_profile_idx ON saju_yearly_tri (profile_id, target_year);

CREATE TABLE saju_yearly_narrative (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school          text NOT NULL CHECK (school IN ('ko','cn-ziping','cn-mangpai','jp')),
  target_year     integer NOT NULL,
  frame_hash      text NOT NULL,
  model_id        text NOT NULL,
  narrative_text  text NOT NULL,
  sections_jsonb  jsonb NOT NULL,
  citations       text[] NOT NULL DEFAULT '{}',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saju_yearly_narrative_cache_key UNIQUE (profile_id, school, target_year, frame_hash, model_id)
);

CREATE INDEX saju_yearly_narrative_profile_idx ON saju_yearly_narrative (profile_id, target_year);
```

- [ ] **Step 3: drizzle schema.ts 에 두 테이블 추가**

`apps/dashboard/src/shared/lib/db/schema.ts` 안 `sajuLifetimeTri`, `sajuLifetimeNarrative` 다음 줄에 추가:

```ts
export const sajuYearlyTri = pgTable(
  "saju_yearly_tri",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    targetYear: integer("target_year").notNull(),
    inputHash: text("input_hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    frameJsonb: jsonb("frame_jsonb").$type<TriNationYearly>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_yearly_tri_profile_idx").on(t.profileId, t.targetYear),
    uniqueIndex("saju_yearly_tri_cache_key").on(
      t.profileId,
      t.school,
      t.targetYear,
      t.inputHash,
      t.schemaVersion,
    ),
  ],
);

export type SajuYearlyTriRow = typeof sajuYearlyTri.$inferSelect;

export const sajuYearlyNarrative = pgTable(
  "saju_yearly_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    school: text("school").notNull(),
    targetYear: integer("target_year").notNull(),
    frameHash: text("frame_hash").notNull(),
    modelId: text("model_id").notNull(),
    narrativeText: text("narrative_text").notNull(),
    sectionsJsonb: jsonb("sections_jsonb").$type<NarrativeSections>().notNull(),
    citations: text("citations").array().notNull().default(sql`'{}'`),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saju_yearly_narrative_profile_idx").on(t.profileId, t.targetYear),
    uniqueIndex("saju_yearly_narrative_cache_key").on(
      t.profileId,
      t.school,
      t.targetYear,
      t.frameHash,
      t.modelId,
    ),
  ],
);

export type SajuYearlyNarrativeRow = typeof sajuYearlyNarrative.$inferSelect;
```

`TriNationYearly` import 는 Task 0.2 에서 추가될 `@gons/saju` export. 이 파일 상단 type-only import 영역에 추가:

```ts
import type { TriNationYearly } from "@gons/saju";
```

`NarrativeSections` 는 같은 파일에 이미 정의되어 있어 재사용. `sql` 도 같은 파일에서 이미 import 되어 있어 재사용.

- [ ] **Step 4: drizzle metadata 갱신 (선택)**

Run: `cd apps/dashboard && pnpm drizzle-kit generate` (drizzle-kit 가 설치된 경우)
Expected: `drizzle/meta/_journal.json` 갱신 또는 변화 없음. 수동 갱신이 표준이면 skip.

- [ ] **Step 5: typecheck**

`TriNationYearly` 가 아직 export 안 되어 있으므로 `unknown` 으로 임시 정의:

```ts
// schema.ts 의 import 부근, Task 0.2 에서 제거
type TriNationYearly = unknown; // TEMP — Task 0.2 에서 실제 import 로 교체
```

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (0 errors)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/drizzle/0012_saju_tri_yearly.sql \
        apps/dashboard/src/shared/lib/db/schema.ts \
        apps/dashboard/drizzle/meta
git commit -m "feat(saju-tri): v0.2 yearly DB 마이그레이션 + drizzle schema"
```

---

## Task 0.2: 신규 type 파일 — packages/saju/src/types/yearly.ts + yongshin.ts

**Files:**
- Create: `packages/saju/src/types/yongshin.ts`
- Create: `packages/saju/src/types/yearly.ts`
- Modify: `packages/saju/src/index.ts` — type re-export
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts` — Task 0.1 의 placeholder `TriNationYearly = unknown` 제거 후 실제 type import

- [ ] **Step 1: yongshin.ts 작성**

`packages/saju/src/types/yongshin.ts`:

```ts
import type { Stem, Element } from "../types";

/**
 * 학파별 용신 표현 — v0.2 단일 대표 알고리즘 결과.
 * 각 학파의 "용신" 개념이 미묘하게 다르므로 union 타입으로 분리.
 */

/** 한국식 — 억부 + 조후 혼합 */
export interface KoYongshin {
  school: "ko";
  primary: Element;            // 주용신 (보강해야 할 오행)
  secondary?: Element;         // 조후 보조용신
  gisin: Element[];            // 기신 (피해야 할 오행)
  basisShenStrength: "신강" | "신약" | "균형";
  basisJohuMode: "한랭" | "조열" | "균형";
}

/** 중국 자평 — 억부 단일 */
export interface CnZipingYongshin {
  school: "cn-ziping";
  primary: Element;
  gisin: Element[];
  basisShenStrength: "신강" | "신약" | "균형";
  structureHint?: "식신생재" | "관인상생" | "기타";
}

/** 중국 맹파 — 단건업 구전 체계 표 매핑 */
export interface CnMangpaiYongshin {
  school: "cn-mangpai";
  primary: Element;
  gisin: Element[];
  emergenceHint: string;       // 응기 시점 hint (자유 텍스트, 표 기반)
}

/** 일본 추명학 — 阿部泰山 12궁 통변성 */
export interface JpYongshin {
  school: "jp";
  favorable: string[];         // 길 통변성 (재성/관성 등)
  unfavorable: string[];       // 흉 통변성
}

export type Yongshin =
  | KoYongshin
  | CnZipingYongshin
  | CnMangpaiYongshin
  | JpYongshin;

/**
 * 일간(日干) + 월지(月支) 조합으로 신강/신약 판정에 사용할 helper 결과.
 * KO/CN자평 어댑터가 공유.
 */
export interface ShenStrengthBasis {
  dayStem: Stem;
  monthBranch: string;
  supportScore: number;        // 인성·비겁 합 점수
  drainScore: number;          // 식상·재성·관성 합 점수
  verdict: "신강" | "신약" | "균형";
}
```

- [ ] **Step 2: yearly.ts 작성**

`packages/saju/src/types/yearly.ts`:

```ts
import type { Stem, Branch, Element } from "../types";
import type { Yongshin } from "./yongshin";

/**
 * 년운(歲運) frame — 결정형 출력.
 * v0.2 는 현재 KST 연도 1년만. v0.3 에서 과거/미래로 확장.
 */
export interface YearlyFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  targetYear: number;

  /** 세군(歲君) — 그 해의 천간지지 (예: 2026 = 丙午) */
  yearGanji: { stem: Stem; branch: Branch };

  /** 현재 시점의 대운 구간 */
  currentDaeun: {
    startAge: number;
    endAge: number;
    ganji: { stem: Stem; branch: Branch };
  };

  /** 올해 안 대운 전환이 있을 경우 다음 대운 정보 (없으면 null) */
  daeunTransition: {
    willTransitionAt: number;        // 전환 나이 (만)
    nextGanji: { stem: Stem; branch: Branch };
  } | null;

  /** 세군 ↔ 원국 사이 충/합/형/파/해 */
  ganjiInteractions: {
    type: "충" | "합" | "형" | "파" | "해";
    subject: { pillar: "year" | "month" | "day" | "hour"; element: Stem | Branch };
    object: Stem | Branch;
  }[];

  /** 용신 강약 변화 */
  yongShinDelta: {
    reinforced: Element[];
    weakened: Element[];
    netVerdict: "favorable" | "unfavorable" | "mixed";
  };

  /** 학파 고유 키워드 */
  schoolSpecificHints: Record<string, string>;

  /** 대운+세운 결합 신살 */
  shensha: { name: string; pillar: string }[];

  /** 이 frame 을 만들 때 사용한 yongShin (참고용) */
  yongShinUsed: Yongshin;
}

export interface TriNationYearly {
  targetYear: number;
  frames: {
    ko: YearlyFrame;
    cnZiping: YearlyFrame;
    cnMangpai: YearlyFrame;
    jp: YearlyFrame;
  };
  crossCheck: {
    agreement: "high" | "medium" | "low";
    notes: string[];
  };
}
```

- [ ] **Step 3: packages/saju/src/index.ts 에 re-export 추가**

기존 export 끝부분에:

```ts
export type {
  Yongshin,
  KoYongshin,
  CnZipingYongshin,
  CnMangpaiYongshin,
  JpYongshin,
  ShenStrengthBasis,
} from "./types/yongshin";

export type { YearlyFrame, TriNationYearly } from "./types/yearly";
```

- [ ] **Step 4: schema.ts placeholder 교체**

`apps/dashboard/src/shared/lib/db/schema.ts` 에서 Task 0.1 Step 5 의:

```ts
type TriNationYearly = unknown; // TEMP
```

제거하고 import 로 교체:

```ts
import type { TriNationYearly } from "@gons/saju";
```

(이미 Task 0.1 Step 3 에서 적어 두었으면 placeholder 만 제거.)

- [ ] **Step 5: typecheck**

Run: `cd apps/dashboard && pnpm typecheck && cd ../../packages/saju && pnpm exec tsc --noEmit`
Expected: PASS (0 errors)

- [ ] **Step 6: Commit**

```bash
git add packages/saju/src/types/yongshin.ts \
        packages/saju/src/types/yearly.ts \
        packages/saju/src/index.ts \
        apps/dashboard/src/shared/lib/db/schema.ts
git commit -m "feat(saju): v0.2 yongshin + yearly type 정의"
```

---

## Task 1.1: KO 용신 계산 — adapters/ko/yongshin.ts

**Files:**
- Create: `packages/saju/src/adapters/ko/yongshin.ts`
- Test: `packages/saju/src/adapters/ko/yongshin.test.ts`

핵심 룰: (1) 일간 기준 인성·비겁 vs 식상·재성·관성 점수 → 신강/신약. (2) 월지 절기 → 한랭/조열 판정. (3) 신강+조열 → 水 용신 / 신약+한랭 → 火 용신 / 충돌 시 조후 우선.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/saju/src/adapters/ko/yongshin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYongshinKo } from "./yongshin";
import type { SajuChart } from "../../types";

// 본인 사주 — 1967-03-29 05:30, 壬辰 일주, 卯月 (春)
const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [],
} as unknown as SajuChart;

describe("buildYongshinKo — canonical 1967", () => {
  it("일간 壬, 卯月 출생 → 신강 보조, 균형 조후, 火土 보강", () => {
    const result = buildYongshinKo(canonical1967);
    expect(result.school).toBe("ko");
    expect(result.basisShenStrength).toBe("신강");
    expect(result.basisJohuMode).toBe("균형");
    // 신강 → 설기/극제 오행이 용신. 봄 木 강하므로 火土 가 적합.
    expect(["fire", "earth"]).toContain(result.primary);
    expect(result.gisin).toContain("water");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/saju && pnpm test yongshin -- --run`
Expected: FAIL — "buildYongshinKo is not a function" 또는 module not found

- [ ] **Step 3: yongshin.ts 구현**

`packages/saju/src/adapters/ko/yongshin.ts`:

```ts
import type { SajuChart, Stem, Branch, Element } from "../../types";
import type { KoYongshin, ShenStrengthBasis } from "../../types/yongshin";

// 10천간 → 5행
const STEM_ELEMENT: Record<Stem, Element> = {
  甲: "wood", 乙: "wood",
  丙: "fire", 丁: "fire",
  戊: "earth", 己: "earth",
  庚: "metal", 辛: "metal",
  壬: "water", 癸: "water",
};

// 12지지 → 5행
const BRANCH_ELEMENT: Record<Branch, Element> = {
  子: "water", 亥: "water",
  寅: "wood", 卯: "wood",
  巳: "fire", 午: "fire",
  申: "metal", 酉: "metal",
  辰: "earth", 戌: "earth", 丑: "earth", 未: "earth",
};

// 12지지 → 계절 (조후 판정용)
const BRANCH_SEASON: Record<Branch, "봄" | "여름" | "가을" | "겨울"> = {
  寅: "봄", 卯: "봄", 辰: "봄",
  巳: "여름", 午: "여름", 未: "여름",
  申: "가을", 酉: "가을", 戌: "가을",
  亥: "겨울", 子: "겨울", 丑: "겨울",
};

// 5행 상생/상극
const PRODUCES: Record<Element, Element> = { wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood" };
const PRODUCED_BY: Record<Element, Element> = { fire: "wood", earth: "fire", metal: "earth", water: "metal", wood: "water" };
const CONTROLS: Record<Element, Element> = { wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire" };

/** 일간 대비 한 오행의 역할 분류 */
function classify(dayElement: Element, target: Element): "비겁" | "인성" | "식상" | "재성" | "관성" {
  if (target === dayElement) return "비겁";
  if (target === PRODUCED_BY[dayElement]) return "인성";    // 나를 생하는 오행
  if (target === PRODUCES[dayElement]) return "식상";       // 내가 생하는 오행
  if (target === CONTROLS[dayElement]) return "재성";       // 내가 극하는 오행
  return "관성";                                            // 나를 극하는 오행
}

function computeShenStrength(chart: SajuChart): ShenStrengthBasis {
  const dayElement = STEM_ELEMENT[chart.day.stem];
  const all: Element[] = [
    STEM_ELEMENT[chart.year.stem],
    STEM_ELEMENT[chart.month.stem],
    STEM_ELEMENT[chart.day.stem],
    STEM_ELEMENT[chart.hour.stem],
    BRANCH_ELEMENT[chart.year.branch],
    BRANCH_ELEMENT[chart.month.branch],
    BRANCH_ELEMENT[chart.day.branch],
    BRANCH_ELEMENT[chart.hour.branch],
  ];

  let support = 0;  // 인성+비겁
  let drain = 0;    // 식상+재성+관성
  for (const e of all) {
    const role = classify(dayElement, e);
    if (role === "비겁" || role === "인성") support++;
    else drain++;
  }

  const verdict: "신강" | "신약" | "균형" =
    support - drain >= 2 ? "신강" : drain - support >= 2 ? "신약" : "균형";

  return {
    dayStem: chart.day.stem,
    monthBranch: chart.month.branch,
    supportScore: support,
    drainScore: drain,
    verdict,
  };
}

function computeJohuMode(monthBranch: Branch): "한랭" | "조열" | "균형" {
  const season = BRANCH_SEASON[monthBranch];
  if (season === "겨울") return "한랭";
  if (season === "여름") return "조열";
  return "균형";
}

/**
 * 한국식 자평 + 조후 혼합 용신 — v0.2 단일 룰.
 *
 * 룰:
 *  - 신강 → 설기/극제 오행이 용신 (식상)
 *  - 신약 → 생부 오행이 용신 (인성)
 *  - 조후 한랭 → 火 보조 / 조열 → 水 보조 / 균형 → 보조 없음
 *  - 충돌(억부 용신 ∈ 조후 기신) 시 조후 우선 (primary 와 secondary 교환)
 */
export function buildYongshinKo(chart: SajuChart): KoYongshin {
  const basis = computeShenStrength(chart);
  const johu = computeJohuMode(chart.month.branch);
  const dayElement = STEM_ELEMENT[chart.day.stem];

  // 억부 후보
  let primary: Element;
  let gisin: Element[];
  if (basis.verdict === "신강") {
    primary = PRODUCES[dayElement];                     // 식상 (내가 생) — 설기
    gisin = [PRODUCED_BY[dayElement], dayElement];      // 인성·비겁
  } else if (basis.verdict === "신약") {
    primary = PRODUCED_BY[dayElement];                  // 인성
    gisin = [PRODUCES[dayElement], CONTROLS[dayElement]]; // 식상·재성
  } else {
    primary = PRODUCES[dayElement];                     // 균형 시 식상
    gisin = [];
  }

  // 조후 보조
  let secondary: Element | undefined;
  if (johu === "한랭") secondary = "fire";
  else if (johu === "조열") secondary = "water";

  // 충돌 시 조후 우선
  if (secondary && gisin.includes(secondary)) {
    [primary, secondary] = [secondary, primary];
    gisin = gisin.filter((g) => g !== primary);
  }

  return {
    school: "ko",
    primary,
    secondary,
    gisin,
    basisShenStrength: basis.verdict,
    basisJohuMode: johu,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/saju && pnpm test yongshin -- --run`
Expected: PASS (1/1)

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/ko/yongshin.ts \
        packages/saju/src/adapters/ko/yongshin.test.ts
git commit -m "feat(saju-tri): KO 용신 — 억부+조후 혼합 알고리즘"
```

---

## Task 1.2: CN자평 용신 — adapters/cn-ziping/yongshin.ts

**Files:**
- Create: `packages/saju/src/adapters/cn-ziping/yongshin.ts`
- Test: `packages/saju/src/adapters/cn-ziping/yongshin.test.ts`

KO yongshin.ts 의 `computeShenStrength`, `STEM_ELEMENT`, `BRANCH_ELEMENT`, `classify`, `PRODUCES`, `PRODUCED_BY`, `CONTROLS` 함수를 공통 모듈로 추출하지 않고 **각 어댑터에서 동일 코드 복제**. 학파별 룰 차이가 향후 발생하면 분리하기 쉽다 (조기 추상화 회피).

- [ ] **Step 1: 실패 테스트 작성**

`packages/saju/src/adapters/cn-ziping/yongshin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYongshinCnZiping } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [],
} as unknown as SajuChart;

describe("buildYongshinCnZiping — canonical 1967", () => {
  it("억부 단일 — 신강 → 설기 오행이 primary", () => {
    const r = buildYongshinCnZiping(canonical1967);
    expect(r.school).toBe("cn-ziping");
    expect(r.basisShenStrength).toBe("신강");
    // 신강 → 설기/극제 (壬水 일간 → 식상=木 / 재성=火 / 관성=土)
    expect(["wood", "fire", "earth"]).toContain(r.primary);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/saju && pnpm test cn-ziping/yongshin -- --run`
Expected: FAIL

- [ ] **Step 3: yongshin.ts 구현**

`packages/saju/src/adapters/cn-ziping/yongshin.ts`:

```ts
import type { SajuChart, Stem, Branch, Element } from "../../types";
import type { CnZipingYongshin } from "../../types/yongshin";

const STEM_ELEMENT: Record<Stem, Element> = {
  甲: "wood", 乙: "wood", 丙: "fire", 丁: "fire",
  戊: "earth", 己: "earth", 庚: "metal", 辛: "metal",
  壬: "water", 癸: "water",
};
const BRANCH_ELEMENT: Record<Branch, Element> = {
  子: "water", 亥: "water", 寅: "wood", 卯: "wood",
  巳: "fire", 午: "fire", 申: "metal", 酉: "metal",
  辰: "earth", 戌: "earth", 丑: "earth", 未: "earth",
};
const PRODUCES: Record<Element, Element> = { wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood" };
const PRODUCED_BY: Record<Element, Element> = { fire: "wood", earth: "fire", metal: "earth", water: "metal", wood: "water" };
const CONTROLS: Record<Element, Element> = { wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire" };

function classify(d: Element, t: Element): "비겁" | "인성" | "식상" | "재성" | "관성" {
  if (t === d) return "비겁";
  if (t === PRODUCED_BY[d]) return "인성";
  if (t === PRODUCES[d]) return "식상";
  if (t === CONTROLS[d]) return "재성";
  return "관성";
}

/**
 * 중국 자평 — 억부 단일 룰 (조후 미반영).
 *
 * 룰: 신강 → 설기/극제 오행 용신, 신약 → 생부 오행 용신.
 * structureHint: 식신생재(신강+식상+재성) / 관인상생(신약+관성+인성) 인식.
 */
export function buildYongshinCnZiping(chart: SajuChart): CnZipingYongshin {
  const dayElement = STEM_ELEMENT[chart.day.stem];
  const all: Element[] = [
    STEM_ELEMENT[chart.year.stem], STEM_ELEMENT[chart.month.stem],
    STEM_ELEMENT[chart.day.stem], STEM_ELEMENT[chart.hour.stem],
    BRANCH_ELEMENT[chart.year.branch], BRANCH_ELEMENT[chart.month.branch],
    BRANCH_ELEMENT[chart.day.branch], BRANCH_ELEMENT[chart.hour.branch],
  ];

  let support = 0, drain = 0;
  const roleCount: Record<string, number> = { 비겁: 0, 인성: 0, 식상: 0, 재성: 0, 관성: 0 };
  for (const e of all) {
    const role = classify(dayElement, e);
    roleCount[role]++;
    if (role === "비겁" || role === "인성") support++;
    else drain++;
  }

  const verdict: "신강" | "신약" | "균형" =
    support - drain >= 2 ? "신강" : drain - support >= 2 ? "신약" : "균형";

  let primary: Element;
  let gisin: Element[];
  if (verdict === "신강") {
    primary = PRODUCES[dayElement];                     // 식상
    gisin = [PRODUCED_BY[dayElement], dayElement];
  } else if (verdict === "신약") {
    primary = PRODUCED_BY[dayElement];                  // 인성
    gisin = [PRODUCES[dayElement], CONTROLS[dayElement]];
  } else {
    primary = PRODUCES[dayElement];
    gisin = [];
  }

  // structureHint
  let structureHint: "식신생재" | "관인상생" | "기타" = "기타";
  if (verdict === "신강" && roleCount["식상"] >= 1 && roleCount["재성"] >= 1) structureHint = "식신생재";
  else if (verdict === "신약" && roleCount["관성"] >= 1 && roleCount["인성"] >= 1) structureHint = "관인상생";

  return { school: "cn-ziping", primary, gisin, basisShenStrength: verdict, structureHint };
}
```

- [ ] **Step 4: 테스트 통과**

Run: `cd packages/saju && pnpm test cn-ziping/yongshin -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/cn-ziping/yongshin.ts \
        packages/saju/src/adapters/cn-ziping/yongshin.test.ts
git commit -m "feat(saju-tri): CN자평 용신 — 억부 단일 룰"
```

---

## Task 1.3: CN맹파 용신 — adapters/cn-mangpai/yongshin.ts

**Files:**
- Create: `packages/saju/src/adapters/cn-mangpai/yongshin.ts`
- Test: `packages/saju/src/adapters/cn-mangpai/yongshin.test.ts`

단건업 구전 체계 — 일간 10 × 월지 12 = 120 조합 표. v0.2 는 핵심 룰만 코드화 (전체 표 v0.3).

- [ ] **Step 1: 실패 테스트**

`packages/saju/src/adapters/cn-mangpai/yongshin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYongshinCnMangpai } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [],
} as unknown as SajuChart;

describe("buildYongshinCnMangpai — canonical 1967", () => {
  it("壬日 卯月 — 식상 木 용신 + 응기 hint", () => {
    const r = buildYongshinCnMangpai(canonical1967);
    expect(r.school).toBe("cn-mangpai");
    expect(r.primary).toBe("wood");                       // 식상 (壬→木)
    expect(r.emergenceHint).toContain("wood");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/saju && pnpm test cn-mangpai/yongshin -- --run`
Expected: FAIL

- [ ] **Step 3: yongshin.ts 구현**

`packages/saju/src/adapters/cn-mangpai/yongshin.ts`:

```ts
import type { SajuChart, Stem, Branch, Element } from "../../types";
import type { CnMangpaiYongshin } from "../../types/yongshin";

/**
 * 중국 맹파 — 단건업(段建業) 체계.
 *
 * 본 학파는 용신을 "응기 시점 시그널" 로 해석한다. v0.2 는 일간별 대표 용신
 * 1개(식상) + 월지에서 응기 hint 도출. 전체 120 조합 표는 v0.3.
 */

const STEM_ELEMENT: Record<Stem, Element> = {
  甲: "wood", 乙: "wood", 丙: "fire", 丁: "fire",
  戊: "earth", 己: "earth", 庚: "metal", 辛: "metal",
  壬: "water", 癸: "water",
};
const BRANCH_ELEMENT: Record<Branch, Element> = {
  子: "water", 亥: "water", 寅: "wood", 卯: "wood",
  巳: "fire", 午: "fire", 申: "metal", 酉: "metal",
  辰: "earth", 戌: "earth", 丑: "earth", 未: "earth",
};
const CONTROLS: Record<Element, Element> = { wood: "earth", fire: "metal", earth: "water", metal: "wood", water: "fire" };

// 일간별 단건업 식상-우선 용신 (간략)
const STEM_TO_YONGSHIN: Record<Stem, Element> = {
  甲: "fire", 乙: "fire",   // 木日 → 식상 火
  丙: "earth", 丁: "earth",   // 火日 → 식상 土
  戊: "metal", 己: "metal",   // 土日 → 식상 金
  庚: "water", 辛: "water",   // 金日 → 식상 水
  壬: "wood", 癸: "wood",   // 水日 → 식상 木
};

export function buildYongshinCnMangpai(chart: SajuChart): CnMangpaiYongshin {
  const dayElement = STEM_ELEMENT[chart.day.stem];
  const primary = STEM_TO_YONGSHIN[chart.day.stem];
  const gisin = [CONTROLS[dayElement]];                 // 일간을 극하는 오행

  const monthEl = BRANCH_ELEMENT[chart.month.branch];
  const emergenceHint =
    monthEl === primary
      ? `용신 ${primary} 가 월령 ${chart.month.branch} 에 同氣 — 응기 강력`
      : `용신 ${primary} 가 월령 ${chart.month.branch}(${monthEl}) 와 다름 — 대운/세운 ${primary} 도래 시 응기`;

  return { school: "cn-mangpai", primary, gisin, emergenceHint };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd packages/saju && pnpm test cn-mangpai/yongshin -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/cn-mangpai/yongshin.ts \
        packages/saju/src/adapters/cn-mangpai/yongshin.test.ts
git commit -m "feat(saju-tri): CN맹파 용신 — 단건업 일간별 식상 + 응기 hint"
```

---

## Task 1.4: JP 용신 — adapters/jp/yongshin.ts

**Files:**
- Create: `packages/saju/src/adapters/jp/yongshin.ts`
- Test: `packages/saju/src/adapters/jp/yongshin.test.ts`

阿部泰山 12궁 — 통변성 우선순위로 길흉 분리. v0.2 는 일간 무관 단일 우선순위.

- [ ] **Step 1: 실패 테스트**

`packages/saju/src/adapters/jp/yongshin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYongshinJp } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [],
} as unknown as SajuChart;

describe("buildYongshinJp — canonical 1967", () => {
  it("재성·관성 favorable, 비겁 unfavorable", () => {
    const r = buildYongshinJp(canonical1967);
    expect(r.school).toBe("jp");
    expect(r.favorable).toContain("재성");
    expect(r.favorable).toContain("관성");
    expect(r.unfavorable).toContain("비겁");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/saju && pnpm test jp/yongshin -- --run`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/saju/src/adapters/jp/yongshin.ts`:

```ts
import type { SajuChart } from "../../types";
import type { JpYongshin } from "../../types/yongshin";

/**
 * 일본 추명학 — 阿部泰山 12궁 통변성 우선순위.
 *
 * 룰: 통변성 5종 (비겁/식상/재성/관성/인성) 중 처세에 유리/불리한 통변성을
 * 분리. v0.2 는 일간 무관 기본 우선순위 사용 (재성·관성·인성 favorable /
 * 식상·비겁 unfavorable).
 *
 * v0.3 에서 일간별 12궁 위치 (생/욕/대/관/왕/쇠/병/사/묘/절/태/양) 별 미세
 * 조정 도입 예정.
 */
export function buildYongshinJp(_chart: SajuChart): JpYongshin {
  return {
    school: "jp",
    favorable: ["재성", "관성", "인성"],
    unfavorable: ["식상", "비겁"],
  };
}
```

- [ ] **Step 4: 통과**

Run: `cd packages/saju && pnpm test jp/yongshin -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/jp/yongshin.ts \
        packages/saju/src/adapters/jp/yongshin.test.ts
git commit -m "feat(saju-tri): JP 용신 — 阿部泰山 12궁 통변성 기본 우선순위"
```

---

## Task 2.1: KO 년운 어댑터 — adapters/ko/yearly.ts

**Files:**
- Create: `packages/saju/src/adapters/ko/yearly.ts`
- Test: `packages/saju/src/adapters/ko/yearly.test.ts`

세군(歲君) ↔ 원국 충/합 + 용신 강약 변화. 1984 = 甲子 기준 60갑자 룩업.

- [ ] **Step 1: 실패 테스트**

`packages/saju/src/adapters/ko/yearly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYearlyKo } from "./yearly";
import { buildYongshinKo } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [
    { startAge: 8, endAge: 17, stem: "壬", branch: "寅" },
    { startAge: 58, endAge: 67, stem: "丁", branch: "酉" },
    { startAge: 68, endAge: 77, stem: "丙", branch: "申" },
  ],
} as unknown as SajuChart;

describe("buildYearlyKo — 2026 세군", () => {
  it("2026 = 丙午, 만 59세 → 대운 丁酉 + yongShinDelta 포함", () => {
    const yongShin = buildYongshinKo(canonical1967);
    const result = buildYearlyKo({
      chart: canonical1967,
      daeun: canonical1967.majorFortunes,
      targetYear: 2026,
      yongShin,
      currentAge: 59,
    });
    expect(result.school).toBe("ko");
    expect(result.targetYear).toBe(2026);
    expect(result.yearGanji.stem).toBe("丙");
    expect(result.yearGanji.branch).toBe("午");
    expect(result.currentDaeun.ganji.stem).toBe("丁");
    expect(result.yongShinDelta.netVerdict).toMatch(/favorable|unfavorable|mixed/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/saju && pnpm test ko/yearly -- --run`
Expected: FAIL

- [ ] **Step 3: yearly.ts 구현**

`packages/saju/src/adapters/ko/yearly.ts`:

```ts
import type { SajuChart, Stem, Branch, Element, MajorFortune } from "../../types";
import type { KoYongshin } from "../../types/yongshin";
import type { YearlyFrame } from "../../types/yearly";

const STEM_ELEMENT: Record<Stem, Element> = {
  甲: "wood", 乙: "wood", 丙: "fire", 丁: "fire",
  戊: "earth", 己: "earth", 庚: "metal", 辛: "metal",
  壬: "water", 癸: "water",
};
const BRANCH_ELEMENT: Record<Branch, Element> = {
  子: "water", 亥: "water", 寅: "wood", 卯: "wood",
  巳: "fire", 午: "fire", 申: "metal", 酉: "metal",
  辰: "earth", 戌: "earth", 丑: "earth", 未: "earth",
};

// 60갑자 — index 0 = 甲子 (1984)
const STEMS: Stem[] = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCHES: Branch[] = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];

/** 양력 연도 → 세군 (천간지지). 기준: 1984 = 甲子 */
function yearGanjiOf(year: number): { stem: Stem; branch: Branch } {
  const diff = ((year - 1984) % 60 + 60) % 60;
  return { stem: STEMS[diff % 10], branch: BRANCHES[diff % 12] };
}

// 지지 6충
const BRANCH_CONFLICTS: Partial<Record<Branch, Branch>> = {
  子: "午", 午: "子",
  丑: "未", 未: "丑",
  寅: "申", 申: "寅",
  卯: "酉", 酉: "卯",
  辰: "戌", 戌: "辰",
  巳: "亥", 亥: "巳",
};
// 지지 6합
const BRANCH_COMBOS: Partial<Record<Branch, Branch>> = {
  子: "丑", 丑: "子",
  寅: "亥", 亥: "寅",
  卯: "戌", 戌: "卯",
  辰: "酉", 酉: "辰",
  巳: "申", 申: "巳",
  午: "未", 未: "午",
};

function findCurrentDaeun(daeun: MajorFortune[], age: number): MajorFortune {
  return daeun.find((d) => age >= d.startAge && age <= d.endAge) ?? daeun[0];
}

function findNextDaeun(daeun: MajorFortune[], current: MajorFortune): MajorFortune | undefined {
  const i = daeun.indexOf(current);
  return i >= 0 && i + 1 < daeun.length ? daeun[i + 1] : undefined;
}

export function buildYearlyKo(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  yongShin: KoYongshin;
  currentAge: number;
}): YearlyFrame {
  const { chart, daeun, targetYear, yongShin, currentAge } = args;
  const yearGanji = yearGanjiOf(targetYear);

  // 대운
  const cur = findCurrentDaeun(daeun, currentAge);
  const next = findNextDaeun(daeun, cur);
  const willTransitionThisYear =
    !!next && next.startAge === currentAge + 1;
  const daeunTransition = willTransitionThisYear && next
    ? { willTransitionAt: next.startAge, nextGanji: { stem: next.stem, branch: next.branch } }
    : null;

  // 세군 ↔ 원국 4기둥 ganji 상호작용
  const pillars = [
    { pillar: "year" as const, branch: chart.year.branch },
    { pillar: "month" as const, branch: chart.month.branch },
    { pillar: "day" as const, branch: chart.day.branch },
    { pillar: "hour" as const, branch: chart.hour.branch },
  ];
  const interactions: YearlyFrame["ganjiInteractions"] = [];
  for (const p of pillars) {
    if (BRANCH_CONFLICTS[yearGanji.branch] === p.branch) {
      interactions.push({ type: "충", subject: { pillar: p.pillar, element: p.branch }, object: yearGanji.branch });
    }
    if (BRANCH_COMBOS[yearGanji.branch] === p.branch) {
      interactions.push({ type: "합", subject: { pillar: p.pillar, element: p.branch }, object: yearGanji.branch });
    }
  }

  // yongShinDelta
  const yearStemEl = STEM_ELEMENT[yearGanji.stem];
  const yearBranchEl = BRANCH_ELEMENT[yearGanji.branch];
  const reinforced: Element[] = [];
  const weakened: Element[] = [];
  for (const el of [yearStemEl, yearBranchEl]) {
    if (el === yongShin.primary || el === yongShin.secondary) {
      if (!reinforced.includes(el)) reinforced.push(el);
    }
    if (yongShin.gisin.includes(el)) {
      if (!weakened.includes(el)) weakened.push(el);
    }
  }
  const netVerdict: "favorable" | "unfavorable" | "mixed" =
    reinforced.length > 0 && weakened.length === 0 ? "favorable" :
    weakened.length > 0 && reinforced.length === 0 ? "unfavorable" : "mixed";

  return {
    school: "ko",
    targetYear,
    yearGanji,
    currentDaeun: {
      startAge: cur.startAge,
      endAge: cur.endAge,
      ganji: { stem: cur.stem, branch: cur.branch },
    },
    daeunTransition,
    ganjiInteractions: interactions,
    yongShinDelta: { reinforced, weakened, netVerdict },
    schoolSpecificHints: {
      johu: `${yongShin.basisJohuMode} 조후 기준 ${yongShin.secondary ?? "보조 용신 없음"} 보강`,
    },
    shensha: [],  // v0.2 는 결합 신살 skip (v0.3)
    yongShinUsed: yongShin,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd packages/saju && pnpm test ko/yearly -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/ko/yearly.ts \
        packages/saju/src/adapters/ko/yearly.test.ts
git commit -m "feat(saju-tri): KO 년운 어댑터 — 세군 ganji + 대운 전환 + yongShin delta"
```

---

## Task 2.2: CN자평 년운 어댑터 — adapters/cn-ziping/yearly.ts

**Files:**
- Create: `packages/saju/src/adapters/cn-ziping/yearly.ts`
- Test: `packages/saju/src/adapters/cn-ziping/yearly.test.ts`

KO yearly.ts 와 동일 구조, schoolSpecificHints 가 `structureHint` 기반.

- [ ] **Step 1: 실패 테스트**

`packages/saju/src/adapters/cn-ziping/yearly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYearlyCnZiping } from "./yearly";
import { buildYongshinCnZiping } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [
    { startAge: 58, endAge: 67, stem: "丁", branch: "酉" },
  ],
} as unknown as SajuChart;

describe("buildYearlyCnZiping — 2026", () => {
  it("structureHint 가 schoolSpecificHints 에 포함", () => {
    const r = buildYearlyCnZiping({
      chart: canonical1967,
      daeun: canonical1967.majorFortunes,
      targetYear: 2026,
      yongShin: buildYongshinCnZiping(canonical1967),
      currentAge: 59,
    });
    expect(r.school).toBe("cn-ziping");
    expect(r.schoolSpecificHints.structure).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/saju && pnpm test cn-ziping/yearly -- --run`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/saju/src/adapters/cn-ziping/yearly.ts`:

```ts
import type { SajuChart, Stem, Branch, Element, MajorFortune } from "../../types";
import type { CnZipingYongshin } from "../../types/yongshin";
import type { YearlyFrame } from "../../types/yearly";

// (KO yearly.ts 와 동일 상수 — 의도적 중복)
const STEM_ELEMENT: Record<Stem, Element> = {
  甲: "wood", 乙: "wood", 丙: "fire", 丁: "fire",
  戊: "earth", 己: "earth", 庚: "metal", 辛: "metal",
  壬: "water", 癸: "water",
};
const BRANCH_ELEMENT: Record<Branch, Element> = {
  子: "water", 亥: "water", 寅: "wood", 卯: "wood",
  巳: "fire", 午: "fire", 申: "metal", 酉: "metal",
  辰: "earth", 戌: "earth", 丑: "earth", 未: "earth",
};
const STEMS: Stem[] = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCHES: Branch[] = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const BRANCH_CONFLICTS: Partial<Record<Branch, Branch>> = {
  子:"午",午:"子",丑:"未",未:"丑",寅:"申",申:"寅",
  卯:"酉",酉:"卯",辰:"戌",戌:"辰",巳:"亥",亥:"巳",
};
const BRANCH_COMBOS: Partial<Record<Branch, Branch>> = {
  子:"丑",丑:"子",寅:"亥",亥:"寅",卯:"戌",戌:"卯",
  辰:"酉",酉:"辰",巳:"申",申:"巳",午:"未",未:"午",
};

function yearGanjiOf(year: number): { stem: Stem; branch: Branch } {
  const diff = ((year - 1984) % 60 + 60) % 60;
  return { stem: STEMS[diff % 10], branch: BRANCHES[diff % 12] };
}

function findCurrentDaeun(daeun: MajorFortune[], age: number): MajorFortune {
  return daeun.find((d) => age >= d.startAge && age <= d.endAge) ?? daeun[0];
}

function findNextDaeun(daeun: MajorFortune[], cur: MajorFortune): MajorFortune | undefined {
  const i = daeun.indexOf(cur);
  return i >= 0 && i + 1 < daeun.length ? daeun[i + 1] : undefined;
}

export function buildYearlyCnZiping(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  yongShin: CnZipingYongshin;
  currentAge: number;
}): YearlyFrame {
  const { chart, daeun, targetYear, yongShin, currentAge } = args;
  const yearGanji = yearGanjiOf(targetYear);

  const cur = findCurrentDaeun(daeun, currentAge);
  const next = findNextDaeun(daeun, cur);
  const daeunTransition = next && next.startAge === currentAge + 1
    ? { willTransitionAt: next.startAge, nextGanji: { stem: next.stem, branch: next.branch } }
    : null;

  const pillars = [
    { p: "year" as const, b: chart.year.branch },
    { p: "month" as const, b: chart.month.branch },
    { p: "day" as const, b: chart.day.branch },
    { p: "hour" as const, b: chart.hour.branch },
  ];
  const interactions: YearlyFrame["ganjiInteractions"] = [];
  for (const x of pillars) {
    if (BRANCH_CONFLICTS[yearGanji.branch] === x.b) {
      interactions.push({ type: "충", subject: { pillar: x.p, element: x.b }, object: yearGanji.branch });
    }
    if (BRANCH_COMBOS[yearGanji.branch] === x.b) {
      interactions.push({ type: "합", subject: { pillar: x.p, element: x.b }, object: yearGanji.branch });
    }
  }

  const yearStemEl = STEM_ELEMENT[yearGanji.stem];
  const yearBranchEl = BRANCH_ELEMENT[yearGanji.branch];
  const reinforced: Element[] = [];
  const weakened: Element[] = [];
  for (const el of [yearStemEl, yearBranchEl]) {
    if (el === yongShin.primary && !reinforced.includes(el)) reinforced.push(el);
    if (yongShin.gisin.includes(el) && !weakened.includes(el)) weakened.push(el);
  }
  const netVerdict: "favorable" | "unfavorable" | "mixed" =
    reinforced.length > 0 && weakened.length === 0 ? "favorable" :
    weakened.length > 0 && reinforced.length === 0 ? "unfavorable" : "mixed";

  return {
    school: "cn-ziping",
    targetYear,
    yearGanji,
    currentDaeun: {
      startAge: cur.startAge,
      endAge: cur.endAge,
      ganji: { stem: cur.stem, branch: cur.branch },
    },
    daeunTransition,
    ganjiInteractions: interactions,
    yongShinDelta: { reinforced, weakened, netVerdict },
    schoolSpecificHints: { structure: yongShin.structureHint ?? "기타" },
    shensha: [],
    yongShinUsed: yongShin,
  };
}
```

- [ ] **Step 4: 통과**

Run: `cd packages/saju && pnpm test cn-ziping/yearly -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/cn-ziping/yearly.ts \
        packages/saju/src/adapters/cn-ziping/yearly.test.ts
git commit -m "feat(saju-tri): CN자평 년운 어댑터"
```

---

## Task 2.3: CN맹파 년운 어댑터 — adapters/cn-mangpai/yearly.ts

**Files:**
- Create: `packages/saju/src/adapters/cn-mangpai/yearly.ts`
- Test: `packages/saju/src/adapters/cn-mangpai/yearly.test.ts`

응기 시점 강조 — `emergenceHint` 가 schoolSpecificHints 에 포함.

- [ ] **Step 1: 실패 테스트**

`packages/saju/src/adapters/cn-mangpai/yearly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYearlyCnMangpai } from "./yearly";
import { buildYongshinCnMangpai } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [
    { startAge: 58, endAge: 67, stem: "丁", branch: "酉" },
  ],
} as unknown as SajuChart;

describe("buildYearlyCnMangpai — 2026", () => {
  it("emergence hint 가 schoolSpecificHints 에 포함", () => {
    const r = buildYearlyCnMangpai({
      chart: canonical1967,
      daeun: canonical1967.majorFortunes,
      targetYear: 2026,
      yongShin: buildYongshinCnMangpai(canonical1967),
      currentAge: 59,
    });
    expect(r.school).toBe("cn-mangpai");
    expect(r.schoolSpecificHints.emergence).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/saju && pnpm test cn-mangpai/yearly -- --run`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/saju/src/adapters/cn-mangpai/yearly.ts`:

```ts
import type { SajuChart, Stem, Branch, Element, MajorFortune } from "../../types";
import type { CnMangpaiYongshin } from "../../types/yongshin";
import type { YearlyFrame } from "../../types/yearly";

const STEM_ELEMENT: Record<Stem, Element> = {
  甲:"wood",乙:"wood",丙:"fire",丁:"fire",戊:"earth",己:"earth",
  庚:"metal",辛:"metal",壬:"water",癸:"water",
};
const BRANCH_ELEMENT: Record<Branch, Element> = {
  子:"water",亥:"water",寅:"wood",卯:"wood",巳:"fire",午:"fire",
  申:"metal",酉:"metal",辰:"earth",戌:"earth",丑:"earth",未:"earth",
};
const STEMS: Stem[] = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCHES: Branch[] = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const BRANCH_CONFLICTS: Partial<Record<Branch, Branch>> = {
  子:"午",午:"子",丑:"未",未:"丑",寅:"申",申:"寅",
  卯:"酉",酉:"卯",辰:"戌",戌:"辰",巳:"亥",亥:"巳",
};
const BRANCH_COMBOS: Partial<Record<Branch, Branch>> = {
  子:"丑",丑:"子",寅:"亥",亥:"寅",卯:"戌",戌:"卯",
  辰:"酉",酉:"辰",巳:"申",申:"巳",午:"未",未:"午",
};

function yearGanjiOf(y: number): { stem: Stem; branch: Branch } {
  const d = ((y - 1984) % 60 + 60) % 60;
  return { stem: STEMS[d % 10], branch: BRANCHES[d % 12] };
}
function findCurDaeun(daeun: MajorFortune[], age: number): MajorFortune {
  return daeun.find((d) => age >= d.startAge && age <= d.endAge) ?? daeun[0];
}
function findNextDaeun(daeun: MajorFortune[], c: MajorFortune): MajorFortune | undefined {
  const i = daeun.indexOf(c);
  return i >= 0 && i + 1 < daeun.length ? daeun[i + 1] : undefined;
}

export function buildYearlyCnMangpai(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  yongShin: CnMangpaiYongshin;
  currentAge: number;
}): YearlyFrame {
  const { chart, daeun, targetYear, yongShin, currentAge } = args;
  const yearGanji = yearGanjiOf(targetYear);
  const cur = findCurDaeun(daeun, currentAge);
  const next = findNextDaeun(daeun, cur);
  const daeunTransition = next && next.startAge === currentAge + 1
    ? { willTransitionAt: next.startAge, nextGanji: { stem: next.stem, branch: next.branch } }
    : null;

  const pillars = [
    { p: "year" as const, b: chart.year.branch },
    { p: "month" as const, b: chart.month.branch },
    { p: "day" as const, b: chart.day.branch },
    { p: "hour" as const, b: chart.hour.branch },
  ];
  const interactions: YearlyFrame["ganjiInteractions"] = [];
  for (const x of pillars) {
    if (BRANCH_CONFLICTS[yearGanji.branch] === x.b)
      interactions.push({ type: "충", subject: { pillar: x.p, element: x.b }, object: yearGanji.branch });
    if (BRANCH_COMBOS[yearGanji.branch] === x.b)
      interactions.push({ type: "합", subject: { pillar: x.p, element: x.b }, object: yearGanji.branch });
  }

  const yearStemEl = STEM_ELEMENT[yearGanji.stem];
  const yearBranchEl = BRANCH_ELEMENT[yearGanji.branch];
  const reinforced: Element[] = [];
  const weakened: Element[] = [];
  for (const el of [yearStemEl, yearBranchEl]) {
    if (el === yongShin.primary && !reinforced.includes(el)) reinforced.push(el);
    if (yongShin.gisin.includes(el) && !weakened.includes(el)) weakened.push(el);
  }
  const netVerdict: "favorable" | "unfavorable" | "mixed" =
    reinforced.length > 0 && weakened.length === 0 ? "favorable" :
    weakened.length > 0 && reinforced.length === 0 ? "unfavorable" : "mixed";

  return {
    school: "cn-mangpai",
    targetYear,
    yearGanji,
    currentDaeun: {
      startAge: cur.startAge,
      endAge: cur.endAge,
      ganji: { stem: cur.stem, branch: cur.branch },
    },
    daeunTransition,
    ganjiInteractions: interactions,
    yongShinDelta: { reinforced, weakened, netVerdict },
    schoolSpecificHints: { emergence: yongShin.emergenceHint },
    shensha: [],
    yongShinUsed: yongShin,
  };
}
```

- [ ] **Step 4: 통과**

Run: `cd packages/saju && pnpm test cn-mangpai/yearly -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/cn-mangpai/yearly.ts \
        packages/saju/src/adapters/cn-mangpai/yearly.test.ts
git commit -m "feat(saju-tri): CN맹파 년운 어댑터 — 응기 hint 노출"
```

---

## Task 2.4: JP 년운 어댑터 — adapters/jp/yearly.ts

**Files:**
- Create: `packages/saju/src/adapters/jp/yearly.ts`
- Test: `packages/saju/src/adapters/jp/yearly.test.ts`

JP 어댑터는 통변성 favorable/unfavorable 만 다루므로 yongShinDelta 의 reinforced/weakened 가 항상 비어있고 netVerdict 는 `mixed`. schoolSpecificHints 에 favorable/unfavorable 통변성 그대로 노출.

- [ ] **Step 1: 실패 테스트**

`packages/saju/src/adapters/jp/yearly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildYearlyJp } from "./yearly";
import { buildYongshinJp } from "./yongshin";
import type { SajuChart } from "../../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [{ startAge: 58, endAge: 67, stem: "丁", branch: "酉" }],
} as unknown as SajuChart;

describe("buildYearlyJp — 2026", () => {
  it("favorable/unfavorable 통변성 hint 가 schoolSpecificHints 에 포함", () => {
    const r = buildYearlyJp({
      chart: canonical1967,
      daeun: canonical1967.majorFortunes,
      targetYear: 2026,
      yongShin: buildYongshinJp(canonical1967),
      currentAge: 59,
    });
    expect(r.school).toBe("jp");
    expect(r.schoolSpecificHints.favorable).toContain("재성");
    expect(r.schoolSpecificHints.unfavorable).toContain("비겁");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/saju && pnpm test jp/yearly -- --run`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/saju/src/adapters/jp/yearly.ts`:

```ts
import type { SajuChart, Stem, Branch, MajorFortune } from "../../types";
import type { JpYongshin } from "../../types/yongshin";
import type { YearlyFrame } from "../../types/yearly";

const STEMS: Stem[] = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCHES: Branch[] = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const BRANCH_CONFLICTS: Partial<Record<Branch, Branch>> = {
  子:"午",午:"子",丑:"未",未:"丑",寅:"申",申:"寅",
  卯:"酉",酉:"卯",辰:"戌",戌:"辰",巳:"亥",亥:"巳",
};
const BRANCH_COMBOS: Partial<Record<Branch, Branch>> = {
  子:"丑",丑:"子",寅:"亥",亥:"寅",卯:"戌",戌:"卯",
  辰:"酉",酉:"辰",巳:"申",申:"巳",午:"未",未:"午",
};

function yearGanjiOf(y: number): { stem: Stem; branch: Branch } {
  const d = ((y - 1984) % 60 + 60) % 60;
  return { stem: STEMS[d % 10], branch: BRANCHES[d % 12] };
}
function findCur(daeun: MajorFortune[], age: number): MajorFortune {
  return daeun.find((d) => age >= d.startAge && age <= d.endAge) ?? daeun[0];
}
function findNext(daeun: MajorFortune[], c: MajorFortune): MajorFortune | undefined {
  const i = daeun.indexOf(c);
  return i >= 0 && i + 1 < daeun.length ? daeun[i + 1] : undefined;
}

export function buildYearlyJp(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  yongShin: JpYongshin;
  currentAge: number;
}): YearlyFrame {
  const { chart, daeun, targetYear, yongShin, currentAge } = args;
  const yearGanji = yearGanjiOf(targetYear);
  const cur = findCur(daeun, currentAge);
  const next = findNext(daeun, cur);
  const daeunTransition = next && next.startAge === currentAge + 1
    ? { willTransitionAt: next.startAge, nextGanji: { stem: next.stem, branch: next.branch } }
    : null;

  const pillars = [
    { p: "year" as const, b: chart.year.branch },
    { p: "month" as const, b: chart.month.branch },
    { p: "day" as const, b: chart.day.branch },
    { p: "hour" as const, b: chart.hour.branch },
  ];
  const interactions: YearlyFrame["ganjiInteractions"] = [];
  for (const x of pillars) {
    if (BRANCH_CONFLICTS[yearGanji.branch] === x.b)
      interactions.push({ type: "충", subject: { pillar: x.p, element: x.b }, object: yearGanji.branch });
    if (BRANCH_COMBOS[yearGanji.branch] === x.b)
      interactions.push({ type: "합", subject: { pillar: x.p, element: x.b }, object: yearGanji.branch });
  }

  return {
    school: "jp",
    targetYear,
    yearGanji,
    currentDaeun: {
      startAge: cur.startAge,
      endAge: cur.endAge,
      ganji: { stem: cur.stem, branch: cur.branch },
    },
    daeunTransition,
    ganjiInteractions: interactions,
    yongShinDelta: { reinforced: [], weakened: [], netVerdict: "mixed" },
    schoolSpecificHints: {
      favorable: yongShin.favorable.join("·"),
      unfavorable: yongShin.unfavorable.join("·"),
    },
    shensha: [],
    yongShinUsed: yongShin,
  };
}
```

- [ ] **Step 4: 통과**

Run: `cd packages/saju && pnpm test jp/yearly -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/saju/src/adapters/jp/yearly.ts \
        packages/saju/src/adapters/jp/yearly.test.ts
git commit -m "feat(saju-tri): JP 년운 어댑터 — 통변성 hint 노출"
```

---

## Task 3.1: compose/yearly.ts — TriNationYearly + crossCheck

**Files:**
- Create: `packages/saju/src/compose/yearly.ts`
- Test: `packages/saju/src/compose/yearly.test.ts`
- Modify: `packages/saju/src/index.ts` — `buildTriNationYearly`, 4학파 yongshin/yearly 함수 export

- [ ] **Step 1: 실패 테스트**

`packages/saju/src/compose/yearly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTriNationYearly } from "./yearly";
import type { SajuChart } from "../types";

const canonical1967 = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [{ startAge: 58, endAge: 67, stem: "丁", branch: "酉" }],
} as unknown as SajuChart;

describe("buildTriNationYearly — 2026", () => {
  it("4학파 frame 모두 생성 + crossCheck 평가", () => {
    const t = buildTriNationYearly({
      chart: canonical1967,
      daeun: canonical1967.majorFortunes,
      targetYear: 2026,
      currentAge: 59,
    });
    expect(t.targetYear).toBe(2026);
    expect(t.frames.ko.school).toBe("ko");
    expect(t.frames.cnZiping.school).toBe("cn-ziping");
    expect(t.frames.cnMangpai.school).toBe("cn-mangpai");
    expect(t.frames.jp.school).toBe("jp");
    expect(["high", "medium", "low"]).toContain(t.crossCheck.agreement);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/saju && pnpm test compose/yearly -- --run`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/saju/src/compose/yearly.ts`:

```ts
import type { SajuChart, MajorFortune } from "../types";
import type { TriNationYearly } from "../types/yearly";
import { buildYongshinKo } from "../adapters/ko/yongshin";
import { buildYearlyKo } from "../adapters/ko/yearly";
import { buildYongshinCnZiping } from "../adapters/cn-ziping/yongshin";
import { buildYearlyCnZiping } from "../adapters/cn-ziping/yearly";
import { buildYongshinCnMangpai } from "../adapters/cn-mangpai/yongshin";
import { buildYearlyCnMangpai } from "../adapters/cn-mangpai/yearly";
import { buildYongshinJp } from "../adapters/jp/yongshin";
import { buildYearlyJp } from "../adapters/jp/yearly";

function evaluateAgreement(frames: TriNationYearly["frames"]): {
  agreement: "high" | "medium" | "low";
  notes: string[];
} {
  // 결정형 학파 3개(KO, CN자평, CN맹파)의 netVerdict 만 집계 — JP 는 항상 mixed.
  const verdicts = [
    frames.ko.yongShinDelta.netVerdict,
    frames.cnZiping.yongShinDelta.netVerdict,
    frames.cnMangpai.yongShinDelta.netVerdict,
  ];
  const favorableCount = verdicts.filter((v) => v === "favorable").length;
  const unfavorableCount = verdicts.filter((v) => v === "unfavorable").length;

  const notes: string[] = [];
  if (favorableCount === 3) {
    notes.push("KO·CN자평·CN맹파 3학파가 favorable 합의");
    return { agreement: "high", notes };
  }
  if (unfavorableCount === 3) {
    notes.push("KO·CN자평·CN맹파 3학파가 unfavorable 합의");
    return { agreement: "high", notes };
  }
  if (favorableCount === 2 || unfavorableCount === 2) {
    notes.push(`3학파 중 2학파 동의 (favorable=${favorableCount}, unfavorable=${unfavorableCount})`);
    return { agreement: "medium", notes };
  }
  notes.push("학파별 판단 분기 — LLM narrative 로 학파별 입장 확인 권장");
  return { agreement: "low", notes };
}

export function buildTriNationYearly(args: {
  chart: SajuChart;
  daeun: MajorFortune[];
  targetYear: number;
  currentAge: number;
}): TriNationYearly {
  const { chart, daeun, targetYear, currentAge } = args;

  const yongKo = buildYongshinKo(chart);
  const yongCz = buildYongshinCnZiping(chart);
  const yongCm = buildYongshinCnMangpai(chart);
  const yongJp = buildYongshinJp(chart);

  const frames: TriNationYearly["frames"] = {
    ko: buildYearlyKo({ chart, daeun, targetYear, yongShin: yongKo, currentAge }),
    cnZiping: buildYearlyCnZiping({ chart, daeun, targetYear, yongShin: yongCz, currentAge }),
    cnMangpai: buildYearlyCnMangpai({ chart, daeun, targetYear, yongShin: yongCm, currentAge }),
    jp: buildYearlyJp({ chart, daeun, targetYear, yongShin: yongJp, currentAge }),
  };

  return {
    targetYear,
    frames,
    crossCheck: evaluateAgreement(frames),
  };
}
```

- [ ] **Step 4: index.ts re-export**

`packages/saju/src/index.ts` 마지막에:

```ts
export { buildYongshinKo } from "./adapters/ko/yongshin";
export { buildYearlyKo } from "./adapters/ko/yearly";
export { buildYongshinCnZiping } from "./adapters/cn-ziping/yongshin";
export { buildYearlyCnZiping } from "./adapters/cn-ziping/yearly";
export { buildYongshinCnMangpai } from "./adapters/cn-mangpai/yongshin";
export { buildYearlyCnMangpai } from "./adapters/cn-mangpai/yearly";
export { buildYongshinJp } from "./adapters/jp/yongshin";
export { buildYearlyJp } from "./adapters/jp/yearly";
export { buildTriNationYearly } from "./compose/yearly";
```

- [ ] **Step 5: 통과 + typecheck**

Run: `cd packages/saju && pnpm test compose/yearly -- --run && pnpm exec tsc --noEmit`
Expected: PASS + 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/saju/src/compose/yearly.ts \
        packages/saju/src/compose/yearly.test.ts \
        packages/saju/src/index.ts
git commit -m "feat(saju-tri): compose/yearly — TriNationYearly + crossCheck"
```

---

## Task 4.1: API 결정형 frame — /api/saju/yearly/[profileId]

**Files:**
- Create: `apps/dashboard/src/features/saju-tri-yearly/api/yearly-server.ts`
- Create: `apps/dashboard/src/app/api/saju/yearly/[profileId]/route.ts`
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/api/lifetime-server.ts` — `rawChart` + `inputHash` 반환 확장

`getOrBuildYearly()` — cache key (profile_id, school='compose', target_year, input_hash, schema_version=1). 입력 input_hash 에는 lifetime input_hash 를 포함해 lifetime 변경 시 자동 무효화.

- [ ] **Step 1: lifetime-server.ts 반환 확장**

Run: `grep -n "rawChart\|inputHash" apps/dashboard/src/features/saju-lifetime-tri/api/lifetime-server.ts`

`getOrBuildLifetime` 의 반환 객체에 `rawChart`, `inputHash` 두 필드가 포함되어 있지 않으면 추가. 기존 호출자(narrative route, SajuTriLifetime widget) 는 `{ triNation }` 만 사용하므로 추가 필드를 무시하면 영향 없음.

수정 후 함수 끝부분이 다음과 같아야 함:

```ts
return {
  triNation,              // 기존
  rawChart: chart,        // 추가 — yearly-server.ts 가 import 해서 사용
  inputHash,              // 추가 — yearly-server.ts 가 cascade 키에 사용
};
```

`chart` 와 `inputHash` 는 같은 함수 안에 이미 지역 변수로 존재. 없으면 build path 와 cache hit path 두 곳 모두에서 정의해 동일하게 반환.

- [ ] **Step 2: yearly-server.ts 작성**

`apps/dashboard/src/features/saju-tri-yearly/api/yearly-server.ts`:

```ts
// Saju 삼국 분석 v0.2 — 년운 캐시/빌더 서버 헬퍼.
//
// 정책:
//  - 캐시 키: (profile_id, school='compose', target_year, input_hash, schema_version=1)
//  - input_hash: targetYear + lifetime input_hash 결합의 sha256
//  - lifetime cache 가 schema_version bump 되면 input_hash 가 달라져 yearly 도 자동 무효화

import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  buildTriNationYearly,
  type TriNationYearly,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles, sajuYearlyTri } from "@/shared/lib/db/schema";
import {
  getOrBuildLifetime,
  ProfileNotFoundError,
  LifetimeBuildError,
} from "@/features/saju-lifetime-tri/api/lifetime-server";

const SCHEMA_VERSION = 1;
const SCHOOL = "compose";

/** KST 기준 현재 연도 (서버 TZ=Asia/Seoul 이므로 그대로 사용) */
export function currentKstYear(): number {
  return new Date().getFullYear();
}

/** 만 나이 — birthDate (YYYY-MM-DD KST) 와 오늘 기반 */
function calcAge(birthDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - by;
  const m = today.getMonth() + 1 - bm;
  if (m < 0 || (m === 0 && today.getDate() < bd)) age--;
  return age;
}

function hashInput(parts: (string | number)[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export async function getOrBuildYearly(
  profileId: string,
  userId: string,
  targetYear: number,
): Promise<TriNationYearly> {
  const profile = await db.query.fortuneProfiles.findFirst({
    where: and(eq(fortuneProfiles.id, profileId), eq(fortuneProfiles.userId, userId)),
  });
  if (!profile) throw new ProfileNotFoundError();

  const lifetime = await getOrBuildLifetime(profileId, userId);
  const chart = lifetime.rawChart;
  const daeun = chart.majorFortunes;
  const currentAge = calcAge(profile.birthDate);

  const inputHash = hashInput([
    profileId,
    targetYear,
    lifetime.inputHash,
    SCHEMA_VERSION,
  ]);

  // 캐시 조회
  const cached = await db.query.sajuYearlyTri.findFirst({
    where: and(
      eq(sajuYearlyTri.profileId, profileId),
      eq(sajuYearlyTri.school, SCHOOL),
      eq(sajuYearlyTri.targetYear, targetYear),
      eq(sajuYearlyTri.inputHash, inputHash),
      eq(sajuYearlyTri.schemaVersion, SCHEMA_VERSION),
    ),
  });
  if (cached) return cached.frameJsonb;

  // miss → build
  let frame: TriNationYearly;
  try {
    frame = buildTriNationYearly({ chart, daeun, targetYear, currentAge });
  } catch (e) {
    throw new LifetimeBuildError(
      e instanceof Error ? e.message : "YEARLY_BUILD_FAILED",
    );
  }

  // 캐시 저장
  await db
    .insert(sajuYearlyTri)
    .values({
      profileId,
      school: SCHOOL,
      targetYear,
      inputHash,
      schemaVersion: SCHEMA_VERSION,
      frameJsonb: frame,
    })
    .onConflictDoNothing();

  return frame;
}
```

- [ ] **Step 3: route 파일**

`apps/dashboard/src/app/api/saju/yearly/[profileId]/route.ts`:

```ts
// GET /api/saju/yearly/[profileId]?year=2026
//
// - auth 필수
// - year 쿼리는 KST 현재 연도와 동일해야 (v0.2 한정) — 다르면 400 INVALID_YEAR
// - 에러: 401 / 400 / 404 / 422 / 500
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  ProfileNotFoundError,
  LifetimeBuildError,
} from "@/features/saju-lifetime-tri/api/lifetime-server";
import {
  currentKstYear,
  getOrBuildYearly,
} from "@/features/saju-tri-yearly/api/yearly-server";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId } = await ctx.params;
  const yearParam = new URL(req.url).searchParams.get("year");
  const targetYear = yearParam ? Number(yearParam) : currentKstYear();
  if (!Number.isInteger(targetYear) || targetYear !== currentKstYear()) {
    return NextResponse.json({ error: "INVALID_YEAR" }, { status: 400 });
  }

  try {
    const frame = await getOrBuildYearly(profileId, session.user.id, targetYear);
    return NextResponse.json(frame);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
    }
    if (err instanceof LifetimeBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[saju/yearly] build error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
```

- [ ] **Step 4: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS / PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/saju-tri-yearly/api/yearly-server.ts \
        apps/dashboard/src/app/api/saju/yearly/[profileId]/route.ts \
        apps/dashboard/src/features/saju-lifetime-tri/api/lifetime-server.ts
git commit -m "feat(saju-tri): /api/saju/yearly/[profileId] — 결정형 frame 캐시"
```

---

## Task 4.2: API narrative — /api/saju/yearly/[profileId]/narrative

**Files:**
- Create: `apps/dashboard/src/features/saju-tri-yearly/api/narrative-server.ts`
- Create: `apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts`
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/lib/errorMessage.ts` — `INVALID_YEAR` 매핑 추가
- Modify: `apps/dashboard/src/features/saju-lifetime-tri/lib/errorMessage.test.ts` — 1 case 추가

핵심: PR #76 패턴 — user message 본문에 JSON 스키마 지시.

- [ ] **Step 1: errorMessage.ts 확장**

`apps/dashboard/src/features/saju-lifetime-tri/lib/errorMessage.ts` 의 `EXACT_MAP` 에 추가:

```ts
INVALID_YEAR: "지원하지 않는 연도입니다.",
```

테스트 파일에 1 case 추가:

```ts
it("INVALID_YEAR → 한국어 안내", () => {
  expect(toUserMessage("INVALID_YEAR")).toBe("지원하지 않는 연도입니다.");
});
```

Run: `cd apps/dashboard && pnpm test errorMessage -- --run`
Expected: 15 → 16 case 통과

- [ ] **Step 2: yearly narrative-server.ts 작성**

`apps/dashboard/src/features/saju-tri-yearly/api/narrative-server.ts`:

```ts
// Saju 삼국 분석 v0.2 — 년운 LLM narrative 빌더/캐시 서버 헬퍼.
//
// PR #76 패턴 — user message 본문에 JSON 스키마 지시 (cli-proxy-api 호환).
// extractJsonObject 는 v0.1 lifetime narrative-server 의 헬퍼를 재사용.
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { YearlyFrame } from "@gons/saju";
import { env } from "@/shared/config/env";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { db } from "@/shared/lib/db/client";
import {
  sajuYearlyNarrative,
  type NarrativeSections,
} from "@/shared/lib/db/schema";
import { extractJsonObject } from "@/features/saju-lifetime-tri/api/narrative-server";

const MODEL_ID = env.SAJU_LLM_MODEL;
const MAX_NARRATIVE_TOKENS = 4096;

export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

const SCHOOL_PROMPT: Record<NarrativeSchool, string> = {
  ko: "한국식 자평+조후+신살 관점. 박재완·박청화 톤. 세군 충합형해 + 조후 변화 중심.",
  "cn-ziping": "중국 자평진전·적천수 원전 톤. 세군과 격국·용신 상호작용 중심.",
  "cn-mangpai": "중국 맹파 단건업 체계 톤. 세군 응기 분기 + 사건성 중심.",
  jp: "일본 추명학 톤. 통변성·12궁 중심, 세군 처세 위주.",
};

const narrativeOutputSchema = z.object({
  narrativeText: z.string(),
  sections: z.object({
    personality: z.string(),
    career: z.string(),
    relationship: z.string(),
    health: z.string(),
    daeunSummary: z.string(),
  }),
  citations: z.array(z.string()),
});

export interface YearlyNarrativeResult {
  school: NarrativeSchool;
  narrativeText: string;
  sections: NarrativeSections;
  citations: string[];
  modelId: string;
  generatedAt: string;
  fromCache: boolean;
}

export async function getOrBuildYearlyNarrative(
  profileId: string,
  school: NarrativeSchool,
  targetYear: number,
  frame: YearlyFrame,
): Promise<YearlyNarrativeResult> {
  const frameHash = createHash("sha256")
    .update(JSON.stringify(frame))
    .digest("hex");

  const cached = await db.query.sajuYearlyNarrative.findFirst({
    where: and(
      eq(sajuYearlyNarrative.profileId, profileId),
      eq(sajuYearlyNarrative.school, school),
      eq(sajuYearlyNarrative.targetYear, targetYear),
      eq(sajuYearlyNarrative.frameHash, frameHash),
      eq(sajuYearlyNarrative.modelId, MODEL_ID),
    ),
  });
  if (cached) {
    return {
      school,
      narrativeText: cached.narrativeText,
      sections: cached.sectionsJsonb,
      citations: cached.citations,
      modelId: cached.modelId,
      generatedAt: cached.generatedAt.toISOString(),
      fromCache: true,
    };
  }

  // miss → LLM 호출 (PR #76 패턴 — user message 본문에 JSON 지시)
  const systemPrompt = `당신은 ${SCHOOL_PROMPT[school]} 학파 사주 명리학자입니다.
${targetYear}년 세운(歲運) 분석을 한국어로 작성하세요.`;

  const userContent = `세운 분석 input:\n${JSON.stringify(frame, null, 2)}

위 ${targetYear}년 세운 frame 을 다음 JSON 스키마로만 답하세요. 마크다운 헤더, 펜스, prose 설명, 인사말 모두 금지. '{' 로 시작해서 '}' 로 끝나는 JSON 본문만 출력:
{"narrativeText":"올해 흐름 전체 5문단","sections":{"personality":"성격 흐름","career":"직업 변화","relationship":"관계 흐름","health":"건강 주의","daeunSummary":"대운 전환 의미"},"citations":["출처1","출처2"]}`;

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
  const parsed = narrativeOutputSchema.parse(json);

  await db
    .insert(sajuYearlyNarrative)
    .values({
      profileId,
      school,
      targetYear,
      frameHash,
      modelId: MODEL_ID,
      narrativeText: parsed.narrativeText,
      sectionsJsonb: parsed.sections,
      citations: parsed.citations,
    })
    .onConflictDoNothing();

  return {
    school,
    narrativeText: parsed.narrativeText,
    sections: parsed.sections,
    citations: parsed.citations,
    modelId: MODEL_ID,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}
```

`extractJsonObject` 는 v0.1 narrative-server.ts 에서 이미 export 되어 있음을 확인:

Run: `grep "^export function extractJsonObject" apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts`
Expected: 한 줄 출력

- [ ] **Step 3: route 파일**

`apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts`:

```ts
// GET /api/saju/yearly/[profileId]/narrative?school=ko&year=2026
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import {
  ProfileNotFoundError,
  LifetimeBuildError,
} from "@/features/saju-lifetime-tri/api/lifetime-server";
import {
  currentKstYear,
  getOrBuildYearly,
} from "@/features/saju-tri-yearly/api/yearly-server";
import {
  getOrBuildYearlyNarrative,
  type NarrativeSchool,
} from "@/features/saju-tri-yearly/api/narrative-server";
import { checkRateLimit } from "@/shared/lib/llm/rateLimit";

const SCHOOL_FRAME_KEY = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
} as const;

type SchoolParam = keyof typeof SCHOOL_FRAME_KEY;

function isSchoolParam(v: string | null): v is SchoolParam {
  return v !== null && v in SCHOOL_FRAME_KEY;
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
  const url = new URL(req.url);
  const schoolParam = url.searchParams.get("school");
  if (!isSchoolParam(schoolParam)) {
    return NextResponse.json({ error: "INVALID_SCHOOL" }, { status: 400 });
  }

  const yearParam = url.searchParams.get("year");
  const targetYear = yearParam ? Number(yearParam) : currentKstYear();
  if (!Number.isInteger(targetYear) || targetYear !== currentKstYear()) {
    return NextResponse.json({ error: "INVALID_YEAR" }, { status: 400 });
  }

  // rate limit — lifetime narrative 와 같은 keyspace
  const rate = await checkRateLimit(session.user.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMIT", retryAfterMs: rate.retryAfterMs },
      { status: 429 },
    );
  }

  try {
    const tri = await getOrBuildYearly(profileId, session.user.id, targetYear);
    const frame = tri.frames[SCHOOL_FRAME_KEY[schoolParam]];
    const school: NarrativeSchool = schoolParam;
    const result = await getOrBuildYearlyNarrative(
      profileId,
      school,
      targetYear,
      frame,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
    }
    if (err instanceof LifetimeBuildError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[saju/yearly/narrative] LLM error:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
```

- [ ] **Step 4: typecheck + lint + 단위 테스트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm test errorMessage -- --run`
Expected: PASS / PASS / 16 case PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/saju-tri-yearly/api/narrative-server.ts \
        apps/dashboard/src/app/api/saju/yearly/[profileId]/narrative/route.ts \
        apps/dashboard/src/features/saju-lifetime-tri/lib/errorMessage.ts \
        apps/dashboard/src/features/saju-lifetime-tri/lib/errorMessage.test.ts
git commit -m "feat(saju-tri): /api/saju/yearly/.../narrative + INVALID_YEAR 매핑"
```

---

## Task 5.1: 위젯 server component — SajuTriYearly

**Files:**
- Create: `apps/dashboard/src/widgets/saju-tri-yearly/index.ts`
- Create: `apps/dashboard/src/widgets/saju-tri-yearly/ui/SajuTriYearly.tsx`

v0.1 `SajuTriLifetime` 미러. server component, error 분기 동일.

- [ ] **Step 1: index.ts**

`apps/dashboard/src/widgets/saju-tri-yearly/index.ts`:

```ts
export { SajuTriYearly } from "./ui/SajuTriYearly";
```

- [ ] **Step 2: SajuTriYearly.tsx**

`apps/dashboard/src/widgets/saju-tri-yearly/ui/SajuTriYearly.tsx`:

```tsx
// 삼국 관점 년운(歲運) 위젯 — server component.
// /fortune/[profileId] 페이지 안 SajuTriLifetime 다음에 mount.
import {
  currentKstYear,
  getOrBuildYearly,
} from "@/features/saju-tri-yearly/api/yearly-server";
import { TriYearlyTabs } from "@/features/saju-tri-yearly/ui/TriYearlyTabs";
import { YearlyCrossCheckBadge } from "@/features/saju-tri-yearly/ui/YearlyCrossCheckBadge";
import { toUserMessage } from "@/features/saju-lifetime-tri/lib/errorMessage";

interface Props {
  profileId: string;
  userId: string;
}

export async function SajuTriYearly({ profileId, userId }: Props) {
  const targetYear = currentKstYear();
  const result = await getOrBuildYearly(profileId, userId, targetYear).then(
    (triNation) => ({ ok: true as const, triNation }),
    (e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "INTERNAL_ERROR",
    }),
  );

  if (result.ok) {
    return (
      <section
        aria-labelledby="tri-yearly-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2
          id="tri-yearly-heading"
          className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
        >
          삼국 관점 {targetYear}년 세운
        </h2>
        <div className="space-y-4">
          <YearlyCrossCheckBadge triYearly={result.triNation} />
          <TriYearlyTabs
            profileId={profileId}
            targetYear={targetYear}
            triYearly={result.triNation}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="tri-yearly-error-heading"
      className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
    >
      <h2
        id="tri-yearly-error-heading"
        className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]"
      >
        삼국 관점 {targetYear}년 세운
      </h2>
      <p className="text-sm text-red-600">{toUserMessage(result.error)}</p>
    </section>
  );
}
```

- [ ] **Step 3: typecheck (TriYearlyTabs/YearlyCrossCheckBadge 미존재 에러 예상)**

Run: `cd apps/dashboard && pnpm typecheck 2>&1 | grep "error TS" | head -5`
Expected: 2 error 정도 — Task 5.2/5.3 에서 채움. 일단 commit 보류하고 다음 task 로.

- [ ] **Step 4: Commit 보류**

Task 5.1 단독 commit 은 broken state. 5.2 + 5.3 끝낸 뒤 한꺼번에 add + commit.

---

## Task 5.2: YearlyCrossCheckBadge + YearlyFrameView (presentational)

**Files:**
- Create: `apps/dashboard/src/features/saju-tri-yearly/ui/YearlyCrossCheckBadge.tsx`
- Create: `apps/dashboard/src/features/saju-tri-yearly/ui/YearlyFrameView.tsx`

v0.1 `CrossCheckBadge` 패턴 미러 (디자인 토큰 `--color-surface-2`, amber-700 warn 색상).

- [ ] **Step 1: YearlyCrossCheckBadge.tsx**

```tsx
import type { TriNationYearly } from "@gons/saju";

interface Props {
  triYearly: TriNationYearly;
}

export function YearlyCrossCheckBadge({ triYearly }: Props) {
  const { agreement, notes } = triYearly.crossCheck;
  const icon = agreement === "high" ? "✓" : agreement === "medium" ? "⚠" : "ℹ";
  const colorClass =
    agreement === "high"
      ? "text-[var(--color-text-muted)]"
      : agreement === "medium"
        ? "text-amber-700"
        : "text-[var(--color-text-muted)]";

  return (
    <div
      className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] p-4"
      role="status"
    >
      <p className={`text-sm font-medium ${colorClass}`}>
        {icon} 4학파 합의 수준: {agreement}
      </p>
      {notes.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm text-[var(--color-text-muted)]">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: YearlyFrameView.tsx — presentational**

`apps/dashboard/src/features/saju-tri-yearly/ui/YearlyFrameView.tsx`:

```tsx
import type { YearlyFrame } from "@gons/saju";

interface NarrativeContent {
  narrativeText: string;
  sections: {
    personality: string;
    career: string;
    relationship: string;
    health: string;
    daeunSummary: string;
  };
}

interface Props {
  frame: YearlyFrame;
  narrative?: NarrativeContent | { error: string };
}

export function YearlyFrameView({ frame, narrative }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">
        {frame.targetYear}년 — 세군 {frame.yearGanji.stem}
        {frame.yearGanji.branch}
      </h3>
      <p className="text-sm text-[var(--color-text-muted)]">
        현재 대운: {frame.currentDaeun.ganji.stem}
        {frame.currentDaeun.ganji.branch} ({frame.currentDaeun.startAge}–
        {frame.currentDaeun.endAge}세)
        {frame.daeunTransition && (
          <>
            {" · "}올해 {frame.daeunTransition.willTransitionAt}세 →{" "}
            {frame.daeunTransition.nextGanji.stem}
            {frame.daeunTransition.nextGanji.branch} 대운 전환
          </>
        )}
      </p>

      {frame.ganjiInteractions.length > 0 && (
        <div className="text-sm">
          <span className="font-medium">세군 상호작용:</span>{" "}
          {frame.ganjiInteractions
            .map(
              (i) =>
                `${i.subject.pillar}(${i.subject.element})${i.type}${i.object}`,
            )
            .join(" · ")}
        </div>
      )}

      <div className="text-sm">
        <span className="font-medium">용신 변화:</span>{" "}
        {frame.yongShinDelta.netVerdict}
        {frame.yongShinDelta.reinforced.length > 0 && (
          <> · 강화 {frame.yongShinDelta.reinforced.join("·")}</>
        )}
        {frame.yongShinDelta.weakened.length > 0 && (
          <> · 약화 {frame.yongShinDelta.weakened.join("·")}</>
        )}
      </div>

      {Object.entries(frame.schoolSpecificHints).map(([k, v]) => (
        <div key={k} className="text-sm">
          <span className="font-medium">{k}:</span> {v}
        </div>
      ))}

      {narrative && "narrativeText" in narrative && (
        <div className="mt-4 space-y-2 border-t border-[var(--color-hairline)] pt-3">
          <h4 className="text-sm font-medium">올해 흐름</h4>
          <p className="text-sm leading-relaxed">{narrative.narrativeText}</p>
        </div>
      )}
      {narrative && "error" in narrative && (
        <p className="mt-3 text-sm text-red-600">{narrative.error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: typecheck (TriYearlyTabs 만 미존재)**

Run: `cd apps/dashboard && pnpm typecheck 2>&1 | grep "error TS" | head -5`
Expected: TriYearlyTabs 관련 1 error (다음 task 에서 채움)

---

## Task 5.3: TriYearlyTabs — client component (state lift-up + AbortController)

**Files:**
- Create: `apps/dashboard/src/features/saju-tri-yearly/ui/TriYearlyTabs.tsx`
- Modify: `apps/dashboard/src/app/fortune/[profileId]/page.tsx` — `<SajuTriYearly />` mount

v0.1 G PR (`TriNationTabs`) 패턴 100% 미러 — Record<SchoolKey, NarrativeState> + AbortController + 방향키 a11y + role="tablist/tab/tabpanel".

- [ ] **Step 1: TriYearlyTabs.tsx**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { TriNationYearly } from "@gons/saju";
import { YearlyFrameView } from "./YearlyFrameView";
import { toUserMessage } from "@/features/saju-lifetime-tri/lib/errorMessage";

type SchoolKey = "ko" | "cn-ziping" | "cn-mangpai" | "jp" | "compare";
const SCHOOL_LABELS: Record<SchoolKey, string> = {
  ko: "한국",
  "cn-ziping": "中자평",
  "cn-mangpai": "中맹파",
  jp: "日추명",
  compare: "통합 비교",
};
const FETCHABLE: SchoolKey[] = ["ko", "cn-ziping", "cn-mangpai", "jp"];
const FRAME_KEY: Record<Exclude<SchoolKey, "compare">, keyof TriNationYearly["frames"]> = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
};

interface NarrativeState {
  status: "idle" | "loading" | "ok" | "error";
  narrativeText?: string;
  sections?: { personality: string; career: string; relationship: string; health: string; daeunSummary: string };
  error?: string;
}

interface Props {
  profileId: string;
  targetYear: number;
  triYearly: TriNationYearly;
}

export function TriYearlyTabs({ profileId, targetYear, triYearly }: Props) {
  const [active, setActive] = useState<SchoolKey>("ko");
  const [narratives, setNarratives] = useState<Record<SchoolKey, NarrativeState>>({
    ko: { status: "idle" },
    "cn-ziping": { status: "idle" },
    "cn-mangpai": { status: "idle" },
    jp: { status: "idle" },
    compare: { status: "idle" },
  });
  const abortRefs = useRef<Map<SchoolKey, AbortController>>(new Map());
  const tabRefs = useRef<Map<SchoolKey, HTMLButtonElement>>(new Map());
  const allSchools: SchoolKey[] = ["ko", "cn-ziping", "cn-mangpai", "jp", "compare"];

  function fetchNarrative(school: SchoolKey) {
    if (school === "compare") return;
    if (narratives[school].status !== "idle") return;

    const prev = abortRefs.current.get(school);
    if (prev) prev.abort();
    const ac = new AbortController();
    abortRefs.current.set(school, ac);

    setNarratives((s) => ({ ...s, [school]: { status: "loading" } }));

    void (async () => {
      try {
        const url = `/api/saju/yearly/${encodeURIComponent(profileId)}/narrative?school=${encodeURIComponent(school)}&year=${targetYear}`;
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP_${res.status}`);
        }
        const json = (await res.json()) as {
          narrativeText: string;
          sections: NarrativeState["sections"];
        };
        setNarratives((s) => ({
          ...s,
          [school]: { status: "ok", narrativeText: json.narrativeText, sections: json.sections },
        }));
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        const code = e instanceof Error ? e.message : "INTERNAL_ERROR";
        setNarratives((s) => ({ ...s, [school]: { status: "error", error: toUserMessage(code) } }));
      }
    })();
  }

  useEffect(() => {
    return () => {
      for (const ac of abortRefs.current.values()) ac.abort();
    };
  }, []);

  function onTabClick(school: SchoolKey) {
    setActive(school);
    if (FETCHABLE.includes(school)) fetchNarrative(school);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = allSchools.indexOf(active);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % allSchools.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + allSchools.length) % allSchools.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = allSchools.length - 1;
    else return;
    e.preventDefault();
    onTabClick(allSchools[next]);
    tabRefs.current.get(allSchools[next])?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="학파별 세운" onKeyDown={onKeyDown} className="flex gap-2 border-b border-[var(--color-hairline)]">
        {allSchools.map((s) => (
          <button
            key={s}
            ref={(el) => {
              if (el) tabRefs.current.set(s, el);
            }}
            role="tab"
            id={`tri-yearly-tab-${s}`}
            aria-controls={`tri-yearly-panel-${s}`}
            aria-selected={active === s}
            tabIndex={active === s ? 0 : -1}
            onClick={() => onTabClick(s)}
            className={`px-3 py-2 text-sm ${active === s ? "border-b-2 border-[var(--color-accent)] font-medium" : "text-[var(--color-text-muted)]"}`}
          >
            {SCHOOL_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {allSchools.map((s) => {
          if (s !== active) return null;
          if (s === "compare") {
            return (
              <div
                key={s}
                role="tabpanel"
                id={`tri-yearly-panel-${s}`}
                aria-labelledby={`tri-yearly-tab-${s}`}
                className="space-y-4"
              >
                {(["ko", "cn-ziping", "cn-mangpai", "jp"] as const).map((sc) => (
                  <YearlyFrameView key={sc} frame={triYearly.frames[FRAME_KEY[sc]]} />
                ))}
              </div>
            );
          }
          const frame = triYearly.frames[FRAME_KEY[s]];
          const n = narratives[s];
          const narrative =
            n.status === "ok"
              ? { narrativeText: n.narrativeText!, sections: n.sections! }
              : n.status === "error"
                ? { error: n.error! }
                : undefined;
          return (
            <div
              key={s}
              role="tabpanel"
              id={`tri-yearly-panel-${s}`}
              aria-labelledby={`tri-yearly-tab-${s}`}
            >
              <YearlyFrameView frame={frame} narrative={narrative} />
              {n.status === "loading" && (
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">분석 중…</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: page.tsx 에 위젯 mount**

`apps/dashboard/src/app/fortune/[profileId]/page.tsx` 상단 import 에 추가:

```tsx
import { SajuTriYearly } from "@/widgets/saju-tri-yearly";
```

JSX 의 `<SajuTriLifetime ... />` 바로 다음 줄에:

```tsx
<SajuTriLifetime profileId={profileId} userId={session.user.id} />
<SajuTriYearly profileId={profileId} userId={session.user.id} />
```

- [ ] **Step 3: typecheck + lint + 모든 단위 테스트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm test -- --run`
Expected: PASS / PASS / 모든 case PASS

- [ ] **Step 4: Commit (Task 5.1 + 5.2 + 5.3 한꺼번에)**

```bash
git add apps/dashboard/src/widgets/saju-tri-yearly \
        apps/dashboard/src/features/saju-tri-yearly \
        apps/dashboard/src/app/fortune/[profileId]/page.tsx
git commit -m "feat(saju-tri): v0.2 년운 UI 위젯 + /fortune/[profileId] mount"
```

---

## Task 6.1: Canonical fixture — 본인 사주 2026 세운 골든

**Files:**
- Create: `packages/saju/tests/fixtures/canonical-yearly-2026.json`
- Create: `packages/saju/tests/canonical-yearly.test.ts`
- Create: `packages/saju/tests/scripts/generate-canonical-yearly.ts`

목적: 4학파 어댑터 변경 시 본인 사주 (1967-03-29) 2026 세운 frame 회귀 감지.

- [ ] **Step 1: 골든 frame 생성 스크립트 작성**

`packages/saju/tests/scripts/generate-canonical-yearly.ts`:

```ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTriNationYearly } from "../../src/compose/yearly";
import type { SajuChart } from "../../src/types";

const chart = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [
    { startAge: 8, endAge: 17, stem: "壬", branch: "寅" },
    { startAge: 18, endAge: 27, stem: "辛", branch: "丑" },
    { startAge: 28, endAge: 37, stem: "庚", branch: "子" },
    { startAge: 38, endAge: 47, stem: "己", branch: "亥" },
    { startAge: 48, endAge: 57, stem: "戊", branch: "戌" },
    { startAge: 58, endAge: 67, stem: "丁", branch: "酉" },
    { startAge: 68, endAge: 77, stem: "丙", branch: "申" },
  ],
} as unknown as SajuChart;

const tri = buildTriNationYearly({
  chart,
  daeun: chart.majorFortunes,
  targetYear: 2026,
  currentAge: 59,
});

writeFileSync(
  resolve(__dirname, "..", "fixtures", "canonical-yearly-2026.json"),
  JSON.stringify(tri, null, 2) + "\n",
);

console.log("✓ Wrote canonical-yearly-2026.json");
```

- [ ] **Step 2: 스크립트 실행**

Run: `cd packages/saju && pnpm exec tsx tests/scripts/generate-canonical-yearly.ts`
Expected: stdout `✓ Wrote canonical-yearly-2026.json`

생성된 JSON 직접 열어서 검증 — `yearGanji = {stem:"丙", branch:"午"}`, `frames.ko.currentDaeun.ganji = {stem:"丁", branch:"酉"}` 등 기대값 확인.

- [ ] **Step 3: 골든 검증 테스트**

`packages/saju/tests/canonical-yearly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTriNationYearly } from "../src/compose/yearly";
import type { SajuChart, TriNationYearly } from "../src";

const chart = {
  year: { stem: "丁", branch: "未" },
  month: { stem: "癸", branch: "卯" },
  day: { stem: "壬", branch: "辰" },
  hour: { stem: "癸", branch: "卯" },
  majorFortunes: [
    { startAge: 8, endAge: 17, stem: "壬", branch: "寅" },
    { startAge: 18, endAge: 27, stem: "辛", branch: "丑" },
    { startAge: 28, endAge: 37, stem: "庚", branch: "子" },
    { startAge: 38, endAge: 47, stem: "己", branch: "亥" },
    { startAge: 48, endAge: 57, stem: "戊", branch: "戌" },
    { startAge: 58, endAge: 67, stem: "丁", branch: "酉" },
    { startAge: 68, endAge: 77, stem: "丙", branch: "申" },
  ],
} as unknown as SajuChart;

describe("canonical 1967 — 2026 세운 골든", () => {
  it("규약: 4학파 frame + crossCheck 가 fixture 와 일치", () => {
    const fresh = buildTriNationYearly({
      chart,
      daeun: chart.majorFortunes,
      targetYear: 2026,
      currentAge: 59,
    });
    const golden: TriNationYearly = JSON.parse(
      readFileSync(
        resolve(__dirname, "fixtures", "canonical-yearly-2026.json"),
        "utf8",
      ),
    );
    expect(fresh).toEqual(golden);
  });
});
```

Run: `cd packages/saju && pnpm test canonical-yearly -- --run`
Expected: PASS (1/1)

- [ ] **Step 4: Commit**

```bash
git add packages/saju/tests/fixtures/canonical-yearly-2026.json \
        packages/saju/tests/canonical-yearly.test.ts \
        packages/saju/tests/scripts/generate-canonical-yearly.ts
git commit -m "test(saju-tri): v0.2 canonical 1967 2026 세운 골든 frame"
```

---

## Task 6.2: 회귀 fixture 10건 + 전체 검증

**Files:**
- Create: `packages/saju/tests/fixtures/yearly-regression-10.json`
- Create: `packages/saju/tests/yearly-regression.test.ts`
- Create: `packages/saju/tests/scripts/generate-yearly-regression.ts`

100건 부담이면 10건으로 시작 (v0.3 확장).

- [ ] **Step 1: 회귀 fixture 생성 스크립트**

`packages/saju/tests/scripts/generate-yearly-regression.ts`:

```ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTriNationYearly } from "../../src/compose/yearly";
import type { SajuChart, Stem, Branch } from "../../src/types";

const STEMS: Stem[] = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCHES: Branch[] = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];

const charts: SajuChart[] = Array.from({ length: 10 }, (_, i) => ({
  year: { stem: STEMS[i % 10], branch: BRANCHES[i % 12] },
  month: { stem: STEMS[(i + 3) % 10], branch: BRANCHES[(i + 5) % 12] },
  day: { stem: STEMS[(i + 7) % 10], branch: BRANCHES[(i + 2) % 12] },
  hour: { stem: STEMS[(i + 1) % 10], branch: BRANCHES[(i + 8) % 12] },
  majorFortunes: [
    { startAge: 50, endAge: 59, stem: STEMS[i % 10], branch: BRANCHES[(i + 4) % 12] },
  ],
})) as unknown as SajuChart[];

const golden = charts.map((c) => ({
  chart: c,
  yearly: buildTriNationYearly({
    chart: c,
    daeun: c.majorFortunes,
    targetYear: 2026,
    currentAge: 55,
  }),
}));

writeFileSync(
  resolve(__dirname, "..", "fixtures", "yearly-regression-10.json"),
  JSON.stringify(golden, null, 2) + "\n",
);

console.log("✓ Wrote yearly-regression-10.json (10 charts)");
```

Run: `cd packages/saju && pnpm exec tsx tests/scripts/generate-yearly-regression.ts`
Expected: stdout `✓ Wrote ...`

- [ ] **Step 2: 회귀 테스트**

`packages/saju/tests/yearly-regression.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTriNationYearly } from "../src/compose/yearly";
import type { SajuChart, TriNationYearly } from "../src";

describe("yearly regression — 10 charts × 2026 세운", () => {
  const golden: { chart: SajuChart; yearly: TriNationYearly }[] = JSON.parse(
    readFileSync(
      resolve(__dirname, "fixtures", "yearly-regression-10.json"),
      "utf8",
    ),
  );

  it.each(golden.map((g, i) => [i, g] as const))(
    "chart #%i 의 2026 세운 frame 회귀 검증",
    (_i, g) => {
      const fresh = buildTriNationYearly({
        chart: g.chart,
        daeun: g.chart.majorFortunes,
        targetYear: 2026,
        currentAge: 55,
      });
      expect(fresh).toEqual(g.yearly);
    },
  );
});
```

Run: `cd packages/saju && pnpm test yearly-regression -- --run`
Expected: 10/10 PASS

- [ ] **Step 3: 전체 검증**

Run:
```bash
cd packages/saju && pnpm exec tsc --noEmit && pnpm test -- --run
cd ../../apps/dashboard && pnpm typecheck && pnpm lint && pnpm test -- --run
```
Expected: 모두 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/saju/tests/fixtures/yearly-regression-10.json \
        packages/saju/tests/yearly-regression.test.ts \
        packages/saju/tests/scripts/generate-yearly-regression.ts
git commit -m "test(saju-tri): v0.2 년운 회귀 fixture 10건 + 검증 테스트"
```

---

## Task 7.1: 통합 PR + DB 마이그레이션 + 운영 배포

**Files:** (PR 본문 작성)

- [ ] **Step 1: 모든 검증 일괄 통과 확인**

Run:
```bash
cd packages/saju && pnpm exec tsc --noEmit && pnpm test -- --run
cd ../../apps/dashboard && pnpm typecheck && pnpm lint && pnpm test -- --run
cd ../.. && pnpm build  # 또는 운영 production build 검증 명령
```
Expected: 전부 PASS

- [ ] **Step 2: branch 정리 + PR 생성**

```bash
git push -u origin <feature-branch>
gh pr create --title "feat(saju-tri): v0.2 년운(歲運) + 용신 구현" \
  --body "Spec: docs/superpowers/specs/2026-05-18-saju-tri-yearly-design.md
Plan: docs/superpowers/plans/2026-05-18-saju-tri-yearly-implementation.md
Acceptance: spec §11 7개 항목 매핑 (이 plan §종료 참고)"
```

- [ ] **Step 3: CI 통과 대기**

Run: `gh pr checks <num>` — Lint & Type Check + Build & Push Docker Images 모두 SUCCESS 확인.

- [ ] **Step 4: squash merge**

Run: `gh pr merge <num> --squash --delete-branch`

- [ ] **Step 5: DB 마이그레이션 — 운영**

⚠ 운영 DB 향이므로 `I_KNOW_THIS_IS_PROD=1` 가드 필요 (CLAUDE.md):

Run: `I_KNOW_THIS_IS_PROD=1 pnpm db:migrate` (또는 등가)

Expected: `0012_saju_tri_yearly.sql` 적용 → 2 신규 테이블 생성

- [ ] **Step 6: Docker 이미지 갱신 + 컨테이너 재기동**

```bash
COMPOSE=/home/gon/projects/gon/gons-dashboard/docker-compose.yml
docker --context home-server compose -f "$COMPOSE" pull app cron
docker --context home-server compose -f "$COMPOSE" up -d app cron
```

- [ ] **Step 7: docker-deploy-verify 4단계**

(memory: `docker-deploy-verify-pattern.md`)

```bash
# 1. image SHA 변경
docker --context home-server image inspect ghcr.io/krdn/gons-dashboard:latest --format '{{.Id}}'

# 2. GHA run 매핑 (PR head commit ↔ main HEAD)
gh run list --branch main --limit 1

# 3. 빌드 산출물 grep (v0.2 신규 함수)
docker --context home-server exec gons-dashboard-app sh -c \
  "find apps -path '*/node_modules' -prune -o -name '*.js' -print | xargs grep -l 'buildTriNationYearly' | head -3"

# 4. API 응답
ssh gon@192.168.0.5 "curl -s -o /dev/null -w '%{http_code}' http://localhost:3020/api/health"
# expected 200
ssh gon@192.168.0.5 "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3020/api/saju/yearly/dummy?year=2026'"
# expected 401 (auth required)
```

Expected: 4단계 모두 PASS

- [ ] **Step 8: 사용자 검증 (외부 영역)**

운영 https://gons.krdn.kr/fortune/[본인 profileId] 진입 → SajuTriYearly 위젯 표시 → 학파 탭 클릭 → narrative LLM 응답 표시 확인.

PR #72~#76 패턴과 다른 새 에러를 보이면 진단 PR 추가 (이 plan 외 폴리시 작업).

---

## 종료 — Acceptance Criteria 매핑

| Spec §11 Criterion | 검증 Task |
|---|---|
| 1. 본인 사주 진입 시 v0.1 평생운 아래에 v0.2 년운 위젯 표시 | Task 5.3 Step 2 + Task 7.1 Step 8 |
| 2. 4학파 frame + crossCheck 배지 표시 | Task 3.1 Step 3 + Task 5.2 Step 1 |
| 3. 학파별 narrative lazy + 캐시 hit < 50ms | Task 4.2 Step 2 + Task 5.3 Step 1 (lazy fetch) |
| 4. 1967 fixture 2026 세운 골든 회귀 PASS | Task 6.1 Step 3 |
| 5. typecheck / lint / test 통과 | Task 6.2 Step 3 + Task 7.1 Step 1 |
| 6. 4학파 어댑터 chart.yongSin null 아님 (TODO v0.2 해소) | follow-up PR (아래 참고) |
| 7. 운영 narrative API 200 응답 확인 | Task 7.1 Step 7~8 |

**Follow-up Task 8.1 (이 plan 외, 후속 PR 1개):**

본 plan 의 Task 1.x 는 `yongshin.ts` 모듈을 분리해 yearly.ts 가 직접 import 한다. lifetime.ts 의 `LifetimeFrame.yongshin` 필드는 여전히 미주입 (`undefined`).

후속 PR 에서 4학파 `lifetime.ts` 각각 `buildYongshin{school}(chart)` 호출 → 반환을 `LifetimeFrame.yongshin` 에 주입 + `cautions[]` 의 "v0.1: 용신 미적용" 문구 제거. 4 파일만 수정, yearly 흐름과 무관한 1개 작은 PR. spec §11 criterion 6 은 이 follow-up PR 머지 후 완전 해소.
