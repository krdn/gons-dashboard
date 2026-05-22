// Client-safe entrypoint — schemas + types + consensus 만 export.
// adapters/yahoo (yahoo-finance2 의 @deno/shim-deno 의존) 는 제외하여
// Next.js client bundle graph 에 Node-only 모듈이 끌려오지 않도록 분리한다.
//
// Server-side 진입점은 ./index.ts (default `@gons/stock-analysis`).
// Client-side import 는 `@gons/stock-analysis/client` 사용.
//
// Gotcha #1 (entity barrel server/client seam) + Gotcha #7 (features barrel
// server/client seam) 와 동일 패턴 — package 레이어에도 같은 seam 적용.

export type {
  NormalizedQuote,
  NormalizedSearchResult,
  NormalizedFundamentals,
  AssetClass,
  Market,
} from "./adapters/normalized-types";

export {
  PersonaAnalysisSchema,
  PersonaKeySchema,
  VerdictSchema,
  ModelNameSchema,
  ConsensusSchema,
  MarketSnapshotSchema,
  PERSONA_DISPLAY,
  DEFAULT_PERSONA_MODELS,
  type PersonaAnalysis,
  type PersonaKey,
  type PersonaOrConsensus,
  type Verdict,
  type ModelName,
  type Consensus,
  type MarketSnapshot,
} from "./schemas";

export { PERSONA_BUILDERS } from "./personas";
export type { PersonaInput, BuiltPrompt, PromptBuilder } from "./personas";
export { buildConsensusPrompt, tallyVerdicts } from "./consensus";
