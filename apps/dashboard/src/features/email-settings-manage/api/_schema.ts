import "server-only";
import { z } from "zod";

const CATEGORY_VALUES = ["money", "security", "schedule", "notice"] as const;

// 체크박스는 FormData에서 "on"/누락으로 옴 → boolean 변환 헬퍼.
const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.undefined(), z.null()])
  .transform((v) => v === "on" || v === "true");

const intIn = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

export const EmailSettingsInput = z.object({
  replyNeededLimit: intIn(1, 50),
  importantLimit: intIn(1, 50),
  windowDays: intIn(1, 90),
  replySeverityThreshold: z.enum(["high", "med", "low"]),
  importantThreshold: z.enum(["high", "med"]),
  // 카테고리: FormData에서 getAll("categories")로 string[] → 검증.
  categories: z.array(z.enum(CATEGORY_VALUES)),
  llmReplyEnabled: checkbox,
  llmImportantEnabled: checkbox,
  syncIntervalMinutes: z.coerce
    .number()
    .int()
    .refine((v) => [15, 30, 60, 180, 360].includes(v), {
      message: "동기화 주기는 15/30/60/180/360분 중 하나",
    }),
  digestEnabled: checkbox,
  digestHourKst: intIn(0, 23),
  replyLanguage: z.enum(["auto", "ko", "en", "ja", "zh"]).default("auto"),
});

export type EmailSettingsInputT = z.infer<typeof EmailSettingsInput>;

export type EmailSettingsActionResult =
  | { ok: true }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_INPUT" | "DB_ERROR";
      message?: string;
    };
