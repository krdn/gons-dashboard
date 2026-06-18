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

/** flip 판정 입력 — DB 행에서 추출한 두 시점의 verdict + promptVersion. */
export interface VerdictComparison {
  symbol: string;
  yesterday: { verdict: Verdict; promptVersion: string };
  today: { verdict: Verdict; promptVersion: string };
}

/**
 * 순수 flip 판정 — DB 결합 없이 두 시점 비교만.
 *  - promptVersion 불일치 → null (비교 무의미)
 *  - verdict 동일 → null (flip 아님)
 *  - 다르면 FlipDetection
 */
export function compareVerdicts(input: VerdictComparison): FlipDetection | null {
  if (input.today.promptVersion !== input.yesterday.promptVersion) return null;
  if (input.today.verdict === input.yesterday.verdict) return null;
  return {
    symbol: input.symbol,
    fromVerdict: input.yesterday.verdict,
    toVerdict: input.today.verdict,
  };
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

  return compareVerdicts({
    symbol: args.symbol,
    yesterday: {
      verdict: (yesterdayRow.consensus as Consensus).verdict,
      promptVersion: yesterdayRow.promptVersion,
    },
    today: {
      verdict: (todayRow.consensus as Consensus).verdict,
      promptVersion: todayRow.promptVersion,
    },
  });
}
