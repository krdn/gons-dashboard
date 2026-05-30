import { z } from "zod";

export const AnalyzeTimeframeSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(12)
    // 영문 티커(AAPL) + KRX Yahoo 심볼(005930.KS, 036930.KQ, 우선주 00104K.KS).
    // 숫자를 막으면 KRX 코드가 거부되므로 숫자/마침표/하이픈을 함께 허용한다.
    .regex(/^[A-Za-z0-9.-]+$/, "티커는 영문/숫자/마침표/하이픈만 허용됩니다"),
  depth: z.enum(["full", "lite"]).default("lite"),
});

export type AnalyzeTimeframeInput = z.infer<typeof AnalyzeTimeframeSchema>;
