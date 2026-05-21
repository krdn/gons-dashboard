import { z } from "zod";

export const PersonaKeySchema = z.enum([
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
]);
export type PersonaKey = z.infer<typeof PersonaKeySchema>;

export const VerdictSchema = z.enum(["BUY", "HOLD", "SELL"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ModelNameSchema = z.enum(["claude", "codex", "gemini"]);
export type ModelName = z.infer<typeof ModelNameSchema>;

export const PersonaAnalysisSchema = z.object({
  persona: PersonaKeySchema,
  verdict: VerdictSchema,
  oneLineThesis: z.string().min(20).max(200),
  narrative: z.string().min(300).max(800),
  keyMetrics: z.record(z.string(), z.union([z.number(), z.string()])),
  risks: z.array(z.string().min(5).max(200)).min(1).max(5),
  modelUsed: ModelNameSchema,
});

export type PersonaAnalysis = z.infer<typeof PersonaAnalysisSchema>;
