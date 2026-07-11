"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { transformMemoContent } from "@/features/memo-transform/lib/transform-memo";
import {
  resolveDefaultMemoModel,
  type ResolvedPreset,
} from "@/features/memo-transform/lib/preset-resolver";
import { getMemoModelAvailability } from "@/features/memo-transform/lib/model-catalog";
import { PreviewPresetFieldsInput, SampleTextInput } from "./_schema";

export type PreviewPresetResult =
  | { kind: "ok"; content: string }
  | { kind: "invalid" }
  | { kind: "model-unavailable" }
  | { kind: "failed" };

/** 임시 프리셋으로 미리보기 변환 — DB 무접촉, revalidate 없음. */
export async function previewPresetAction(
  input: unknown,
): Promise<PreviewPresetResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  if (typeof input !== "object" || input === null) return { kind: "invalid" };
  const fields = PreviewPresetFieldsInput.safeParse(input);
  if (!fields.success) return { kind: "invalid" };
  const sampleText = SampleTextInput.safeParse(
    (input as { sampleText?: unknown }).sampleText,
  );
  if (!sampleText.success) return { kind: "invalid" };
  const selection =
    fields.data.model && fields.data.modelId
      ? { model: fields.data.model, modelId: fields.data.modelId }
      : await resolveDefaultMemoModel(session.user.id);
  // unknown(카탈로그 조회 실패)은 호출을 차단하지 않는다 — 실패 시 LLM이 판정.
  const availability = await getMemoModelAvailability(selection);
  if (availability === "unavailable") return { kind: "model-unavailable" };

  const preset: ResolvedPreset = {
    slug: "preview",
    label: "미리보기",
    instruction: fields.data.instruction,
    fidelityGuard: fields.data.fidelityGuard,
    ...selection,
    minInputLen: 1,
    strictPreserve: false,
    isBuiltin: false,
    isOverridden: false,
  };

  const outcome = await transformMemoContent(sampleText.data, preset);
  if (outcome.kind === "failed") {
    return outcome.reason === "model-unavailable"
      ? { kind: "model-unavailable" }
      : { kind: "failed" };
  }
  return { kind: "ok", content: outcome.content };
}
