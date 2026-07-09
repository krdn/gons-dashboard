// 프리셋 설정 액션 공통 Zod 스키마 — 순수 ("use server" 아님).
import { z } from "zod";

export const PresetFieldsInput = z.object({
  label: z.string().trim().min(1).max(20),
  instruction: z.string().trim().min(1).max(2000),
  fidelityGuard: z.boolean(),
});

export const SampleTextInput = z.string().trim().min(1).max(4000);

export const MAX_CUSTOM_PRESETS = 20;
