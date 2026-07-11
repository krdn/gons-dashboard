"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import {
  updatePersonaOverrides,
  type PersonaModelOverride,
} from "@/entities/stock-analysis/server";
import { sanitizeLlmModelId } from "@/shared/lib/llm/provider-model-catalog";

const ModelNameSchema = z.enum(["claude", "codex", "gemini"]);
const PersonaOrConsensusSchema = z.enum([
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
  "consensus",
]);

const UpdateSchema = z.object({
  persona: PersonaOrConsensusSchema,
  model: ModelNameSchema,
  modelId: z.string().min(1).max(100).optional(),
});

export interface UpdateOverridesResult {
  success: boolean;
  error?: string;
}

export async function setPersonaModel(input: {
  persona: string;
  model: "claude" | "codex" | "gemini";
  modelId?: string;
}): Promise<UpdateOverridesResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "잘못된 입력" };

  // 상세 모델 ID 는 클라이언트 입력 — 프록시 ID 문법 화이트리스트로 정규화.
  let override: PersonaModelOverride = { model: parsed.data.model };
  if (parsed.data.modelId !== undefined) {
    const modelId = sanitizeLlmModelId(parsed.data.modelId);
    if (!modelId) return { success: false, error: "잘못된 입력" };
    override = { model: parsed.data.model, modelId };
  }

  try {
    await updatePersonaOverrides(session.user.id, {
      [parsed.data.persona]: override,
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "DB 에러",
    };
  }
}

export async function resetPersonaModels(): Promise<UpdateOverridesResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  try {
    await db
      .delete(stockPersonaPreferences)
      .where(eq(stockPersonaPreferences.userId, session.user.id));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "DB 에러",
    };
  }
}
