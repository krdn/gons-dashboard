"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { TigerProfileActionResult } from "./_schema";

export async function deleteTigerProfile(profileId: string): Promise<TigerProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  try {
    const result = await db
      .delete(playmcpProfiles)
      .where(and(eq(playmcpProfiles.id, profileId), eq(playmcpProfiles.userId, session.user.id)))
      .returning({ id: playmcpProfiles.id });
    if (!result[0]) return { ok: false, code: "NOT_FOUND" };
    revalidatePath("/tiger");
    revalidatePath("/tiger/manage");
    return { ok: true, id: result[0].id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB delete failed",
    };
  }
}
