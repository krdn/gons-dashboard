import type { PersonaKey, Verdict, ModelName } from "./persona-types";

export interface Consensus {
  verdict: Verdict;
  score: string;
  oneLineConsensus: string;
  agreements: string[];
  disagreements: string[];
  riskRanking: string[];
  modelUsed: ModelName;
  successfulPersonas: PersonaKey[];
  failedPersonas: PersonaKey[];
}

export interface MarketSnapshot {
  price: number;
  changePct: number;
  currency: string;
  marketCap?: number;
  per?: number;
  pbr?: number;
  dividendYield?: number;
  debtRatio?: number;
  rsi14?: number;
  ma20?: number;
  ma60?: number;
  asOf: string;
}
