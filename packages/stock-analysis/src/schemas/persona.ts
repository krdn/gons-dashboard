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
  // null 허용: LLM 이 펀더멘털 누락 시 "추정 불가" + 일부 필드 null 응답.
  // 거부하면 페르소나 전체 reject → 캐시 누락 (2026-05-22 value 페르소나 사고).
  keyMetrics: z.record(
    z.string(),
    z.union([z.number(), z.string(), z.null()]),
  ),
  risks: z.array(z.string().min(5).max(200)).min(1).max(5),
  modelUsed: ModelNameSchema,
});

export type PersonaAnalysis = z.infer<typeof PersonaAnalysisSchema>;

// PersonaOrConsensus + 기본 모델 매핑 — persona-router (shared 레이어) 가 package 에서 직접 import 하도록 단일 정의 소스.
export type PersonaOrConsensus = PersonaKey | "consensus";

export const PERSONA_DISPLAY: Record<PersonaKey, string> = {
  wallStreet: "월스트리트 전문가",
  krExpert: "한국 전문가",
  value: "가치 투자",
  growth: "성장 투자",
  technical: "기술적 분석",
};

export const DEFAULT_PERSONA_MODELS: Record<PersonaOrConsensus, ModelName> = {
  wallStreet: "claude",
  krExpert: "claude",
  value: "codex",
  growth: "gemini",
  technical: "codex",
  consensus: "claude",
};
