import "server-only";
import { env } from "@/shared/config/env";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import type { ModelName, PersonaOrConsensus } from "@gons/stock-analysis";
import { DEFAULT_PERSONA_MODELS } from "@gons/stock-analysis";

export interface PersonaModelMapping {
  wallStreet: ModelName;
  krExpert: ModelName;
  value: ModelName;
  growth: ModelName;
  technical: ModelName;
  consensus: ModelName;
}

export interface ResolvedModel {
  name: ModelName;
  id: string;
}

const MODEL_ID_BY_NAME: Record<ModelName, string> = {
  claude: env.SAJU_LLM_MODEL_CLAUDE,
  codex: env.SAJU_LLM_MODEL_CODEX,
  gemini: env.SAJU_LLM_MODEL_GEMINI,
};

/**
 * 사용자별 페르소나 → 모델 매핑 해석.
 * 1. user override 로드 (없으면 빈 객체)
 * 2. DEFAULT_PERSONA_MODELS 와 머지 (override 가 우선)
 * 3. 각 ModelName 을 실제 proxy 모델 ID 로 매핑
 */
export async function resolvePersonaModels(
  userId: string,
): Promise<Record<PersonaOrConsensus, ResolvedModel>> {
  const rows = await db
    .select()
    .from(stockPersonaPreferences)
    .where(eq(stockPersonaPreferences.userId, userId))
    .limit(1);
  const overrides = (rows[0]?.overrides ?? {}) as Partial<PersonaModelMapping>;

  const resolved = {} as Record<PersonaOrConsensus, ResolvedModel>;
  const personas: PersonaOrConsensus[] = [
    "wallStreet",
    "krExpert",
    "value",
    "growth",
    "technical",
    "consensus",
  ];
  for (const p of personas) {
    const name = overrides[p] ?? DEFAULT_PERSONA_MODELS[p];
    resolved[p] = { name, id: MODEL_ID_BY_NAME[name] };
  }
  return resolved;
}

/**
 * UI 의 PersonaModelPicker (Phase 4) 가 호출.
 */
export async function updatePersonaOverrides(
  userId: string,
  partial: Partial<PersonaModelMapping>,
): Promise<void> {
  const existing = await db
    .select()
    .from(stockPersonaPreferences)
    .where(eq(stockPersonaPreferences.userId, userId))
    .limit(1);
  const merged = { ...(existing[0]?.overrides ?? {}), ...partial };
  await db
    .insert(stockPersonaPreferences)
    .values({ userId, overrides: merged })
    .onConflictDoUpdate({
      target: stockPersonaPreferences.userId,
      set: { overrides: merged, updatedAt: new Date() },
    });
}
