import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockAnalysisCache,
  stockAnalysisRuns,
} from "@/shared/lib/db/schema";
import type { PersonaAnalysis, PersonaKey } from "./model/persona-types";
import type { Consensus, MarketSnapshot } from "./model/consensus-types";
import type { AnalysisRun, RunStatus } from "./model/run-types";

export type {
  PersonaAnalysis,
  PersonaKey,
  PersonaOrConsensus,
  ModelName,
  Verdict,
} from "./model/persona-types";
export type { Consensus, MarketSnapshot } from "./model/consensus-types";
export { DEFAULT_PERSONA_MODELS, PERSONA_DISPLAY } from "./model/persona-types";

// PR 2 (2026-05-23): 하드코딩 "v1.0" 제거 — 호출자가 PERSONA_PROMPT_VERSION 전달.
// orchestrator 가 @gons/stock-analysis 의 PERSONA_PROMPT_VERSION ("v2") 을 넘긴다.

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
  promptVersion: string,
): Promise<CachedAnalysisRow | null> {
  const rows = await db
    .select()
    .from(stockAnalysisCache)
    .where(
      and(
        eq(stockAnalysisCache.symbol, symbol),
        eq(stockAnalysisCache.analysisDate, analysisDate),
        eq(stockAnalysisCache.promptVersion, promptVersion),
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
  promptVersion: string;
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
      promptVersion: args.promptVersion,
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
        promptVersion: args.promptVersion,
        generatedAt: sql`now()`,
      },
    });
}

export type { AnalysisRun, RunStatus } from "./model/run-types";

/**
 * 같은 (userId, symbol, persona) 에 in-flight (queued/running) run 존재하면 그 row 반환.
 * 없으면 새 row 'queued' 로 insert. UNIQUE 위반 시 catch → 기존 in-flight row 조회.
 */
export async function startRun(args: {
  userId: string;
  symbol: string;
  persona: string | null;
}): Promise<AnalysisRun> {
  try {
    const [row] = await db
      .insert(stockAnalysisRuns)
      .values({
        userId: args.userId,
        symbol: args.symbol,
        persona: args.persona,
        status: "queued" satisfies RunStatus,
      })
      .returning();
    return rowToRun(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("stock_runs_in_flight_uq")) {
      const rows = await db
        .select()
        .from(stockAnalysisRuns)
        .where(
          and(
            eq(stockAnalysisRuns.userId, args.userId),
            eq(stockAnalysisRuns.symbol, args.symbol),
            args.persona === null
              ? sql`${stockAnalysisRuns.persona} IS NULL`
              : eq(stockAnalysisRuns.persona, args.persona),
            sql`${stockAnalysisRuns.status} IN ('queued','running')`,
          ),
        )
        .limit(1);
      if (rows.length > 0) return rowToRun(rows[0]);
    }
    throw err;
  }
}

export async function updateRun(
  id: string,
  patch: { status: RunStatus; errorMessage?: string },
): Promise<void> {
  await db
    .update(stockAnalysisRuns)
    .set({
      status: patch.status,
      errorMessage: patch.errorMessage ?? null,
      completedAt:
        patch.status === "completed" || patch.status === "failed"
          ? new Date()
          : null,
    })
    .where(eq(stockAnalysisRuns.id, id));
}

export async function getLatestRun(
  userId: string,
  symbol: string,
  persona: string | null,
): Promise<AnalysisRun | null> {
  const rows = await db
    .select()
    .from(stockAnalysisRuns)
    .where(
      and(
        eq(stockAnalysisRuns.userId, userId),
        eq(stockAnalysisRuns.symbol, symbol),
        persona === null
          ? sql`${stockAnalysisRuns.persona} IS NULL`
          : eq(stockAnalysisRuns.persona, persona),
      ),
    )
    .orderBy(desc(stockAnalysisRuns.startedAt))
    .limit(1);
  return rows.length === 0 ? null : rowToRun(rows[0]);
}

function rowToRun(r: typeof stockAnalysisRuns.$inferSelect): AnalysisRun {
  return {
    id: r.id,
    userId: r.userId,
    symbol: r.symbol,
    persona: r.persona as AnalysisRun["persona"],
    status: r.status as RunStatus,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
  };
}
