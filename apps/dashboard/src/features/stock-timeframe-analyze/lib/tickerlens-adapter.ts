import "server-only";
import type { ModelConfigAdapter } from "@krdn/llm-gateway/adapters";
import { env } from "@/shared/config/env";

// gons는 ANTHROPIC_BASE_URL(:8317 프록시) + ANTHROPIC_API_KEY로 모든 LLM을 라우팅한다.
// 모듈 이름과 무관하게 단일 provider/model로 16개 tickerlens 모듈 전부 처리 (per-persona 튜닝 YAGNI).
export function buildTickerlensModelConfig(): ModelConfigAdapter {
  return {
    async resolve(_moduleName: string) {
      return {
        provider: "anthropic" as const, // AIProvider 리터럴로 좁힘
        model: env.SAJU_LLM_MODEL_CLAUDE,
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: env.ANTHROPIC_BASE_URL,
      };
    },
  };
}
