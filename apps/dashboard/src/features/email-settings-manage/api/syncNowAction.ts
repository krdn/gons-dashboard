"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { syncInbox } from "@/features/gmail-sync";
import { logger } from "@/shared/lib/log";

export type SyncNowResult =
  | { ok: true; classified: number; skipped: number }
  | { ok: false; code: "UNAUTHORIZED" | "REAUTH_REQUIRED" | "ERROR"; message?: string };

export async function syncNowAction(): Promise<SyncNowResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  try {
    const result = await syncInbox(session.user.id);
    if (result.kind === "reauth-required") {
      return { ok: false, code: "REAUTH_REQUIRED", message: "재로그인이 필요합니다" };
    }
    revalidatePath("/");
    return {
      ok: true,
      classified: result.classifiedCount ?? 0,
      skipped: result.skippedCount ?? 0,
    };
  } catch (err) {
    // #150이 markAsRead/archiveThread엔 넣었으나 이 수동 트리거는 누락된 비대칭 보완.
    logger.error("email/syncNowAction", "action-failed", {
      userId: session.user.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof Error ? err.message : "sync failed",
    };
  }
}
