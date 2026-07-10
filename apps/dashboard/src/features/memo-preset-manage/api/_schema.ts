// 프리셋 설정 액션 공통 Zod 스키마 — 순수 ("use server" 아님).
import { z } from "zod";
import { isMemoModelIdForProvider } from "@/entities/memo/client";

export const MemoModelInput = z.enum(["claude", "codex", "gemini"]);
const MemoModelIdInput = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:/-]+$/);

export const MemoModelSelectionInput = z
  .object({
    model: MemoModelInput,
    modelId: MemoModelIdInput,
  })
  .refine((value) => isMemoModelIdForProvider(value.model, value.modelId), {
    path: ["modelId"],
    message: "선택한 공급사와 모델 ID가 일치하지 않습니다.",
  });

const PresetFieldsBase = z.object({
  label: z.string().trim().min(1).max(20),
  instruction: z.string().trim().min(1).max(2000),
  fidelityGuard: z.boolean(),
  // 둘 다 null = 사용자 전체 기본 모델 상속.
  model: MemoModelInput.nullable().default(null),
  modelId: MemoModelIdInput.nullable().default(null),
});

function validatePresetModel(
  value: {
    model: z.infer<typeof MemoModelInput> | null;
    modelId: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if ((value.model === null) !== (value.modelId === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modelId"],
      message: "공급사와 상세 모델은 함께 선택해야 합니다.",
    });
    return;
  }
  if (
    value.model !== null &&
    value.modelId !== null &&
    !isMemoModelIdForProvider(value.model, value.modelId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modelId"],
      message: "선택한 공급사와 모델 ID가 일치하지 않습니다.",
    });
  }
}

export const PresetFieldsInput =
  PresetFieldsBase.superRefine(validatePresetModel);

export const PreviewPresetFieldsInput = PresetFieldsBase.pick({
  instruction: true,
  fidelityGuard: true,
  model: true,
  modelId: true,
}).superRefine(validatePresetModel);

export const SampleTextInput = z.string().trim().min(1).max(4000);

export const MAX_CUSTOM_PRESETS = 20;
