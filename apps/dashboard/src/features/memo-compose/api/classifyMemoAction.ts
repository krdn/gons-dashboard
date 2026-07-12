"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { getMemo, classifyAndPersistMemoCategory } from "@/entities/memo/server";
import type { MemoCategory } from "@/entities/memo/client";

export type ClassifyMemoActionResult =
  | { kind: "classified"; category: MemoCategory }
  | { kind: "already-classified" }
  | { kind: "not-found" }
  | { kind: "llm-unavailable" }
  | { kind: "failed" };

/**
 * 저장 직후 클라이언트가 fire-and-forget으로 호출하는 분류 트리거.
 * 실패해도 무해 — category null 유지 → cron sweep(memo-classify)이 회수.
 */
export async function classifyMemoAction(
  memoId: string,
): Promise<ClassifyMemoActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  try {
    // 소유권 검증 — 타인 메모 id로는 분류(LLM 호출 포함)를 트리거할 수 없다.
    const memo = await getMemo(userId, memoId);
    if (!memo) return { kind: "not-found" };

    const result = await classifyAndPersistMemoCategory(memo);
    if (result.kind === "classified") revalidatePath("/memos");
    return result;
  } catch {
    return { kind: "failed" };
  }
}
