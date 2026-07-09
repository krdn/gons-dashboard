"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { updateMemo } from "@/entities/memo/server";
import { deriveTitle } from "@/entities/memo/client";

export type UpdateMemoResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "failed" };

export async function updateMemoAction(
  id: string,
  patch: { title?: string; cleanedContent: string },
): Promise<UpdateMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const cleaned = patch.cleanedContent.trim();
  if (cleaned.length === 0) return { kind: "invalid" };
  const title = patch.title?.trim() || deriveTitle(cleaned);

  return updateMemo(session.user.id, id, { title, cleanedContent: cleaned }).then(
    (memo) => {
      if (!memo) return { kind: "not-found" as const };
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "failed" as const }),
  );
}
