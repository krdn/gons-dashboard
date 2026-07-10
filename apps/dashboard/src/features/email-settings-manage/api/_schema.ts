import "server-only";
import { z } from "zod";
import {
  isLlmModelIdForProvider,
  sanitizeLlmModelId,
} from "@/shared/lib/llm/provider-model-catalog";

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
  replyModel: z.enum(["gemini", "codex", "claude"]).default("gemini"),
  // 상세 모델 ID — 빈 문자열/누락 = null(서버 기본값 자동). 형식은 sanitize 화이트리스트.
  replyModelId: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) =>
      typeof v === "string" && v.trim().length > 0 ? v.trim() : null,
    )
    .refine((v) => v === null || sanitizeLlmModelId(v) !== null, {
      message: "상세 모델 ID 형식이 올바르지 않습니다",
    }),
})
  // 상세 모델이 선택한 공급사 계열인지 교차 검증 (예: replyModel=gemini + gpt-* 거부).
  .superRefine((data, ctx) => {
    if (
      data.replyModelId !== null &&
      !isLlmModelIdForProvider(data.replyModel, data.replyModelId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replyModelId"],
        message: "상세 모델이 선택한 AI 공급사와 일치하지 않습니다",
      });
    }
  });

export type EmailSettingsActionResult =
  | { ok: true }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_INPUT" | "DB_ERROR";
      message?: string;
    };
