import { z } from "zod";

export const AnalyzeTimeframeSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z.-]+$/, "티커는 영문/마침표/하이픈만 허용됩니다"),
  depth: z.enum(["full", "lite"]).default("lite"),
});

export type AnalyzeTimeframeInput = z.infer<typeof AnalyzeTimeframeSchema>;
