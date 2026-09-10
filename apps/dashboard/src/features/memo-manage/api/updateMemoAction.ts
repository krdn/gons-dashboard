"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { updateMemo, getMemo } from "@/entities/memo/server";
import { deriveTitle } from "@/entities/memo/client";

export type UpdateMemoResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "failed" }
  | { kind: "conflict" };

export async function updateMemoAction(
  id: string,
  patch: { title?: string; cleanedContent: string; expected?: { title: string; cleanedContent: string } },
): Promise<UpdateMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;
  const cleaned = patch.cleanedContent.trim();
  if (cleaned.length === 0) return { kind: "invalid" };
  const title = patch.title?.trim() || deriveTitle(cleaned);

  const saving = patch.expected
    ? updateMemo(userId, id, { title, cleanedContent: cleaned }, patch.expected)
    : updateMemo(userId, id, { title, cleanedContent: cleaned });
  return saving.then(
    async (memo) => {
      if (!memo) {
        if (patch.expected && await getMemo(userId, id)) return { kind: "conflict" as const };
        return { kind: "not-found" as const };
      }
      revalidatePath("/memos");
      revalidatePath("/knowledge");
      revalidatePath("/projects");
      revalidatePath(`/knowledge/${id}`);
      revalidatePath("/");
      return { kind: "ok" as const };
    },
    () => ({ kind: "failed" as const }),
  );
}
