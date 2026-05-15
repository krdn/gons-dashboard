"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { computeProfileInputHash } from "@/features/tiger-consult/lib/hash";
import { TigerProfileInput, type TigerProfileActionResult } from "./_schema";

export async function updateTigerProfile(
  profileId: string,
  formData: FormData,
): Promise<TigerProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = TigerProfileInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }
  const inputHash = computeProfileInputHash(parsed.data);
  try {
    const result = await db
      .update(playmcpProfiles)
      .set({ ...parsed.data, inputHash, updatedAt: new Date() })
      .where(and(eq(playmcpProfiles.id, profileId), eq(playmcpProfiles.userId, session.user.id)))
      .returning({ id: playmcpProfiles.id });
    if (!result[0]) return { ok: false, code: "NOT_FOUND" };
    revalidatePath("/tiger");
    revalidatePath(`/tiger/${profileId}`);
    revalidatePath("/tiger/manage");
    return { ok: true, id: result[0].id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB update failed",
    };
  }
}
