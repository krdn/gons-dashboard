import "server-only";
import { z } from "zod";
import { RELATION_VALUES } from "@/entities/tiger-reading";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
    .nullable();

export const TigerProfileInput = z.object({
  nickname: z.string().min(1, "닉네임 필수").max(30),
  relation: z.enum(RELATION_VALUES),
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

export type TigerProfileInputT = z.infer<typeof TigerProfileInput>;

export type TigerProfileActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "DB_ERROR";
      message?: string;
    };
