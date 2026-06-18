"use server";

// triggerAnalysis — lazy trigger Server Action.
// - 사용자 포트폴리오 종목인지 검증
// - rate-limit (분당 1회/유저/종목/페르소나, in-memory)
// - startRun 으로 run row 생성 (UNIQUE 위반은 entities 측에서 흡수 → 기존 in-flight 반환)
// - 신규 INSERT 이면 fire-and-forget 으로 analyzeStock 호출 + updateRun
// - 기존 in-flight 면 즉시 inFlight=true 로 반환 (호출 측이 폴링)

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { logger } from "@/shared/lib/log";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { startRun, updateRun } from "@/entities/stock-analysis/server";
import type { AssetClass } from "@/shared/lib/stock/types";
import { analyzeStock, type AnalyzeStockArgs } from "./orchestrator";

const PERSONA_VALUES = [
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
] as const;

const TriggerSchema = z.object({
  symbol: z.string().min(1).max(32),
  persona: z.enum(PERSONA_VALUES).optional(),
});

export interface TriggerResult {
  success: boolean;
  runId?: string;
  inFlight?: boolean;
  error?: string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
// 단일 인스턴스 가정. multi-instance 시 Redis 로 이전 필요.
// key = `${userId}:${symbol}:${persona ?? "*"}`
const lastTriggerAt = new Map<string, number>();

function rateLimitKey(
  userId: string,
  symbol: string,
  persona: string | null,
): string {
  return `${userId}:${symbol}:${persona ?? "*"}`;
}

export async function triggerAnalysis(input: {
  symbol: string;
  persona?: (typeof PERSONA_VALUES)[number];
}): Promise<TriggerResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = TriggerSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "잘못된 입력" };

  const userId = session.user.id;
  const symbol = parsed.data.symbol;
  const persona = parsed.data.persona ?? null;

  // 1. 사용자가 등록한 종목인지 검증
  const holdings = await db
    .select()
    .from(portfolioHoldings)
    .where(
      and(
        eq(portfolioHoldings.userId, userId),
        eq(portfolioHoldings.symbol, symbol),
      ),
    )
    .limit(1);
  const target = holdings[0];
  if (!target) return { success: false, error: "등록되지 않은 종목" };

  // 2. Rate limit (in-memory)
  const key = rateLimitKey(userId, symbol, persona);
  const last = lastTriggerAt.get(key);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_WINDOW_MS) {
    const remainSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - last)) / 1000);
    return {
      success: false,
      error: `잠시 후 다시 시도하세요 (${remainSec}초 남음)`,
    };
  }
  lastTriggerAt.set(key, now);

  // 3. run row 생성 (UNIQUE 위반 catch → 기존 in-flight 반환)
  const run = await startRun({ userId, symbol, persona });

  // 4. 신규 INSERT vs 기존 in-flight 분간 — startedAt heuristic (5초 이내 = 신규).
  // 완벽하지 않지만 v1 단순화. 정확한 분간은 startRun 시 inserted flag 반환 필요.
  if (run.status === "queued" || run.status === "running") {
    const startedRecently = Date.now() - new Date(run.startedAt).getTime() < 5_000;
    if (!startedRecently) {
      // 기존 in-flight — fire-and-forget 스킵 (호출 측이 폴링)
      return { success: true, runId: run.id, inFlight: true };
    }
  } else {
    // completed/failed run 이 반환되는 경우는 없어야 함 (startRun 은 queued 만 반환).
    // 방어적으로 inFlight=false 로 떨어뜨림.
    return { success: true, runId: run.id, inFlight: false };
  }

  // 5. fire-and-forget — Server Action 즉시 반환, background 30-60초 진행.
  // Node crash 시 stuck queued/running 가능 (Phase 8 cleanup job).
  const args: AnalyzeStockArgs = {
    symbol: target.symbol,
    displayName: target.displayName,
    assetClass: target.assetClass as AssetClass,
    market: target.market,
    userId,
  };
  void runAnalysis(run.id, args);

  return { success: true, runId: run.id, inFlight: false };
}

async function runAnalysis(
  runId: string,
  args: AnalyzeStockArgs,
): Promise<void> {
  try {
    await updateRun(runId, { status: "running" });
    const result = await analyzeStock(args);
    if (result.status === "failed") {
      await updateRun(runId, {
        status: "failed",
        errorMessage: "Analysis returned failed status",
      });
    } else {
      await updateRun(runId, { status: "completed" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("stock/trigger", "run-failed", { runId, message: msg });
    await updateRun(runId, { status: "failed", errorMessage: msg }).catch(
      () => {
        // updateRun 자체가 실패한 경우 (DB 다운 등) — 더 할 수 있는 것 없음.
      },
    );
  }
}
