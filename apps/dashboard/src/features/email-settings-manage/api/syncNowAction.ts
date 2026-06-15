"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { syncInbox } from "@/features/gmail-sync";

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
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof Error ? err.message : "sync failed",
    };
  }
}
