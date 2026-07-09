"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { deleteMemo } from "@/entities/memo/server";

export type DeleteMemoResult = { kind: "ok" } | { kind: "not-found" };

export async function deleteMemoAction(id: string): Promise<DeleteMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return deleteMemo(session.user.id, id).then(
    (deleted) => {
      if (!deleted) return { kind: "not-found" as const };
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "not-found" as const }),
  );
}
