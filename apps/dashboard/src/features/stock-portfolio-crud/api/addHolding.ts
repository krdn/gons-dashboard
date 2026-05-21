"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
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

  try {
    const [row] = await db
      .insert(portfolioHoldings)
      .values({
        userId: session.user.id,
        symbol: parsed.data.symbol,
        assetClass: parsed.data.assetClass,
        market: parsed.data.market,
        displayName: parsed.data.displayName,
        quantity: parsed.data.quantity,
        avgCost: parsed.data.avgCost,
        purchasedAt: parsed.data.purchasedAt ?? null,
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
