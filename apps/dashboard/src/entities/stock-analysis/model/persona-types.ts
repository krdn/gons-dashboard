// 단일 정의 소스는 @gons/stock-analysis. 여기서는 dashboard 안에서 익숙한 import path 유지 + boundaries 룰 회피용 re-export.
export type {
  PersonaKey,
  PersonaOrConsensus,
  ModelName,
  Verdict,
  PersonaAnalysis,
} from "@gons/stock-analysis";

export {
  PERSONA_DISPLAY,
  DEFAULT_PERSONA_MODELS,
} from "@gons/stock-analysis";
