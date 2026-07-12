"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { updateActionItemStatus } from "@/entities/memo/server";

// proposed로의 전이는 없다 — 클라이언트가 요청 가능한 목적지 3종만.
export type ActionItemStatusUpdate = "accepted" | "dismissed" | "done";

export type UpdateActionItemResult =
  | { kind: "ok" }
  | { kind: "not-found" } // 타인 항목·불법 전이·동시 전이 경합 모두 여기로 수렴
  | { kind: "failed" };

export async function updateActionItemStatusAction(
  id: string,
  to: ActionItemStatusUpdate,
): Promise<UpdateActionItemResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  if (to !== "accepted" && to !== "dismissed" && to !== "done") {
    return { kind: "failed" };
  }

  return updateActionItemStatus(userId, id, to).then(
    (row) => {
      if (!row) return { kind: "not-found" as const };
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "failed" as const }),
  );
}
