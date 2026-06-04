import "server-only";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockTimeframeAnalyses } from "@/shared/lib/db/schema";
import type { AnalysisResult, TimeframeHistoryItem, StockTimeframeAnalysisRow } from "./model/types";

export async function insertTimeframeAnalysis(args: {
  userId: string;
  ticker: string;
  depth: "full" | "lite";
  result: AnalysisResult;
  costUsd: number | null;
}): Promise<string> {
  const [row] = await db
    .insert(stockTimeframeAnalyses)
    .values({
      userId: args.userId,
      ticker: args.ticker,
      depth: args.depth,
      asOf: new Date(args.result.asOf),
      result: args.result,
      costUsd: args.costUsd != null ? String(args.costUsd) : null,
    })
    .returning({ id: stockTimeframeAnalyses.id });
  return row.id;
}

// 사용자 격리: 본인 이력만 조회
export async function listTimeframeAnalyses(
  userId: string,
  limit = 20,
): Promise<TimeframeHistoryItem[]> {
  const rows = await db
    .select({
      id: stockTimeframeAnalyses.id,
      ticker: stockTimeframeAnalyses.ticker,
      depth: stockTimeframeAnalyses.depth,
      asOf: stockTimeframeAnalyses.asOf,
      createdAt: stockTimeframeAnalyses.createdAt,
    })
    .from(stockTimeframeAnalyses)
    .where(eq(stockTimeframeAnalyses.userId, userId))
    .orderBy(desc(stockTimeframeAnalyses.createdAt))
    .limit(limit);
  return rows;
}

export async function getTimeframeAnalysisById(
  userId: string,
  id: string,
): Promise<StockTimeframeAnalysisRow | null> {
  const [row] = await db
    .select()
    .from(stockTimeframeAnalyses)
    .where(and(eq(stockTimeframeAnalyses.id, id), eq(stockTimeframeAnalyses.userId, userId)))
    .limit(1);
  return row ?? null;
}
