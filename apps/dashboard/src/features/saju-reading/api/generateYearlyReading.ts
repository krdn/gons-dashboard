import "server-only";
import { and, eq } from "drizzle-orm";
import {
  computeYearPillar,
  computeMonthPillars,
  tenGodsForPillar,
  type SajuChart,
  type Stem,
} from "@krdn/saju";
import { sajuYearlyReadings } from "@/shared/lib/db/schema";
import { cachedMarkdownReading } from "../lib/cachedReading";
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
  // 결정적 계산 — 캐시-리딩 모듈의 책임 밖. caller 가 prompt builder 에 넘긴다.
  const yearPillar = computeYearPillar(input.year);
  const monthPillars = computeMonthPillars(input.year);
  const dayStem = input.chart.pillars.day.stem as Stem;
  const yearTenGods = tenGodsForPillar(dayStem, yearPillar);
  const monthTenGods = monthPillars.map((mp) =>
    tenGodsForPillar(dayStem, mp.pillar),
  );

  const prompt = buildYearlyPrompt({
    chart: input.chart,
    year: input.year,
    yearPillar,
    yearTenGods,
    monthPillars,
    monthTenGods,
  });

  const { data, cached } = await cachedMarkdownReading({
    table: sajuYearlyReadings,
    where: and(
      eq(sajuYearlyReadings.chartId, input.chartId),
      eq(sajuYearlyReadings.year, input.year),
    )!,
    conflictTarget: [sajuYearlyReadings.chartId, sajuYearlyReadings.year],
    prompt: { system: prompt.system, user: prompt.user, maxTokens: 2000 },
    promptVersion: prompt.version,
    extraColumns: {
      chartId: input.chartId,
      year: input.year,
      yearStem: yearPillar.stem,
      yearBranch: yearPillar.branch,
    },
  });

  return { body: data, cached };
}
