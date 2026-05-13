"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";
import type { FortuneProfileActionResult } from "./_schema";

const DeleteInput = z.object({ id: z.string().uuid() });

export async function deleteFortuneProfile(
  formData: FormData,
): Promise<FortuneProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = DeleteInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };

  try {
    const result = await db
      .delete(fortuneProfiles)
      .where(
        and(
          eq(fortuneProfiles.id, parsed.data.id),
          eq(fortuneProfiles.userId, session.user.id),
        ),
      )
      .returning({ id: fortuneProfiles.id });

    if (result.length === 0) return { ok: false, code: "NOT_FOUND" };

    revalidatePath("/fortune");
    revalidatePath("/");
    return { ok: true, id: result[0].id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB delete failed",
    };
  }
}
