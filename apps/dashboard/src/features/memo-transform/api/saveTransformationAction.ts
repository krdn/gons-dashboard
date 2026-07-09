"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { getMemo, upsertTransformation } from "@/entities/memo/server";
import { isTransformPresetId } from "../lib/preset-meta";
import { TRANSFORM_MODEL } from "../lib/transform-memo";

const MAX_CONTENT_LEN = 20_000;

export type SaveTransformationResult =
  | { kind: "ok" }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "failed" };

/** 미리보기에서 사용자가 편집했을 수 있는 content를 승인 저장 (같은 preset은 교체). */
export async function saveTransformationAction(
  memoId: string,
  preset: string,
  content: string,
): Promise<SaveTransformationResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!isTransformPresetId(preset)) return { kind: "invalid" };

  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CONTENT_LEN) return { kind: "invalid" };

  const memo = await getMemo(session.user.id, memoId);
  if (!memo) return { kind: "not-found" };

  return upsertTransformation({ memoId, preset, model: TRANSFORM_MODEL, content: trimmed }).then(
    () => {
      revalidatePath("/memos");
      return { kind: "ok" as const };
    },
    () => ({ kind: "failed" as const }),
  );
}
