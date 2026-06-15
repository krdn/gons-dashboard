"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { reclassifyRecent } from "@/features/gmail-sync";

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
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof Error ? err.message : "reclassify failed",
    };
  }
}
