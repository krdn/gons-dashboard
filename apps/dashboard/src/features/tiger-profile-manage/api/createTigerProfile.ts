"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { computeProfileInputHash } from "@/features/tiger-consult/lib/hash";
import { TigerProfileInput, type TigerProfileActionResult } from "./_schema";

export async function createTigerProfile(formData: FormData): Promise<TigerProfileActionResult> {
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
    const [row] = await db
      .insert(playmcpProfiles)
      .values({ userId: session.user.id, ...parsed.data, inputHash })
      .returning({ id: playmcpProfiles.id });
    revalidatePath("/tiger");
    revalidatePath("/tiger/manage");
    return { ok: true, id: row.id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB insert failed",
    };
  }
}
