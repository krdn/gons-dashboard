"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { getMemo } from "@/entities/memo/server";
import { TRANSFORM_PRESETS, isTransformPresetId } from "../lib/preset-meta";
import { transformMemoContent } from "../lib/transform-memo";

// ⚠️ import한 타입 재-export 금지 ("use server" ReferenceError). 결과 타입은 파일 내 선언만.
export type TransformMemoResult =
  | { kind: "ok"; content: string }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "too-short" }
  | { kind: "failed"; reason: string };

/** 미리보기 생성 — DB 쓰기 없음. 승인 저장은 saveTransformationAction. */
export async function transformMemoAction(memoId: string, preset: string): Promise<TransformMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!isTransformPresetId(preset)) return { kind: "invalid" };

  const memo = await getMemo(session.user.id, memoId);
  if (!memo) return { kind: "not-found" };
  if (memo.cleanedContent.trim().length < TRANSFORM_PRESETS[preset].minInputLen) {
    return { kind: "too-short" };
  }
  return transformMemoContent(memo.cleanedContent, preset);
}
