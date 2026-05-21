import type { MarketSnapshot } from "../schemas/consensus";

export interface PersonaInput {
  symbol: string;
  displayName: string;
  assetClass: "stock" | "crypto" | "commodity";
  market: string;
  snapshot: MarketSnapshot;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export type PromptBuilder = (input: PersonaInput) => BuiltPrompt;
