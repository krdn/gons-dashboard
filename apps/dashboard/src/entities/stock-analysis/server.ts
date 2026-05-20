import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockAnalysisCache } from "@/shared/lib/db/schema";
import type { PersonaAnalysis, PersonaKey } from "./model/persona-types";
import type { Consensus, MarketSnapshot } from "./model/consensus-types";

export type {
  PersonaAnalysis,
  PersonaKey,
  PersonaOrConsensus,
  ModelName,
  Verdict,
} from "./model/persona-types";
export type { Consensus, MarketSnapshot } from "./model/consensus-types";
export { DEFAULT_PERSONA_MODELS, PERSONA_DISPLAY } from "./model/persona-types";

export const PROMPT_VERSION = "v1.0";

export interface CachedAnalysisRow {
  symbol: string;
  analysisDate: string;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  marketSnapshot: MarketSnapshot;
  promptVersion: string;
  generatedAt: string;
}

export async function getCachedAnalysis(
  symbol: string,
  analysisDate: string,
  userId: string | null,
): Promise<CachedAnalysisRow | null> {
  const rows = await db
    .select()
    .from(stockAnalysisCache)
    .where(
      and(
        eq(stockAnalysisCache.symbol, symbol),
        eq(stockAnalysisCache.analysisDate, analysisDate),
        userId === null
          ? sql`${stockAnalysisCache.userId} IS NULL`
          : eq(stockAnalysisCache.userId, userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    symbol: r.symbol,
    analysisDate: r.analysisDate,
    personas: r.personas as CachedAnalysisRow["personas"],
    consensus: r.consensus as Consensus,
    marketSnapshot: r.marketSnapshot as MarketSnapshot,
    promptVersion: r.promptVersion,
    generatedAt: r.generatedAt.toISOString(),
  };
}

export interface UpsertAnalysisArgs {
  symbol: string;
  analysisDate: string;
  userId: string | null;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  marketSnapshot: MarketSnapshot;
}

export async function upsertAnalysis(args: UpsertAnalysisArgs): Promise<void> {
  await db
    .insert(stockAnalysisCache)
    .values({
      symbol: args.symbol,
      analysisDate: args.analysisDate,
      userId: args.userId,
      personas: args.personas,
      consensus: args.consensus,
      marketSnapshot: args.marketSnapshot,
      promptVersion: PROMPT_VERSION,
    })
    .onConflictDoUpdate({
      target: [
        stockAnalysisCache.symbol,
        stockAnalysisCache.analysisDate,
        stockAnalysisCache.userId,
      ],
      set: {
        personas: args.personas,
        consensus: args.consensus,
        marketSnapshot: args.marketSnapshot,
        promptVersion: PROMPT_VERSION,
        generatedAt: sql`now()`,
      },
    });
}
