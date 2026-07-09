"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { createMemo } from "@/entities/memo/server";
import { deriveTitle, type MemoSource } from "@/entities/memo/client";

export interface CreateMemoInputAction {
  source: MemoSource;
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
  if (input.source !== "voice" && input.source !== "text") return { kind: "invalid" };

  const title = input.title?.trim() || deriveTitle(cleaned);

  return createMemo({ userId, source: input.source, title, rawContent: raw, cleanedContent: cleaned })
    .then(
      (memo) => {
        revalidatePath("/memos");
        return { kind: "ok" as const, id: memo.id };
      },
      () => ({ kind: "failed" as const }),
    );
}
