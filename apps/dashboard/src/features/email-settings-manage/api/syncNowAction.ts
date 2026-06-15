"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { syncInbox } from "@/features/gmail-sync";

export type SyncNowResult =
  | { ok: true; classified: number; skipped: number; reauth: boolean }
  | { ok: false; code: "UNAUTHORIZED" | "ERROR"; message?: string };

export async function syncNowAction(): Promise<SyncNowResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  try {
    const result = await syncInbox(session.user.id);
    revalidatePath("/");
    return {
      ok: true,
      classified: result.classifiedCount ?? 0,
      skipped: result.skippedCount ?? 0,
      reauth: result.kind === "reauth-required",
    };
  } catch (err) {
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof Error ? err.message : "sync failed",
    };
  }
}
