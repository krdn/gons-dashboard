// detectConsensusFlip — 어제 vs 오늘 글로벌 캐시(user_id IS NULL)의
// consensus.verdict 를 비교해 flip 여부 판정. prompt_version 다르면 비교 무의미 → null.
import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockAnalysisCache } from "@/shared/lib/db/schema";
import type { Consensus } from "@gons/stock-analysis";

export type Verdict = "BUY" | "HOLD" | "SELL";

export interface FlipDetection {
  symbol: string;
  fromVerdict: Verdict;
  toVerdict: Verdict;
}

export async function detectConsensusFlip(args: {
  symbol: string;
  yesterdayDate: string; // 'YYYY-MM-DD'
  todayDate: string;
}): Promise<FlipDetection | null> {
  const rows = await db
    .select({
      analysisDate: stockAnalysisCache.analysisDate,
      consensus: stockAnalysisCache.consensus,
      promptVersion: stockAnalysisCache.promptVersion,
    })
    .from(stockAnalysisCache)
    .where(
      and(
        eq(stockAnalysisCache.symbol, args.symbol),
        isNull(stockAnalysisCache.userId), // 글로벌 캐시 only
      ),
    );

  const todayRow = rows.find((r) => String(r.analysisDate) === args.todayDate);
  const yesterdayRow = rows.find(
    (r) => String(r.analysisDate) === args.yesterdayDate,
  );

  if (!todayRow || !yesterdayRow) return null;
  if (todayRow.promptVersion !== yesterdayRow.promptVersion) return null;

  const todayVerdict = (todayRow.consensus as Consensus).verdict;
  const yesterdayVerdict = (yesterdayRow.consensus as Consensus).verdict;

  if (todayVerdict === yesterdayVerdict) return null;

  return {
    symbol: args.symbol,
    fromVerdict: yesterdayVerdict,
    toVerdict: todayVerdict,
  };
}
