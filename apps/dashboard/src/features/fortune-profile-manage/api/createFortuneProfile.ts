"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { fortuneProfiles } from "@/shared/lib/db/schema";
import {
  FortuneProfileInput,
  type FortuneProfileActionResult,
} from "./_schema";

export async function createFortuneProfile(
  formData: FormData,
): Promise<FortuneProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = FortuneProfileInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    const [row] = await db
      .insert(fortuneProfiles)
      .values({ userId: session.user.id, ...parsed.data })
      .returning({ id: fortuneProfiles.id });

    revalidatePath("/fortune");
    revalidatePath("/");
    return { ok: true, id: row.id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB insert failed",
    };
  }
}
