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
import { sajuDailyFortunes } from "@/shared/lib/db/schema";
import type { SajuChartRow, SajuDailyFortuneRow } from "@/entities/saju-chart";
import { cachedReading } from "../lib/cachedReading";
import { BudgetExceededError } from "../lib/budget";
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

export async function generateDailyFortune(
  input: GenerateDailyFortuneInput,
): Promise<GenerateDailyFortuneResult> {
  const chart = chartRowToChart(input.chartRow);
  const dayPillar = computeDayPillar(input.forDate);
  const tenGods = tenGodsForPillar(input.chartRow.dayStem as Stem, dayPillar);

  // retry 정책은 caller 책임. retryWithEmphasis 토글로 prompt 강화한 두 번째 호출을 시도.
  // 캐시-리딩 모듈은 retry 모름 — validate throw 그대로 propagate.
  const runOnce = (retryWithEmphasis: boolean) => {
    const prompt = buildDailyPrompt({
      chart,
      dayPillar,
      tenGods,
      forDate: input.forDate,
      retryWithEmphasis,
    });
    return cachedReading<typeof sajuDailyFortunes, DailyFortunePayload>({
      table: sajuDailyFortunes,
      where: and(
        eq(sajuDailyFortunes.chartId, input.chartRow.id),
        eq(sajuDailyFortunes.forDate, input.forDate),
      )!,
      conflictTarget: [sajuDailyFortunes.chartId, sajuDailyFortunes.forDate],
      prompt: { system: prompt.system, user: prompt.user, maxTokens: 1500 },
      promptVersion: prompt.version,
      validator: (raw) => {
        // markdown 코드블록 제거 (LLM 이 ```json 으로 감쌀 수 있음)
        const trimmed = raw
          .trim()
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "");
        return dailyFortunePayloadSchema.parse({
          ...JSON.parse(trimmed),
          dayPillar: `${dayPillar.stem}${dayPillar.branch}`,
          forDate: input.forDate,
        });
      },
      fromRow: (r) => r.payload as DailyFortunePayload,
      toRow: (payload, meta) => ({
        chartId: input.chartRow.id,
        forDate: input.forDate,
        dayStem: dayPillar.stem,
        dayBranch: dayPillar.branch,
        payload,
        model: meta.model,
        promptVersion: meta.promptVersion,
      }),
    });
  };

  try {
    const { cached } = await runOnce(false);
    return { row: null, cached };
  } catch (firstError) {
    // 예산 초과는 재시도해도 무의미 — 그대로 위로.
    if (firstError instanceof BudgetExceededError) throw firstError;
    console.warn(
      `[saju.daily] first attempt failed for ${input.chartRow.id} ${input.forDate}: ${(firstError as Error).message?.slice(0, 200)}`,
    );
    const { cached } = await runOnce(true);
    return { row: null, cached };
  }
}
