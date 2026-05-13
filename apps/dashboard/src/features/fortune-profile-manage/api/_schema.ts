import "server-only";
import { z } from "zod";

export const RELATION_ENUM = [
  "self",
  "spouse",
  "child",
  "parent",
  "sibling",
  "relative",
  "friend",
  "other",
] as const;

// 빈 문자열을 null로 정규화 — 브라우저 form은 비어있는 input을 "" 로 보내기 때문.
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
    .nullable();

export const FortuneProfileInput = z.object({
  name: z.string().min(1).max(50),
  nameHanja: optionalText(20),
  relation: z.enum(RELATION_ENUM),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  calendar: z.enum(["solar", "lunar"]),
  gender: z.enum(["male", "female"]),
  birthTime: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
    .pipe(z.union([z.literal(null), z.string().regex(/^\d{2}:\d{2}$/, "HH:MM")]))
    .nullable(),
  birthCity: optionalText(50),
});

export type FortuneProfileInputT = z.infer<typeof FortuneProfileInput>;

export type FortuneProfileActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "DB_ERROR";
      message?: string;
    };
