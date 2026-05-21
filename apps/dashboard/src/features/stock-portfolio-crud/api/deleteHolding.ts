"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { DeleteHoldingSchema, type DeleteHoldingInput } from "../model/schema";

export interface DeleteHoldingResult {
  success: boolean;
  error?: string;
}

export async function deleteHolding(input: DeleteHoldingInput): Promise<DeleteHoldingResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = DeleteHoldingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "잘못된 ID 형식" };

  try {
    const result = await db
      .delete(portfolioHoldings)
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
