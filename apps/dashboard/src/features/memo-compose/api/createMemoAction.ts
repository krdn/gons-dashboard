"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { auth } from "@/shared/lib/auth";
import { createMemo, classifyAndPersistMemoCategory } from "@/entities/memo/server";
import { deriveTitle, type MemoSource } from "@/entities/memo/client";
// features→features 허용 예외 — 저장 후 백그라운드 파이프라인 결합.
import { extractAndPersistMemoActions } from "@/features/memo-actions";

const MAX_MEMO_LEN = 20_000;

export interface CreateMemoInputAction {
  source: Exclude<MemoSource, "agent">;
  rawContent: string;
  cleanedContent: string;
  title?: string;
}

export type CreateMemoActionResult =
  | { kind: "ok"; id: string }
  | { kind: "invalid" }
  | { kind: "failed" };

export async function createMemoAction(
  input: CreateMemoInputAction,
): Promise<CreateMemoActionResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  const raw = input.rawContent.trim();
  const cleaned = input.cleanedContent.trim();
  if (raw.length === 0 || cleaned.length === 0) return { kind: "invalid" };
  if (raw.length > MAX_MEMO_LEN || cleaned.length > MAX_MEMO_LEN) return { kind: "invalid" };
  if (input.source !== "voice" && input.source !== "text") return { kind: "invalid" };

  const title = input.title?.trim() || deriveTitle(cleaned);

  return createMemo({ userId, source: input.source, title, rawContent: raw, cleanedContent: cleaned })
    .then(
      (memo) => {
        // 분류·액션 추출은 응답 후 서버 백그라운드(after)로 — 클라이언트 Server Action
        // 직렬 큐를 LLM 지연만큼 점유하지 않는다 (리뷰 확정 결함). 둘 다 best-effort,
        // 서로 독립(allSettled) — 실패는 각각의 cron sweep이 회수.
        after(() =>
          Promise.allSettled([
            classifyAndPersistMemoCategory(memo),
            extractAndPersistMemoActions(memo, new Date()),
          ]),
        );
        revalidatePath("/memos");
        return { kind: "ok" as const, id: memo.id };
      },
      () => ({ kind: "failed" as const }),
    );
}
