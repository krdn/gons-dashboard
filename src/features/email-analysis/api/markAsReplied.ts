// "답장함" 클릭 — eng review §3 D6 결정대로 5초 undo 윈도우 + 멱등.
//
// 사용자 흐름:
//  - 클릭 → optimistic UI에서 카드 즉시 사라짐
//  - 5초 후 DB 영속 (undo 미클릭 시)
//  - undo 클릭 시 → unmarkReplied로 되돌림
//
// v0.1: 단순화 — 클릭 즉시 DB write. 5초 undo는 클라이언트 측에서 setTimeout.
"use server";

import "server-only";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { replyNeeded } from "@/shared/lib/db/schema";

export async function markAsReplied(threadId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await db
    .update(replyNeeded)
    .set({
      repliedAt: new Date(),
      userAction: "replied",
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

export async function unmarkReplied(threadId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await db
    .update(replyNeeded)
    .set({
      repliedAt: null,
      userAction: "none",
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
