"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { getMemo } from "@/entities/memo/server";
import { resolvePreset } from "../lib/preset-resolver";
import { transformMemoContent } from "../lib/transform-memo";

// ⚠️ import한 타입 재-export 금지 ("use server" ReferenceError). 결과 타입은 파일 내 선언만.
export type TransformMemoResult =
  | { kind: "ok"; content: string; truncated: boolean }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "too-short" }
  | { kind: "failed"; reason: string };

/** 미리보기 생성 — DB 쓰기 없음. 승인 저장은 saveTransformationAction. */
export async function transformMemoAction(memoId: string, preset: string): Promise<TransformMemoResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const resolved = await resolvePreset(session.user.id, preset);
  if (!resolved) return { kind: "invalid" };

  const memo = await getMemo(session.user.id, memoId);
  if (!memo) return { kind: "not-found" };
  const inputLen = memo.cleanedContent.trim().length;
  if (inputLen < resolved.minInputLen) return { kind: "too-short" };

  const outcome = await transformMemoContent(memo.cleanedContent, resolved);
  if (outcome.kind !== "ok") return outcome;
  return { kind: "ok", content: outcome.content, truncated: inputLen > 4_000 };
}
