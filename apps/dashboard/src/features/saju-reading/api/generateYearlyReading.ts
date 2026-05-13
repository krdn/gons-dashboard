import "server-only";
import { and, eq } from "drizzle-orm";
import {
  computeYearPillar,
  computeMonthPillars,
  tenGodsForPillar,
  type SajuChart,
  type Stem,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { sajuYearlyReadings } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { callSajuLlm } from "../lib/llm-client";
import { assertSajuBudgetOk, logSajuSpend } from "../lib/budget";
import { buildYearlyPrompt } from "../lib/yearlyPrompt";

export interface GenerateYearlyReadingInput {
  chart: SajuChart;
  chartId: string;
  year: number;
}

export interface GenerateYearlyReadingResult {
  body: string;
  cached: boolean;
}

export async function generateYearlyReading(
  input: GenerateYearlyReadingInput,
): Promise<GenerateYearlyReadingResult> {
  // 1. cache
  const [cached] = await db
    .select()
    .from(sajuYearlyReadings)
    .where(
      and(
        eq(sajuYearlyReadings.chartId, input.chartId),
        eq(sajuYearlyReadings.year, input.year),
      ),
    )
    .limit(1);

  if (cached && cached.model === env.SAJU_LLM_MODEL) {
    return { body: cached.body, cached: true };
  }

  // 2. 결정적 계산
  const yearPillar = computeYearPillar(input.year);
  const monthPillars = computeMonthPillars(input.year);
  const dayStem = input.chart.pillars.day.stem as Stem;
  const yearTenGods = tenGodsForPillar(dayStem, yearPillar);
  const monthTenGods = monthPillars.map((mp) =>
    tenGodsForPillar(dayStem, mp.pillar),
  );

  // 3. 예산 가드
  await assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW);

  // 4. LLM
  const { system, user } = buildYearlyPrompt({
    chart: input.chart,
    year: input.year,
    yearPillar,
    yearTenGods,
    monthPillars,
    monthTenGods,
  });
  const llm = await callSajuLlm({ system, user, maxTokens: 2000 });

  // 5. spend + UPSERT
  await logSajuSpend({
    model: llm.model,
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    krw: llm.krw,
  });

  await db
    .insert(sajuYearlyReadings)
    .values({
      chartId: input.chartId,
      year: input.year,
      yearStem: yearPillar.stem,
      yearBranch: yearPillar.branch,
      body: llm.body,
      model: llm.model,
    })
    .onConflictDoUpdate({
      target: [sajuYearlyReadings.chartId, sajuYearlyReadings.year],
      set: {
        yearStem: yearPillar.stem,
        yearBranch: yearPillar.branch,
        body: llm.body,
        model: llm.model,
        createdAt: new Date(),
      },
    });

  return { body: llm.body, cached: false };
}
