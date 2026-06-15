"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { emailSettings } from "@/shared/lib/db/schema";
import {
  EmailSettingsInput,
  type EmailSettingsActionResult,
} from "./_schema";

export async function updateEmailSettings(
  formData: FormData,
): Promise<EmailSettingsActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  // 체크박스/멀티값은 Object.fromEntries로 안 잡히므로 수동 구성.
  const raw = {
    replyNeededLimit: formData.get("replyNeededLimit"),
    importantLimit: formData.get("importantLimit"),
    windowDays: formData.get("windowDays"),
    replySeverityThreshold: formData.get("replySeverityThreshold"),
    importantThreshold: formData.get("importantThreshold"),
    categories: formData.getAll("categories"),
    llmReplyEnabled: formData.get("llmReplyEnabled"),
    llmImportantEnabled: formData.get("llmImportantEnabled"),
    syncIntervalMinutes: formData.get("syncIntervalMinutes"),
    digestEnabled: formData.get("digestEnabled"),
    digestHourKst: formData.get("digestHourKst"),
  };

  const parsed = EmailSettingsInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  try {
    await db
      .insert(emailSettings)
      .values({ userId: session.user.id, ...parsed.data })
      .onConflictDoUpdate({
        target: emailSettings.userId,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB upsert failed",
    };
  }
}
