"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { reclassifyRecent } from "@/features/gmail-sync";
import { logger } from "@/shared/lib/log";

export type ReclassifyActionResult =
  | { ok: true; classified: number; skipped: number; threadsInWindow: number }
  | { ok: false; code: "UNAUTHORIZED" | "ERROR"; message?: string };

export async function reclassifyAction(): Promise<ReclassifyActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  try {
    const result = await reclassifyRecent({
      userId: session.user.id,
      hoursBack: 24,
      force: false,
    });
    if (result.kind === "user-not-found") {
      return { ok: false, code: "ERROR", message: "user not found" };
    }
    revalidatePath("/");
    return {
      ok: true,
      classified: result.classified ?? 0,
      skipped: result.skipped ?? 0,
      threadsInWindow: result.threadsInWindow ?? 0,
    };
  } catch (err) {
    // #150이 markAsRead/archiveThread엔 넣었으나 이 수동 트리거는 누락된 비대칭 보완.
    logger.error("email/reclassifyAction", "action-failed", {
      userId: session.user.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof Error ? err.message : "reclassify failed",
    };
  }
}
