"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { searchMemos, type Memo } from "@/entities/memo/server";

export type SearchMemosResult =
  | { kind: "ok"; memos: Memo[]; truncated: boolean }
  | { kind: "failed" };

/** 읽기 전용 검색 — revalidate 없음. 토큰화·이스케이프·상한은 repo가 담당. */
export async function searchMemosAction(query: string): Promise<SearchMemosResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (query.trim().length === 0) return { kind: "ok", memos: [], truncated: false };

  return searchMemos(session.user.id, query).then(
    ({ memos, truncated }) => ({ kind: "ok" as const, memos, truncated }),
    () => ({ kind: "failed" as const }),
  );
}
