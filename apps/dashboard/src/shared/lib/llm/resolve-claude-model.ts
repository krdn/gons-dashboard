// 런타임 Claude 모델 자동 선택 (resolveClaudeModel)
//
// 프록시(/v1/models) 에서 최신 안정 Opus 를 런타임에 고른다.
// 조회 실패 시 env.SAJU_LLM_MODEL_CLAUDE 로 폴백 (캐시하지 않음 → 다음 호출에서 재시도).
//
// spec: docs/superpowers/specs/2026-06-14-runtime-claude-model-resolution-design.md

import "server-only";
import { env } from "@/shared/config/env";
import { logger } from "@/shared/lib/log";

interface CacheEntry {
  model: string;
  expiresAt: number;
}

let cachedModel: CacheEntry | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간

/**
 * 프록시 /v1/models 응답 구조.
 */
interface ModelsResponse {
  data: Array<{
    id: string;
    created?: number;
  }>;
}

/**
 * 프록시에서 최신 **안정** Claude Opus 모델을 자동으로 선택한다.
 *
 * 동작:
 * 1. 메모리 캐시 TTL 내 히트 → 즉시 반환
 * 2. 미스/만료 → GET ${ANTHROPIC_BASE_URL}/v1/models (타임아웃 3초, cache: no-store)
 * 3. ^claude-opus-(\d+)-(\d+)$ 패턴 필터 (dated/preview/alias 제외)
 * 4. (major, minor) 버전 비교로 최대값 선택
 * 5. 성공: 캐시 저장 + 반환
 * 6. 실패(네트워크/타임아웃/0건): env.SAJU_LLM_MODEL_CLAUDE 폴백, 캐시하지 않음
 *
 * @returns 선택된 모델 ID (예: "claude-opus-4-8")
 */
export async function resolveClaudeModel(): Promise<string> {
  // 1. 캐시 확인
  if (cachedModel && Date.now() < cachedModel.expiresAt) {
    return cachedModel.model;
  }

  try {
    // 2. 프록시에서 모델 목록 조회
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/models`, {
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn("llm/resolve-claude-model", "fetch-failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return env.SAJU_LLM_MODEL_CLAUDE;
    }

    const body = (await response.json()) as ModelsResponse;
    const data = body.data || [];

    // 3. 정규식 필터: ^claude-opus-(\d+)-(\d+)$
    // dated (claude-opus-4-5-20251101), alias (claude-opus-latest), 기타 형식 제외
    const opusPattern = /^claude-opus-(\d+)-(\d+)$/;
    const matches = data
      .map((m) => {
        const match = m.id.match(opusPattern);
        if (!match) return null;
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        return { id: m.id, major, minor };
      })
      .filter((x) => x !== null);

    if (matches.length === 0) {
      logger.warn("llm/resolve-claude-model", "no-matching-models", {});
      return env.SAJU_LLM_MODEL_CLAUDE;
    }

    // 4. (major, minor) 최대값 선택
    const best = matches.reduce((prev, curr) => {
      if (curr.major !== prev.major) return curr.major > prev.major ? curr : prev;
      return curr.minor > prev.minor ? curr : prev;
    });

    // 5. 캐시 저장 + 반환
    cachedModel = {
      model: best.id,
      expiresAt: Date.now() + TTL_MS,
    };
    return best.id;
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : String(error);
    logger.warn("llm/resolve-claude-model", "fetch-exception", { message: msg });
    return env.SAJU_LLM_MODEL_CLAUDE;
  }
}
