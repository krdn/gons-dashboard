"use server";

import { revalidatePath } from "next/cache";
import { composeTickerAnalysis } from "@krdn/tickerlens";
import { auth } from "@/shared/lib/auth";
import { insertTimeframeAnalysis } from "@/entities/stock-timeframe/server";
import { buildTickerlensModelConfig } from "../lib/tickerlens-adapter";
import { AnalyzeTimeframeSchema, type AnalyzeTimeframeInput } from "../model/schema";
import type { AnalysisResult } from "@/entities/stock-timeframe/model/types";

export interface AnalyzeTimeframeResult {
  success: boolean;
  error?: string;
  id?: string;
  result?: AnalysisResult;
}

export async function analyzeTimeframe(
  input: AnalyzeTimeframeInput,
): Promise<AnalyzeTimeframeResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = AnalyzeTimeframeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "검증 실패" };
  }
  const ticker = parsed.data.ticker.toUpperCase();
  const depth = parsed.data.depth;

  let result: AnalysisResult;
  try {
    result = await composeTickerAnalysis(ticker, {
      configAdapter: buildTickerlensModelConfig(),
      depth,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "분석 호출 실패";
    return { success: false, error: msg };
  }

  if (result.meta.completed === 0) {
    return {
      success: false,
      error: `${ticker} 분석에 실패했습니다 (모든 관점 실패). 잠시 후 다시 시도하세요.`,
    };
  }

  const id = await insertTimeframeAnalysis({
    userId: session.user.id,
    ticker,
    depth,
    result,
    costUsd: result.meta.totalCostUsd ?? null,
  });

  revalidatePath("/stocks");
  return { success: true, id, result };
}
