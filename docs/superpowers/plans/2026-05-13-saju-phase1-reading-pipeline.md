# Saju Phase 1 — DB 0007 + `features/saju-reading` 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사주 원국과 5개 섹션 LLM 해설을 영구 캐시하는 데이터 레이어 + 페이지 진입점(`ensureChartAndReadings`) 구축. Phase 2(상세 페이지 UI)가 이 함수 하나만 호출해 차트와 해설을 받도록.

**Architecture:** Drizzle 마이그레이션 0007이 `saju_charts` / `saju_readings` / `llm_spend_log` 3개 테이블 신설. `features/saju-reading` 슬라이스가 차트 계산(`@gons/saju` 위임) + LLM 해설 5개를 `Promise.allSettled`로 병렬 호출 + 영구 캐시 + 일별 KRW 가드. 결정적 계산과 비결정적 LLM은 테이블·코드 모두 분리.

**Tech Stack:** Drizzle ORM + PostgreSQL 16, Anthropic SDK (claude-opus-4-7 via 프록시), Vitest, `@gons/saju` workspace.

**Spec reference:** `docs/superpowers/specs/2026-05-13-saju-detail-design.md` §4, §5, §7, §8, §12 R2, R4.

**Prerequisite:** PR #49 (Phase 0) 머지 완료. main 브랜치에 `@gons/saju` 워크스페이스 존재.

---

## File Structure

```
apps/dashboard/
├── drizzle/
│   ├── 0007_<random_name>.sql            # 신규 — saju_charts, saju_readings, llm_spend_log
│   └── meta/
│       ├── 0007_snapshot.json
│       └── _journal.json
├── src/
│   ├── shared/
│   │   ├── lib/db/schema.ts              # MODIFY — sajuCharts/sajuReadings/llmSpendLog 추가
│   │   └── config/env.ts                 # MODIFY — SAJU_LLM_* Zod
│   ├── entities/saju-chart/              # NEW — 원국 차트 read-side
│   │   ├── api/getSajuChartByProfile.ts
│   │   ├── model/types.ts
│   │   └── index.ts
│   └── features/saju-reading/            # NEW — 차트·해설 생성·캐시 전체
│       ├── api/
│       │   ├── ensureChartAndReadings.ts
│       │   ├── generateChart.ts
│       │   ├── generateReading.ts
│       │   └── revalidateSajuChart.ts
│       ├── lib/
│       │   ├── prompts.ts
│       │   ├── llm-client.ts
│       │   └── budget.ts
│       └── index.ts
└── tests/saju-reading.integration.test.ts
```

각 파일의 단일 책임은 spec §4·§5와 동일.

---

## Task 1: Drizzle 스키마 + 마이그레이션 0007

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts`
- Generate: `apps/dashboard/drizzle/0007_*.sql` + meta (drizzle-kit 자동)

- [ ] **Step 1: schema.ts 끝에 3개 테이블 추가** — 다음 코드 그대로 붙임.

```ts
export const sajuCharts = pgTable(
  "saju_charts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => fortuneProfiles.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    yearStem: text("year_stem").notNull(),
    yearBranch: text("year_branch").notNull(),
    monthStem: text("month_stem").notNull(),
    monthBranch: text("month_branch").notNull(),
    dayStem: text("day_stem").notNull(),
    dayBranch: text("day_branch").notNull(),
    hourStem: text("hour_stem"),
    hourBranch: text("hour_branch"),
    elements: jsonb("elements").notNull().$type<{
      wood: number; fire: number; earth: number; metal: number; water: number;
    }>(),
    strength: text("strength").notNull(),
    tenGods: jsonb("ten_gods").notNull(),
    pattern: text("pattern").notNull(),
    yongSin: jsonb("yong_sin").notNull().$type<string[]>(),
    giSin: jsonb("gi_sin").notNull().$type<string[]>(),
    majorFortunes: jsonb("major_fortunes").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saju_charts_profile_idx").on(t.profileId)],
);

export const sajuReadings = pgTable(
  "saju_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => sajuCharts.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    body: text("body").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saju_readings_chart_section_idx").on(t.chartId, t.section),
  ],
);

export const llmSpendLog = pgTable(
  "llm_spend_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    krw: numeric("krw", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("llm_spend_log_feature_day_idx").on(t.feature, t.createdAt)],
);
```

⚠️ Drizzle import 라인에 `uniqueIndex`, `integer`, `numeric`, `jsonb` 가 이미 있는지 확인. 없으면 추가.

⚠️ CHECK 제약 없음 — section 화이트리스트는 TypeScript 측 `ReadingSection` 타입과 `generateReading` 함수에서 검증.

- [ ] **Step 2: 마이그레이션 생성**

`pnpm --filter @gons/dashboard drizzle-kit generate`

결과 0007 SQL 파일을 열어 `CREATE TABLE saju_charts`, `CREATE TABLE saju_readings`, `CREATE TABLE llm_spend_log` 모두 포함되었는지, ON CASCADE 외래키 + 2 UNIQUE + 1 INDEX 들어있는지 확인.

- [ ] **Step 3: drizzle-kit check**

`pnpm --filter @gons/dashboard drizzle-kit check`

Expected: 무문제. 운영 DB 적용은 머지 후 사용자 직접 (CLAUDE.md 운영 가드).

- [ ] **Step 4: 커밋**

스테이지: `schema.ts`, `drizzle/0007_*.sql`, `drizzle/meta/0007_snapshot.json`, `drizzle/meta/_journal.json`.

메시지:
```
feat(saju): drizzle 0007 — saju_charts/saju_readings/llm_spend_log

원국 결정적 차트(profile_id UNIQUE) + 섹션별 LLM 해설(chart_id,section
UNIQUE) + LLM 비용 일지(feature 공용). 차트와 해설 테이블 분리해
모델 변경 시 readings만 무효화 가능. spec §4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 2: env 스키마 확장

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: env.ts envSchema 안에 3개 필드 추가**

```ts
SAJU_LLM_MODEL: z.string().default("claude-opus-4-7"),
SAJU_LLM_DAILY_BUDGET_KRW: z.coerce.number().int().positive().default(1000),
SAJU_LLM_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.3),
```

- [ ] **Step 2: .env.example 끝에 추가**

```
# 사주 상세 — features/saju-reading (spec §7)
SAJU_LLM_MODEL=claude-opus-4-7
SAJU_LLM_DAILY_BUDGET_KRW=1000
SAJU_LLM_TEMPERATURE=0.3
```

- [ ] **Step 3: typecheck**

`pnpm --filter @gons/dashboard typecheck` — clean 확인.

- [ ] **Step 4: 커밋**

```
feat(saju): env 스키마 — SAJU_LLM_MODEL/BUDGET/TEMPERATURE

옵셔널 + 기본값 (claude-opus-4-7 / 1000원 / 0.3). 운영 .env 갱신
없이도 기본값으로 동작.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 3: entities/saju-chart — 읽기 측 모델·타입·get

**Files:**
- Create: `apps/dashboard/src/entities/saju-chart/model/types.ts`
- Create: `apps/dashboard/src/entities/saju-chart/api/getSajuChartByProfile.ts`
- Create: `apps/dashboard/src/entities/saju-chart/index.ts`

- [ ] **Step 1: model/types.ts**

```ts
import type { InferSelectModel } from "drizzle-orm";
import type { sajuCharts, sajuReadings } from "@/shared/lib/db/schema";

export type SajuChartRow = InferSelectModel<typeof sajuCharts>;
export type SajuReadingRow = InferSelectModel<typeof sajuReadings>;

export const READING_SECTIONS = [
  "overview",
  "personality",
  "career",
  "health",
  "major_fortune",
] as const;
export type ReadingSection = (typeof READING_SECTIONS)[number];

export const READING_SECTION_LABEL: Record<ReadingSection, string> = {
  overview: "종합 풀이",
  personality: "성격·기질",
  career: "직업·적성",
  health: "건강",
  major_fortune: "대운 흐름",
};
```

- [ ] **Step 2: api/getSajuChartByProfile.ts**

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db";
import { sajuCharts, sajuReadings } from "@/shared/lib/db/schema";
import type { SajuChartRow, SajuReadingRow } from "../model/types";

export interface SajuChartWithReadings {
  chart: SajuChartRow;
  readings: SajuReadingRow[];
}

export async function getSajuChartByProfile(
  profileId: string,
): Promise<SajuChartWithReadings | null> {
  const [chart] = await db
    .select()
    .from(sajuCharts)
    .where(eq(sajuCharts.profileId, profileId))
    .limit(1);
  if (!chart) return null;
  const readings = await db
    .select()
    .from(sajuReadings)
    .where(eq(sajuReadings.chartId, chart.id));
  return { chart, readings };
}
```

- [ ] **Step 3: index.ts barrel**

```ts
export { getSajuChartByProfile } from "./api/getSajuChartByProfile";
export type { SajuChartWithReadings } from "./api/getSajuChartByProfile";
export type {
  SajuChartRow,
  SajuReadingRow,
  ReadingSection,
} from "./model/types";
export { READING_SECTIONS, READING_SECTION_LABEL } from "./model/types";
```

⚠️ Gotcha #1 (CLAUDE.md): `getSajuChartByProfile` 이 server-only. 이 barrel은 transitive 의존으로 server-only를 가짐. Phase 2 client 컴포넌트는 deep import (`@/entities/saju-chart/model/types`) 로 타입만 가져옴.

- [ ] **Step 4: typecheck + 커밋**

`pnpm --filter @gons/dashboard typecheck` clean 후:

```
feat(saju): entities/saju-chart — 읽기 측 모델·타입·get

SajuChartRow/SajuReadingRow Drizzle 타입 + READING_SECTIONS 5개 enum +
getSajuChartByProfile. server-only barrel 이므로 client는 deep import.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 4: features/saju-reading/lib — 프롬프트·LLM 클라이언트·예산

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/lib/prompts.ts`
- Create: `apps/dashboard/src/features/saju-reading/lib/llm-client.ts`
- Create: `apps/dashboard/src/features/saju-reading/lib/budget.ts`

- [ ] **Step 1: lib/prompts.ts**

```ts
import type { ReadingSection } from "@/entities/saju-chart";
import type { SajuChart } from "@gons/saju";

export const SAJU_SYSTEM_PROMPT = [
  "당신은 명리학자입니다.",
  "한자 + 한글 음을 병기하고, 추측·점성술 톤은 피하고,",
  "사주 구조에서 도출되는 결론만 제시합니다.",
  "출력은 한국어 markdown text. 헤더(#)는 쓰지 말고 단락 문장만.",
].join(" ");

const SECTION_INSTRUCTIONS: Record<ReadingSection, { instruction: string; targetChars: number }> = {
  overview:      { instruction: "이 사주의 구조적 특징(관인상생, 신강·신약, 격국 등)을 한 문단으로 종합 풀이. 약 300자.",                                       targetChars: 300 },
  personality:   { instruction: "성격·기질을 사주 구조에서 도출. 강점과 그림자 양면을 모두 다룰 것. 약 200자.",                                                    targetChars: 200 },
  career:        { instruction: "직업·적성을 십신·격국 기반으로 도출. 구체적 직군 2~3개 제시. 약 200자.",                                                          targetChars: 200 },
  health:        { instruction: "오행 결함·과다를 기준으로 건강 주의 영역. 추상적 표현 금지. 약 150자.",                                                            targetChars: 150 },
  major_fortune: { instruction: "대운 10개를 시작 나이 + 간지 + 한 줄 요약으로 정리한 뒤, 현재 진행 중인 대운을 별도 단락으로 풀이. 약 400자.", targetChars: 400 },
};

export interface BuildReadingPromptInput {
  chart: SajuChart;
  section: ReadingSection;
  currentAge?: number;
}

export function buildReadingPrompt(input: BuildReadingPromptInput): {
  system: string;
  user: string;
} {
  const { chart, section, currentAge } = input;
  const sectionMeta = SECTION_INSTRUCTIONS[section];

  // 차트 결정적 결과만 프롬프트에 — PII(생일·이름·도시)는 안 넣음 (spec §8)
  const chartJson = JSON.stringify(
    {
      pillars: chart.pillars,
      elements: chart.elements,
      strength: chart.strength,
      tenGods: chart.tenGods,
      pattern: chart.pattern,
      yongSin: chart.yongSin,
      giSin: chart.giSin,
      majorFortunes: chart.majorFortunes,
      currentAge: currentAge ?? null,
    },
    null,
    2,
  );

  const user = [
    "[사주 차트]",
    chartJson,
    "",
    "[섹션 지시]",
    sectionMeta.instruction,
    `목표 길이: 약 ${sectionMeta.targetChars}자.`,
  ].join("\n");

  return { system: SAJU_SYSTEM_PROMPT, user };
}
```

- [ ] **Step 2: lib/llm-client.ts**

```ts
import "server-only";
import { anthropic } from "@/shared/lib/llm/anthropic";
import { env } from "@/shared/config/env";

// 2026-05 기준 claude-opus-4-7 가격 (USD/1M tokens)
const PRICING_USD_PER_M = {
  "claude-opus-4-7":             { input: 15,  output: 75 },
  "claude-sonnet-4-6":           { input:  3,  output: 15 },
  "claude-haiku-4-5-20251001":   { input:  0.8, output: 4 },
} as const;

const USD_TO_KRW = 1380; // 정확한 회계 아니라 일별 가드용 추정

export interface LlmCallResult {
  body: string;
  inputTokens: number;
  outputTokens: number;
  krw: number;
  model: string;
}

export interface LlmCallInput {
  system: string;
  user: string;
  maxTokens: number;
}

export async function callSajuLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const model = env.SAJU_LLM_MODEL;
  const response = await anthropic.messages.create({
    model,
    max_tokens: input.maxTokens,
    temperature: env.SAJU_LLM_TEMPERATURE,
    system: input.system,
    messages: [{ role: "user", content: input.user }],
  });

  const body = response.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("")
    .trim();

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const pricing = PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M] ?? PRICING_USD_PER_M["claude-opus-4-7"];
  const usd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  const krw = Math.round(usd * USD_TO_KRW * 100) / 100;

  if (!body) throw new Error("callSajuLlm: empty response body");

  return { body, inputTokens, outputTokens, krw, model };
}
```

- [ ] **Step 3: lib/budget.ts**

```ts
import "server-only";
import { sql, and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/shared/lib/db";
import { llmSpendLog } from "@/shared/lib/db/schema";

export class BudgetExceededError extends Error {
  constructor(public spentKrw: number, public budgetKrw: number) {
    super(`saju LLM budget exceeded: ${spentKrw}/${budgetKrw} KRW today (KST)`);
    this.name = "BudgetExceededError";
  }
}

function todayKstRange(): { start: Date; end: Date } {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstMidnight = new Date(Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
  ));
  const start = new Date(kstMidnight.getTime() - 9 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function getTodaySajuSpendKrw(): Promise<number> {
  const { start, end } = todayKstRange();
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${llmSpendLog.krw}), 0)` })
    .from(llmSpendLog)
    .where(and(
      eq(llmSpendLog.feature, "saju"),
      gte(llmSpendLog.createdAt, start),
      lt(llmSpendLog.createdAt, end),
    ));
  return Number(row?.total ?? 0);
}

export async function assertSajuBudgetOk(budgetKrw: number): Promise<void> {
  const spent = await getTodaySajuSpendKrw();
  if (spent >= budgetKrw) throw new BudgetExceededError(spent, budgetKrw);
}

export async function logSajuSpend(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  krw: number;
}): Promise<void> {
  await db.insert(llmSpendLog).values({
    feature: "saju",
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    krw: input.krw.toString(),
  });
}
```

- [ ] **Step 4: typecheck + 커밋**

```
feat(saju): saju-reading/lib — 프롬프트·LLM 호출·예산 가드

prompts.ts (5섹션, PII 제외), llm-client.ts (Anthropic 호출 + 토큰
카운트 + KRW 환산), budget.ts (KST 일별 합산 + BudgetExceededError).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 5: generateChart.ts — `@gons/saju` 위임 + hash 캐시

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/api/generateChart.ts`

- [ ] **Step 1: 구현**

```ts
import "server-only";
import { computeSajuChart, type SajuChart, type ComputeSajuInput } from "@gons/saju";
import { db } from "@/shared/lib/db";
import { sajuCharts } from "@/shared/lib/db/schema";
import type { SajuChartRow } from "@/entities/saju-chart";
import { eq } from "drizzle-orm";

export interface GenerateChartInput extends ComputeSajuInput {
  profileId: string;
}

export interface GenerateChartResult {
  chart: SajuChartRow;
  computed: SajuChart;
  /** true if a new row was inserted (vs. reused existing). */
  inserted: boolean;
}

export async function generateChart(input: GenerateChartInput): Promise<GenerateChartResult> {
  const computed = computeSajuChart(input);

  const [existing] = await db
    .select()
    .from(sajuCharts)
    .where(eq(sajuCharts.profileId, input.profileId))
    .limit(1);

  if (existing && existing.inputHash === computed.inputHash) {
    return { chart: existing, computed, inserted: false };
  }

  if (existing) {
    await db.delete(sajuCharts).where(eq(sajuCharts.id, existing.id));
  }

  const [chart] = await db
    .insert(sajuCharts)
    .values({
      profileId: input.profileId,
      inputHash: computed.inputHash,
      yearStem: computed.pillars.year.stem,
      yearBranch: computed.pillars.year.branch,
      monthStem: computed.pillars.month.stem,
      monthBranch: computed.pillars.month.branch,
      dayStem: computed.pillars.day.stem,
      dayBranch: computed.pillars.day.branch,
      hourStem: computed.pillars.hour?.stem ?? null,
      hourBranch: computed.pillars.hour?.branch ?? null,
      elements: computed.elements,
      strength: computed.strength,
      tenGods: computed.tenGods,
      pattern: computed.pattern,
      yongSin: computed.yongSin,
      giSin: computed.giSin,
      majorFortunes: computed.majorFortunes,
    })
    .returning();

  return { chart, computed, inserted: true };
}
```

- [ ] **Step 2: typecheck + 커밋**

```
feat(saju): generateChart — @gons/saju 위임 + hash 기반 캐시

profile_id 로 기존 row 조회 → input_hash 일치 시 재사용, 불일치 시
DELETE(CASCADE) → INSERT. inserted 로 호출자가 LLM 재생성 필요 판단.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 6: generateReading.ts — 섹션별 LLM 호출 + 캐시 + 예산

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/api/generateReading.ts`
- Create: `apps/dashboard/src/features/saju-reading/api/generateReading.test.ts`

- [ ] **Step 1: 테스트 먼저 (TDD)**

`generateReading.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateReading } from "./generateReading";

vi.mock("../lib/llm-client", () => ({ callSajuLlm: vi.fn() }));
vi.mock("../lib/budget", () => ({
  assertSajuBudgetOk: vi.fn().mockResolvedValue(undefined),
  logSajuSpend:       vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class extends Error {},
}));
vi.mock("@/shared/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn() } }));

const FAKE_CHART_ID = "00000000-0000-0000-0000-000000000001";
const FAKE_CHART = {
  pillars: { year:{stem:"丁",branch:"未"}, month:{stem:"癸",branch:"卯"},
            day:{stem:"壬",branch:"辰"}, hour:{stem:"癸",branch:"卯"} },
  elements: { wood:2, fire:1, earth:2, metal:0, water:3 },
  strength: "strong" as const,
  tenGods: {} as never,
  pattern: "傷官格",
  yongSin: ["fire","earth"] as const,
  giSin:   ["earth","water"] as const,
  majorFortunes: [],
  inputHash: "test-hash",
};

describe("generateReading", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cache hit (model 일치) — LLM 호출 안 함", async () => {
    const { db } = await import("@/shared/lib/db");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([
        { body:"cached body", model:"claude-opus-4-7" },
      ]) }) }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");

    const result = await generateReading({ chartId: FAKE_CHART_ID, chart: FAKE_CHART as any, section: "overview" });

    expect(result).toEqual({ body: "cached body", cached: true });
    expect(callSajuLlm).not.toHaveBeenCalled();
  });

  it("cache miss — LLM 호출 + UPSERT + spend log", async () => {
    const { db } = await import("@/shared/lib/db");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body:"generated", inputTokens:100, outputTokens:200, krw:30, model:"claude-opus-4-7",
    });
    const { logSajuSpend } = await import("../lib/budget");

    const result = await generateReading({ chartId: FAKE_CHART_ID, chart: FAKE_CHART as any, section: "overview" });

    expect(result).toEqual({ body: "generated", cached: false });
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
    expect(logSajuSpend).toHaveBeenCalledWith(expect.objectContaining({ krw: 30 }));
  });

  it("model 변경 — 캐시 무시하고 재생성", async () => {
    const { db } = await import("@/shared/lib/db");
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([
        { body:"old body", model:"claude-sonnet-4-6" },
      ]) }) }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    });
    const { callSajuLlm } = await import("../lib/llm-client");
    (callSajuLlm as any).mockResolvedValue({
      body:"new body", inputTokens:100, outputTokens:200, krw:30, model:"claude-opus-4-7",
    });

    const result = await generateReading({ chartId: FAKE_CHART_ID, chart: FAKE_CHART as any, section: "overview" });

    expect(result).toEqual({ body: "new body", cached: false });
    expect(callSajuLlm).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

```
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test features/saju-reading/api/generateReading
```

Expected: FAIL.

- [ ] **Step 3: generateReading.ts 구현**

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { SajuChart } from "@gons/saju";
import { db } from "@/shared/lib/db";
import { sajuReadings } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import type { ReadingSection } from "@/entities/saju-chart";
import { callSajuLlm } from "../lib/llm-client";
import { assertSajuBudgetOk, logSajuSpend } from "../lib/budget";
import { buildReadingPrompt } from "../lib/prompts";

const SECTION_MAX_TOKENS: Record<ReadingSection, number> = {
  overview: 600,
  personality: 400,
  career: 400,
  health: 300,
  major_fortune: 800,
};

export interface GenerateReadingInput {
  chartId: string;
  chart: SajuChart;
  section: ReadingSection;
  currentAge?: number;
}

export interface GenerateReadingResult {
  body: string;
  cached: boolean;
}

export async function generateReading(input: GenerateReadingInput): Promise<GenerateReadingResult> {
  const [cached] = await db
    .select()
    .from(sajuReadings)
    .where(and(
      eq(sajuReadings.chartId, input.chartId),
      eq(sajuReadings.section, input.section),
    ))
    .limit(1);

  if (cached && cached.model === env.SAJU_LLM_MODEL) {
    return { body: cached.body, cached: true };
  }

  await assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW);

  const { system, user } = buildReadingPrompt({
    chart: input.chart,
    section: input.section,
    currentAge: input.currentAge,
  });
  const llm = await callSajuLlm({
    system,
    user,
    maxTokens: SECTION_MAX_TOKENS[input.section],
  });

  await logSajuSpend({
    model: llm.model,
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    krw: llm.krw,
  });

  await db
    .insert(sajuReadings)
    .values({
      chartId: input.chartId,
      section: input.section,
      body: llm.body,
      model: llm.model,
    })
    .onConflictDoUpdate({
      target: [sajuReadings.chartId, sajuReadings.section],
      set: { body: llm.body, model: llm.model, createdAt: new Date() },
    });

  return { body: llm.body, cached: false };
}
```

- [ ] **Step 4: 테스트 통과 + 커밋**

3/3 PASS 확인 후:

```
feat(saju): generateReading — 섹션별 LLM 호출 + 영구 캐시

(chartId,section) UNIQUE 캐시. 캐시된 모델 != env.SAJU_LLM_MODEL 이면
재생성. 호출 전 일별 KRW 예산 확인, 호출 후 토큰·KRW 기록. UPSERT.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 7: ensureChartAndReadings.ts — 페이지 진입점

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/api/ensureChartAndReadings.ts`

- [ ] **Step 1: 구현**

```ts
import "server-only";
import { generateChart } from "./generateChart";
import { generateReading } from "./generateReading";
import { getFortuneProfile } from "@/entities/fortune-profile";
import { READING_SECTIONS, type ReadingSection } from "@/entities/saju-chart";
import type { SajuChartRow } from "@/entities/saju-chart";

export interface EnsureChartAndReadingsResult {
  chart: SajuChartRow;
  readings: Record<ReadingSection, string | null>;
  errors: Array<{ section: ReadingSection; message: string }>;
}

export async function ensureChartAndReadings(input: {
  profileId: string;
  userId: string;
  currentAge?: number;
}): Promise<EnsureChartAndReadingsResult | null> {
  // ownership 가드
  const profile = await getFortuneProfile(input.profileId);
  if (!profile || profile.userId !== input.userId) return null;

  // 차트 생성/재사용
  const { chart, computed } = await generateChart({
    profileId: profile.id,
    birthDate: profile.birthDate,
    birthTime: profile.birthTime,
    calendar: profile.calendar,
    gender: profile.gender,
    birthCity: profile.birthCity,
  });

  // 5섹션 병렬 생성 (allSettled — 부분 실패 허용)
  const results = await Promise.allSettled(
    READING_SECTIONS.map(async (section): Promise<{ section: ReadingSection; body: string }> => {
      try {
        const r = await generateReading({
          chartId: chart.id,
          chart: computed,
          section,
          currentAge: input.currentAge,
        });
        return { section, body: r.body };
      } catch (e) {
        // section 정보를 message 에 prefix 로 박아 호출자가 매칭
        throw new Error(`[${section}] ${(e as Error).message}`);
      }
    }),
  );

  const readings = Object.fromEntries(
    READING_SECTIONS.map((s) => [s, null as string | null]),
  ) as Record<ReadingSection, string | null>;
  const errors: Array<{ section: ReadingSection; message: string }> = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      readings[r.value.section] = r.value.body;
    } else {
      const msg = (r.reason as Error).message ?? String(r.reason);
      const match = /^\[(\w+)\]\s*(.+)$/.exec(msg);
      if (match) {
        errors.push({ section: match[1] as ReadingSection, message: match[2] });
      } else {
        errors.push({ section: "overview", message: msg });
      }
    }
  }

  return { chart, readings, errors };
}
```

- [ ] **Step 2: typecheck + 커밋**

```
feat(saju): ensureChartAndReadings — 페이지 진입점

ownership 가드 → generateChart → 5섹션 allSettled. 실패한 섹션은
readings[section]=null + errors[]에 기록. Phase 2 UI는 이 함수만 호출.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 8: revalidateSajuChart.ts — 프로필 변경 시 무효화

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/api/revalidateSajuChart.ts`
- Modify: `apps/dashboard/src/features/fortune-profile-manage/api/updateFortuneProfile.ts`

- [ ] **Step 1: revalidateSajuChart.ts**

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { hashProfile } from "@gons/saju";
import type { ComputeSajuInput } from "@gons/saju";
import { db } from "@/shared/lib/db";
import { sajuCharts } from "@/shared/lib/db/schema";

/**
 * Profile 변경 시 호출. input_hash 가 달라졌으면 chart 삭제 (CASCADE 로
 * readings 함께). 다음 ensureChartAndReadings 호출 시 자동 재생성.
 */
export async function revalidateSajuChart(input: {
  profileId: string;
  newInput: ComputeSajuInput;
}): Promise<{ invalidated: boolean }> {
  const newHash = hashProfile(input.newInput);
  const [existing] = await db
    .select({ id: sajuCharts.id, hash: sajuCharts.inputHash })
    .from(sajuCharts)
    .where(eq(sajuCharts.profileId, input.profileId))
    .limit(1);

  if (!existing) return { invalidated: false };
  if (existing.hash === newHash) return { invalidated: false };

  await db.delete(sajuCharts).where(eq(sajuCharts.id, existing.id));
  return { invalidated: true };
}
```

- [ ] **Step 2: updateFortuneProfile 안에서 호출**

먼저 기존 파일을 Read. update 성공 후 다음 추가:

```ts
import { revalidateSajuChart } from "@/features/saju-reading/api/revalidateSajuChart";

// update 직후:
await revalidateSajuChart({
  profileId: updatedProfile.id,
  newInput: {
    birthDate: updatedProfile.birthDate,
    birthTime: updatedProfile.birthTime,
    calendar: updatedProfile.calendar,
    gender: updatedProfile.gender,
    birthCity: updatedProfile.birthCity,
  },
});
```

⚠️ FSD: `features/fortune-profile-manage` → `features/saju-reading` 의 features→features deep import. CLAUDE.md 의 같은 레이어 예외에 해당.

- [ ] **Step 3: typecheck + 커밋**

```
feat(saju): revalidateSajuChart — 프로필 변경 시 hash 무효화

updateFortuneProfile 성공 후 호출. input_hash 가 달라지면 chart
DELETE → CASCADE 로 readings 함께 삭제. 다음 ensureChartAndReadings
가 자동 재생성.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 9: saju-reading/index.ts barrel

**Files:**
- Create: `apps/dashboard/src/features/saju-reading/index.ts`

- [ ] **Step 1: barrel**

```ts
export { ensureChartAndReadings } from "./api/ensureChartAndReadings";
export type { EnsureChartAndReadingsResult } from "./api/ensureChartAndReadings";
export { revalidateSajuChart } from "./api/revalidateSajuChart";
```

`lib/*` 와 `generateChart`/`generateReading` 은 외부에 노출 안 함.

- [ ] **Step 2: typecheck + 커밋**

```
feat(saju): saju-reading barrel — ensureChartAndReadings 만 노출
```

---

## Task 10: 통합 테스트 — hash 무효화 시나리오

**Files:**
- Create: `apps/dashboard/tests/saju-reading.integration.test.ts`

⚠️ 실DB 필요 (`TEST_DATABASE_URL`). DB 미연결 시 ECONNREFUSED skip — CLAUDE.md Gotcha #2 패턴.

- [ ] **Step 1: 통합 테스트 작성**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/shared/lib/db";
import { fortuneProfiles, sajuCharts, sajuReadings, users } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateChart } from "@/features/saju-reading/api/generateChart";
import { revalidateSajuChart } from "@/features/saju-reading/api/revalidateSajuChart";

const TEST_USER_ID = "00000000-0000-0000-0000-000000099991";
const TEST_PROFILE_ID = "00000000-0000-0000-0000-000000099992";

describe("saju-reading hash 무효화 통합 시나리오", () => {
  beforeAll(async () => {
    await db.insert(users).values({ id: TEST_USER_ID, email: "saju-test@example.com" }).onConflictDoNothing();
    await db.insert(fortuneProfiles).values({
      id: TEST_PROFILE_ID, userId: TEST_USER_ID, name: "테스트", relation: "self",
      birthDate: "1967-03-29", birthTime: "05:30", calendar: "solar", gender: "male", birthCity: null,
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(fortuneProfiles).where(eq(fortuneProfiles.id, TEST_PROFILE_ID));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("같은 입력 → 두 번째 호출 inserted=false", async () => {
    const first = await generateChart({
      profileId: TEST_PROFILE_ID,
      birthDate: "1967-03-29", birthTime: "05:30",
      calendar: "solar", gender: "male", birthCity: null,
    });
    expect(first.inserted).toBe(true);

    const second = await generateChart({
      profileId: TEST_PROFILE_ID,
      birthDate: "1967-03-29", birthTime: "05:30",
      calendar: "solar", gender: "male", birthCity: null,
    });
    expect(second.inserted).toBe(false);
    expect(second.chart.id).toBe(first.chart.id);
  });

  it("도시 다르면 hash 변경 → 재생성 + readings CASCADE 삭제", async () => {
    const chartRow = (await db.select().from(sajuCharts).where(eq(sajuCharts.profileId, TEST_PROFILE_ID)).limit(1))[0];
    await db.insert(sajuReadings).values({
      chartId: chartRow.id,
      section: "overview", body: "테스트 해설", model: "claude-opus-4-7",
    }).onConflictDoNothing();

    const result = await revalidateSajuChart({
      profileId: TEST_PROFILE_ID,
      newInput: {
        birthDate: "1967-03-29", birthTime: "05:30",
        calendar: "solar", gender: "male", birthCity: "Seoul",
      },
    });
    expect(result.invalidated).toBe(true);

    // CASCADE 확인 — 이전 chartId 로 readings 가 없어야 함
    const remaining = await db.select().from(sajuReadings).where(eq(sajuReadings.chartId, chartRow.id));
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 로컬 DB 있으면 실행 (선택)**

로컬 테스트 DB가 있고 마이그레이션이 적용된 상태이면:

```
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test saju-reading.integration
```

Expected: 2/2 PASS. DB 미연결이면 ECONNREFUSED — CI 무해.

- [ ] **Step 3: 커밋**

```
test(saju): hash 무효화 통합 테스트 2건

같은 입력 → inserted=false 재사용. 도시 변경 → invalidated=true +
readings CASCADE 삭제. TEST_DATABASE_URL 미연결 시 ECONNREFUSED skip.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 11: 전체 게이트 + PR

- [ ] **Step 1: 루트 검증**

```
pnpm typecheck
pnpm --workspace-concurrency=1 lint
pnpm --filter @gons/saju test
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test
```

Expected: typecheck/lint clean. saju 21/21 PASS. dashboard unit + smoke + 새 generateReading mock 3개 PASS. integration 은 DB 있을 때만.

- [ ] **Step 2: push + PR**

```
git push -u origin feat/saju-phase1
```

PR title: `feat(saju): Phase 1 — DB 0007 + saju-reading 파이프라인`

PR body 본문은 Phase 0 PR과 유사한 구조로 — Summary / Spec reference / Test plan / Next phase 섹션. 운영 DB 마이그레이션은 PR 본문에 별도 안내:

```
## 운영 배포 후 마이그레이션
1. PR 머지 + 새 이미지 빌드 대기
2. 운영 서버에서:
   I_KNOW_THIS_IS_PROD=1 pnpm db:migrate
3. 컨테이너 재시작:
   docker --context home-server compose -f $COMPOSE up -d app
4. /api/health 확인
```

---

## Self-Review 체크리스트

- [ ] **Spec 커버리지**: §4 (테이블 2 + 무효화) ✓, §5 (5섹션 파이프라인 + allSettled) ✓, §7 (env 3개) ✓, §8 (PII 제외 + 관리자 가드는 Phase 2) ✓
- [ ] **Placeholder 스캔**: ⚠️ 외 TBD/TODO 없음
- [ ] **타입 일관성**: `SajuChart` (from `@gons/saju`), `SajuChartRow`/`SajuReadingRow` (Drizzle), `ReadingSection` enum — 사용처 마다 동일
- [ ] **함수 시그니처**:
  - `generateChart(GenerateChartInput) → GenerateChartResult`
  - `generateReading(GenerateReadingInput) → GenerateReadingResult`
  - `ensureChartAndReadings(input) → EnsureChartAndReadingsResult | null`
  - `revalidateSajuChart(input) → { invalidated }`
- [ ] **DB 마이그레이션 운영 가드**: 머지 후 사용자가 `I_KNOW_THIS_IS_PROD=1 pnpm db:migrate` 수동 (CLAUDE.md)

---

## 메모

- Phase 2 (페이지 + UI) 는 별도 plan
- LLM 가격(`USD_TO_KRW`, `PRICING_USD_PER_M`)은 추정 — 회계 아니라 가드. 변동 시 별도 후속
- `Promise.allSettled` reason → section 매칭은 wrapper 의 `throw new Error("[section] ...")` 후 정규식 파싱
- 미래 LLM 기능들이 `llm_spend_log.feature` 컬럼 재사용
