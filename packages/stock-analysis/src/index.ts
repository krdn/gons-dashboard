// Public API for @gons/stock-analysis package.
export {
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooDailyOHLC,
  fetchYahooSearch,
  YahooFetchError,
} from "./adapters/yahoo";
export type {
  NormalizedQuote,
  NormalizedSearchResult,
  NormalizedFundamentals,
  AssetClass,
  Market,
} from "./adapters/normalized-types";

// Schemas
export {
  PersonaAnalysisSchema,
  PersonaKeySchema,
  VerdictSchema,
  ModelNameSchema,
  ConsensusSchema,
  MarketSnapshotSchema,
  type PersonaAnalysis,
  type PersonaKey,
  type Verdict,
  type ModelName,
  type Consensus,
  type MarketSnapshot,
} from "./schemas";

// Personas + Consensus
export { PERSONA_BUILDERS } from "./personas";
export type { PersonaInput, BuiltPrompt, PromptBuilder } from "./personas";
export { buildConsensusPrompt, tallyVerdicts } from "./consensus";
