"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { UpdateHoldingSchema, type UpdateHoldingInput } from "../model/schema";

export interface UpdateHoldingResult {
  success: boolean;
  error?: string;
}

export async function updateHolding(input: UpdateHoldingInput): Promise<UpdateHoldingResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = UpdateHoldingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "검증 실패" };
  }

  const updateValues: Record<string, string | null | Date | boolean> = {};
  if (parsed.data.quantity !== undefined) updateValues.quantity = parsed.data.quantity;
  if (parsed.data.avgCost !== undefined) updateValues.avgCost = parsed.data.avgCost;
  if (parsed.data.purchasedAt !== undefined) updateValues.purchasedAt = parsed.data.purchasedAt;
  if (parsed.data.kind !== undefined) updateValues.kind = parsed.data.kind;
  if (parsed.data.pushOptIn !== undefined) updateValues.pushOptIn = parsed.data.pushOptIn;
  updateValues.updatedAt = new Date();

  // updatedAt 외 변경 사항이 없으면 no-op
  if (Object.keys(updateValues).length === 1) return { success: true };

  try {
    const result = await db
      .update(portfolioHoldings)
      .set(updateValues)
      .where(
        and(
          eq(portfolioHoldings.id, parsed.data.id),
          eq(portfolioHoldings.userId, session.user.id),
        ),
      )
      .returning({ id: portfolioHoldings.id });
    if (result.length === 0) return { success: false, error: "종목을 찾을 수 없습니다" };
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "DB 에러" };
  }
}
