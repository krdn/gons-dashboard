"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";
import {
  FortuneProfileInput,
  type FortuneProfileActionResult,
} from "./_schema";

const UpdateInput = FortuneProfileInput.extend({
  id: z.string().uuid(),
});

export async function updateFortuneProfile(
  formData: FormData,
): Promise<FortuneProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  const { id, ...data } = parsed.data;

  try {
    // ownership 검증을 WHERE 절에 함께 — 다른 사용자 id면 0 rows updated.
    const result = await db
      .update(fortuneProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(fortuneProfiles.id, id),
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
      message: err instanceof Error ? err.message : "DB update failed",
    };
  }
}
