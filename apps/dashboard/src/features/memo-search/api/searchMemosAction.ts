"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { searchMemos, listMemos, isValidCategorySlug, type Memo } from "@/entities/memo/server";

export type SearchMemosResult =
  | { kind: "ok"; memos: Memo[]; truncated: boolean }
  | { kind: "failed" };

/**
 * 읽기 전용 검색·필터 — revalidate 없음. 토큰화·이스케이프·상한은 repo가 담당.
 * category는 서버 WHERE 조건 — 클라이언트 post-LIMIT 필터는 컷 밖 메모를 가려
 * false-empty를 만든다 (레포 교훈: post-LIMIT .filter는 버그).
 * 쿼리 없이 category만 오면 필터된 목록 조회로 동작한다.
 */
export async function searchMemosAction(
  query: string,
  category: string | null = null,
): Promise<SearchMemosResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  // UI는 등록된 slug만 보낸다 — 형식 위반은 방어적으로 실패 처리.
  if (category !== null && !isValidCategorySlug(category)) return { kind: "failed" };

  if (query.trim().length === 0) {
    if (category === null) return { kind: "ok", memos: [], truncated: false };
    return listMemos(session.user.id, category).then(
      (memos) => ({ kind: "ok" as const, memos, truncated: false }),
      () => ({ kind: "failed" as const }),
    );
  }

  return searchMemos(session.user.id, query, category).then(
    ({ memos, truncated }) => ({ kind: "ok" as const, memos, truncated }),
    () => ({ kind: "failed" as const }),
  );
}
