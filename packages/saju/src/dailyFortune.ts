import { z } from "zod";

export const dailyFortuneScoreSchema = z.object({
  label: z.string(),
  score: z.number().int().min(1).max(5),
  note: z.string(),
});

export const dailyFortuneHourSlotSchema = z.object({
  range: z.string(),
  vibe: z.string(),
  isGolden: z.boolean().optional(),
});

export const dailyFortuneRemedySchema = z.object({
  colors: z.array(z.string()),
  directions: z.array(z.string()),
  foods: z.array(z.string()),
  items: z.array(z.string()),
});

export const dailyFortunePayloadSchema = z.object({
  forDate: z.string(),
  dayPillar: z.string(),
  summary: z.string(),
  overallScore: z.number().int().min(1).max(5),
  scores: z.array(dailyFortuneScoreSchema).length(5),
  hourly: z.array(dailyFortuneHourSlotSchema).min(7).max(12),
  recommendations: z.array(z.string()).min(1),
  cautions: z.array(z.string()).min(1),
  remedy: dailyFortuneRemedySchema,
  closing: z.string(),
});

export type DailyFortuneScore = z.infer<typeof dailyFortuneScoreSchema>;
export type DailyFortuneHourSlot = z.infer<typeof dailyFortuneHourSlotSchema>;
export type DailyFortuneRemedy = z.infer<typeof dailyFortuneRemedySchema>;
export type DailyFortunePayload = z.infer<typeof dailyFortunePayloadSchema>;
