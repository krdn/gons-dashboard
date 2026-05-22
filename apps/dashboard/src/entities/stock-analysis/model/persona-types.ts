// 단일 정의 소스는 @gons/stock-analysis. 여기서는 dashboard 안에서 익숙한 import path 유지 + boundaries 룰 회피용 re-export.
//
// `@gons/stock-analysis/client` 서브패스 사용 — top-level entrypoint 는 yahoo-finance2
// (Node-only) 를 끌어와서 client component graph 가 빌드 실패한다 (Gotcha #7 패턴).
export type {
  PersonaKey,
  PersonaOrConsensus,
  ModelName,
  Verdict,
  PersonaAnalysis,
} from "@gons/stock-analysis/client";

export {
  PERSONA_DISPLAY,
  DEFAULT_PERSONA_MODELS,
} from "@gons/stock-analysis/client";
