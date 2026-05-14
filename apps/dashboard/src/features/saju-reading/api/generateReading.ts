import "server-only";
import { and, eq } from "drizzle-orm";
import type { SajuChart } from "@gons/saju";
import { sajuReadings } from "@/shared/lib/db/schema";
import type { ReadingSection } from "@/entities/saju-chart";
import { cachedMarkdownReading } from "../lib/cachedReading";
import { buildReadingPrompt } from "../lib/prompts";

const SECTION_MAX_TOKENS: Record<ReadingSection, number> = {
  overview: 600,
  personality: 400,
  career: 400,
  health: 300,
  major_fortune: 1500,
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
  const prompt = buildReadingPrompt({
    chart: input.chart,
    section: input.section,
    currentAge: input.currentAge,
  });
  const { data, cached } = await cachedMarkdownReading({
    table: sajuReadings,
    where: and(
      eq(sajuReadings.chartId, input.chartId),
      eq(sajuReadings.section, input.section),
    )!,
    conflictTarget: [sajuReadings.chartId, sajuReadings.section],
    prompt: { system: prompt.system, user: prompt.user, maxTokens: SECTION_MAX_TOKENS[input.section] },
    promptVersion: prompt.version,
    extraColumns: { chartId: input.chartId, section: input.section },
  });
  return { body: data, cached };
}
