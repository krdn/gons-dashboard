import "server-only";
import { computeSajuChart, type SajuChart, type ComputeSajuInput } from "@gons/saju";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { sajuCharts } from "@/shared/lib/db/schema";
import type { SajuChartRow } from "@/entities/saju-chart";

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
