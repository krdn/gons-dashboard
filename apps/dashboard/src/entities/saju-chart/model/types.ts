import type { InferSelectModel } from "drizzle-orm";
import type {
  sajuCharts,
  sajuReadings,
  sajuYearlyReadings,
  sajuDailyFortunes,
} from "@/shared/lib/db/schema";

export type SajuChartRow = InferSelectModel<typeof sajuCharts>;
export type SajuReadingRow = InferSelectModel<typeof sajuReadings>;
export type SajuYearlyReadingRow = InferSelectModel<typeof sajuYearlyReadings>;
export type SajuDailyFortuneRow = InferSelectModel<typeof sajuDailyFortunes>;

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
