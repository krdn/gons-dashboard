"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { AddHoldingSchema, type AddHoldingInput } from "../model/schema";

export interface AddHoldingResult {
  success: boolean;
  error?: string;
  holdingId?: string;
}

export async function addHolding(input: AddHoldingInput): Promise<AddHoldingResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = AddHoldingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "검증 실패" };
  }
  const data = parsed.data;

  // watchlist 캡 검증
  if (data.kind === "watchlist") {
    const cap = env.STOCK_WATCHLIST_MAX_PER_USER;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(portfolioHoldings)
      .where(
        and(
          eq(portfolioHoldings.userId, session.user.id),
          eq(portfolioHoldings.kind, "watchlist"),
        ),
      );
    if ((row?.count ?? 0) >= cap) {
      return {
        success: false,
        error: `관심종목은 최대 ${cap}개까지 등록 가능합니다`,
      };
    }
  }

  // kind 별 pushOptIn 기본값 (holding=true, watchlist=false)
  const pushOptInDefault = data.kind === "holding";
  const pushOptIn = data.pushOptIn ?? pushOptInDefault;

  try {
    const [row] = await db
      .insert(portfolioHoldings)
      .values({
        userId: session.user.id,
        symbol: data.symbol,
        assetClass: data.assetClass,
        market: data.market,
        displayName: data.displayName,
        kind: data.kind,
        quantity: data.kind === "watchlist" ? data.quantity ?? null : data.quantity,
        avgCost: data.kind === "watchlist" ? data.avgCost ?? null : data.avgCost,
        purchasedAt: data.purchasedAt ?? null,
        pushOptIn,
      })
      .returning({ id: portfolioHoldings.id });
    revalidatePath("/");
    return { success: true, holdingId: row.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "DB 에러";
    if (msg.includes("portfolio_holdings_user_symbol_uq")) {
      return { success: false, error: "이미 등록된 종목입니다" };
    }
    return { success: false, error: msg };
  }
}
