// "무시" 클릭 — 24시간 dismissed 후 재등장.
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { replyNeeded } from "@/shared/lib/db/schema";
import { logger } from "@/shared/lib/log";
import { ROUTE_DASHBOARD } from "@/shared/config/routes";
import type { ActionResult } from "./markAsRead";

export async function dismissThread(threadId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, reason: "unauthorized" };
  }
  const userId = session.user.id;

  try {
    await db
      .update(replyNeeded)
      .set({
        dismissedAt: new Date(),
        userAction: "dismissed",
        userActionAt: new Date(),
      })
      .where(
        and(eq(replyNeeded.threadId, threadId), eq(replyNeeded.userId, userId)),
      );
  } catch (err) {
    logger.error("dismissThread", "db-update-failed", {
      sessionUserId: userId,
      threadId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "db-error" };
  }

  revalidatePath(ROUTE_DASHBOARD);
  return { ok: true };
}
