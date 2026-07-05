// resolveLatestModel — 프록시(/v1/models)에서 tier 별 최신 안정 모델을 런타임 선택.
//
// 기존 resolveClaudeModel(claude opus 전용, 2-segment dated 오독 버그)을 대체.
// 파싱은 pickLatestModel(순수 함수)에 위임하고, 여기서는 fetch + tier 별 6h 캐시 + env 폴백만 담당.
//
// alias(-latest)는 한 세대 뒤처져("항상 최신" 위반) 목록 직접 파싱으로 결정.
// spec: docs/superpowers/specs/2026-07-05-latest-model-auto-resolution-design.md

import "server-only";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";
import { pickLatestModel, type ModelTier } from "./pick-latest-model";

interface CacheEntry {
  model: string;
  expiresAt: number;
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6시간
// tier 별 독립 캐시 — opus/gpt/gemini-pro 가 서로 다른 갱신 주기를 가질 수 있다.
const cache = new Map<ModelTier, CacheEntry>();

// 조회 실패 시 tier 별 폴백값 — 현재 프록시에 실존하는 안정 모델 (spec 배포 주의 참조).
const TIER_FALLBACK: Record<ModelTier, string> = {
  opus: env.SAJU_LLM_MODEL_CLAUDE,
  gpt: env.SAJU_LLM_MODEL_CODEX,
  "gemini-pro": env.SAJU_LLM_MODEL_GEMINI,
};

interface ModelsResponse {
  data: Array<{ id: string }>;
}

/**
 * 프록시 /v1/models 에서 tier 의 최신 안정 모델 id 를 선택한다.
 *
 * 1. tier 캐시 TTL 히트 → 즉시 반환
 * 2. 미스 → GET ${ANTHROPIC_BASE_URL}/v1/models (타임아웃 3초, no-store)
 * 3. pickLatestModel(ids, tier) 로 최신 안정 선택
 * 4. 성공 → 캐시 저장 + 반환
 * 5. 실패(네트워크/타임아웃/후보 0건) → env 폴백, 캐시하지 않음(다음 호출 재시도)
 */
export async function resolveLatestModel(tier: ModelTier): Promise<string> {
  const cached = cache.get(tier);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.model;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/models`, {
      headers: { "x-api-key": env.ANTHROPIC_API_KEY },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn("llm/resolve-latest-model", "fetch-failed", {
        tier,
        status: response.status,
        statusText: response.statusText,
      });
      return TIER_FALLBACK[tier];
    }

    const body = (await response.json()) as ModelsResponse;
    const ids = (body.data || []).map((m) => m.id);
    const picked = pickLatestModel(ids, tier);
    if (picked == null) {
      logger.warn("llm/resolve-latest-model", "no-matching-models", { tier });
      return TIER_FALLBACK[tier];
    }

    cache.set(tier, { model: picked, expiresAt: Date.now() + TTL_MS });
    return picked;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("llm/resolve-latest-model", "fetch-exception", { tier, message });
    return TIER_FALLBACK[tier];
  }
}
