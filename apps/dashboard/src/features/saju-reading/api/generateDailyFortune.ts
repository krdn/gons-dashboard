import "server-only";
import { and, eq } from "drizzle-orm";
import {
  computeDayPillar,
  tenGodsForPillar,
  dailyFortunePayloadSchema,
  type DailyFortunePayload,
  type SajuChart,
  type Stem,
  type Branch,
} from "@gons/saju";
import { db } from "@/shared/lib/db/client";
import { sajuDailyFortunes } from "@/shared/lib/db/schema";
import type { SajuChartRow, SajuDailyFortuneRow } from "@/entities/saju-chart";
import { env } from "@/shared/config/env";
import { callSajuLlm } from "../lib/llm-client";
import { assertSajuBudgetOk, logSajuSpend } from "../lib/budget";
import { buildDailyPrompt } from "../lib/dailyPrompt";

export interface GenerateDailyFortuneInput {
  chartRow: SajuChartRow;
  forDate: string;
}

export interface GenerateDailyFortuneResult {
  row: SajuDailyFortuneRow | null;
  cached: boolean;
}

/** DB chart row → @gons/saju SajuChart. jsonb 필드 narrow. */
function chartRowToChart(row: SajuChartRow): SajuChart {
  return {
    pillars: {
      year: { stem: row.yearStem as Stem, branch: row.yearBranch as Branch },
      month: { stem: row.monthStem as Stem, branch: row.monthBranch as Branch },
      day: { stem: row.dayStem as Stem, branch: row.dayBranch as Branch },
      hour:
        row.hourStem && row.hourBranch
          ? { stem: row.hourStem as Stem, branch: row.hourBranch as Branch }
          : null,
    },
    elements: row.elements as SajuChart["elements"],
    strength: row.strength as SajuChart["strength"],
    tenGods: row.tenGods as SajuChart["tenGods"],
    pattern: row.pattern,
    yongSin: row.yongSin as SajuChart["yongSin"],
    giSin: row.giSin as SajuChart["giSin"],
    majorFortunes: row.majorFortunes as SajuChart["majorFortunes"],
    inputHash: row.inputHash,
  };
}

async function callAndValidate(
  input: GenerateDailyFortuneInput,
  retryWithEmphasis: boolean,
): Promise<{
  payload: DailyFortunePayload;
  krw: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const chart = chartRowToChart(input.chartRow);
  const dayPillar = computeDayPillar(input.forDate);
  const tenGods = tenGodsForPillar(input.chartRow.dayStem as Stem, dayPillar);
  const { system, user } = buildDailyPrompt({
    chart,
    dayPillar,
    tenGods,
    forDate: input.forDate,
    retryWithEmphasis,
  });
  const llm = await callSajuLlm({ system, user, maxTokens: 1500 });

  // markdown 코드블록 제거 (LLM이 ```json 으로 감쌀 수 있음)
  const trimmed = llm.body
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");
  const parsed = JSON.parse(trimmed);
  const validated = dailyFortunePayloadSchema.parse({
    ...parsed,
    dayPillar: `${dayPillar.stem}${dayPillar.branch}`,
    forDate: input.forDate,
  });
  return {
    payload: validated,
    krw: llm.krw,
    model: llm.model,
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
  };
}

export async function generateDailyFortune(
  input: GenerateDailyFortuneInput,
): Promise<GenerateDailyFortuneResult> {
  // 1. cache 조회
  const [cached] = await db
    .select()
    .from(sajuDailyFortunes)
    .where(
      and(
        eq(sajuDailyFortunes.chartId, input.chartRow.id),
        eq(sajuDailyFortunes.forDate, input.forDate),
      ),
    )
    .limit(1);

  if (cached && cached.model === env.SAJU_LLM_MODEL) {
    return { row: cached, cached: true };
  }

  // 2. 예산 가드
  await assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW);

  // 3. LLM + Zod, 실패 시 1회 재시도. 첫 실패는 production 운영에서 진단을
  //    위해 stderr 로 한 줄 — 재시도가 성공해도 패턴 파악에 유용.
  let result;
  try {
    result = await callAndValidate(input, false);
  } catch (firstError) {
    console.warn(
      `[saju.daily] first attempt failed for ${input.chartRow.id} ${input.forDate}: ${(firstError as Error).message?.slice(0, 200)}`,
    );
    result = await callAndValidate(input, true);
  }

  // 4. spend log + UPSERT
  await logSajuSpend({
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    krw: result.krw,
  });

  const dayPillar = computeDayPillar(input.forDate);
  await db
    .insert(sajuDailyFortunes)
    .values({
      chartId: input.chartRow.id,
      forDate: input.forDate,
      dayStem: dayPillar.stem,
      dayBranch: dayPillar.branch,
      payload: result.payload,
      model: result.model,
    })
    .onConflictDoUpdate({
      target: [sajuDailyFortunes.chartId, sajuDailyFortunes.forDate],
      set: {
        dayStem: dayPillar.stem,
        dayBranch: dayPillar.branch,
        payload: result.payload,
        model: result.model,
        createdAt: new Date(),
      },
    });

  return { row: null, cached: false };
}
