"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { setMemoCategoryOwned, isValidCategorySlug } from "@/entities/memo/server";

export type UpdateMemoCategoryResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "failed" };

/**
 * LLM 오분류 수동 정정 — 등록된 카테고리 slug만 허용.
 * 형식은 여기서 거르고, 존재하지 않는 slug는 FK 위반으로 failed 수렴 (최종 방어는 DB).
 */
export async function updateMemoCategoryAction(
  id: string,
  category: string,
): Promise<UpdateMemoCategoryResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!isValidCategorySlug(category)) return { kind: "invalid" };

  return setMemoCategoryOwned(session.user.id, id, category).then(
    (updated) => {
      if (!updated) return { kind: "not-found" as const };
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "failed" as const }),
  );
}
