import "server-only";
import { resolveLatestModel } from "@/shared/lib/llm/resolve-latest-model";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import type { ModelName, PersonaOrConsensus } from "@gons/stock-analysis";
import { DEFAULT_PERSONA_MODELS } from "@gons/stock-analysis";
import {
  normalizePersonaOverride,
  type PersonaModelOverride,
} from "../model/persona-model-override";

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

/**
 * 사용자별 페르소나 → 모델 매핑 해석.
 * 1. user override 로드 (없으면 빈 객체) — legacy string / 객체 형태 모두 normalize
 * 2. DEFAULT_PERSONA_MODELS 와 머지 (override 가 우선)
 * 3. 실제 proxy 모델 ID 결정
 *    - override 에 modelId 가 저장돼 있으면 그 ID 를 그대로 사용 (사용자 고정 선택).
 *    - 없으면 resolveLatestModel(tier) 로 런타임 최신 선택.
 *    - 정적 env 값은 조회 실패 시 폴백으로만 쓰인다(resolve-latest-model 내부).
 */
export async function resolvePersonaModels(
  userId: string,
): Promise<Record<PersonaOrConsensus, ResolvedModel>> {
  const rows = await db
    .select()
    .from(stockPersonaPreferences)
    .where(eq(stockPersonaPreferences.userId, userId))
    .limit(1);
  const rawOverrides = rows[0]?.overrides ?? {};

  const [claudeId, codexId, geminiId] = await Promise.all([
    resolveLatestModel("opus"),
    resolveLatestModel("gpt"),
    resolveLatestModel("gemini-pro"),
  ]);
  const modelIdByName: Record<ModelName, string> = {
    claude: claudeId,
    codex: codexId,
    gemini: geminiId,
  };

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
    const override = normalizePersonaOverride(rawOverrides[p]);
    const name = override?.model ?? DEFAULT_PERSONA_MODELS[p];
    resolved[p] = { name, id: override?.modelId ?? modelIdByName[name] };
  }
  return resolved;
}

/**
 * UI 의 PersonaModelPicker (Phase 4) 가 호출.
 * 새 쓰기는 항상 { model, modelId? } 객체 — 기존 legacy string value 는
 * merge 로 보존되고 읽기 시 normalize 된다.
 */
export async function updatePersonaOverrides(
  userId: string,
  partial: Partial<Record<PersonaOrConsensus, PersonaModelOverride>>,
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
