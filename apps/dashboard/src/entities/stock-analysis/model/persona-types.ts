export type PersonaKey = "wallStreet" | "krExpert" | "value" | "growth" | "technical";
export type PersonaOrConsensus = PersonaKey | "consensus";
export type ModelName = "claude" | "codex" | "gemini";
export type Verdict = "BUY" | "HOLD" | "SELL";

export interface PersonaAnalysis {
  persona: PersonaKey;
  verdict: Verdict;
  oneLineThesis: string;
  narrative: string;
  keyMetrics: Record<string, number | string>;
  risks: string[];
  modelUsed: ModelName;
}

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
