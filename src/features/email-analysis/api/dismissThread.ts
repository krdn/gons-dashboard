// "무시" 클릭 — 24시간 dismissed 후 재등장.
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { replyNeeded } from "@/shared/lib/db/schema";

export async function dismissThread(threadId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await db
    .update(replyNeeded)
    .set({
      dismissedAt: new Date(),
      userAction: "dismissed",
      userActionAt: new Date(),
    })
    .where(
      and(
        eq(replyNeeded.threadId, threadId),
        eq(replyNeeded.userId, session.user.id),
      ),
    );

  revalidatePath("/");
}
