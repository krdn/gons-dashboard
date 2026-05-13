import "server-only";
import { and, eq } from "drizzle-orm";
import type { SajuChart } from "@gons/saju";
import { db } from "@/shared/lib/db/client";
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

export async function generateReading(
  input: GenerateReadingInput,
): Promise<GenerateReadingResult> {
  const [cached] = await db
    .select()
    .from(sajuReadings)
    .where(
      and(
        eq(sajuReadings.chartId, input.chartId),
        eq(sajuReadings.section, input.section),
      ),
    )
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
