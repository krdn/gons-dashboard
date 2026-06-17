import "server-only";
import type { ModelConfigAdapter } from "@krdn/llm-gateway/adapters";
import { env } from "@/shared/config/env";

// gons는 ANTHROPIC_BASE_URL(:8317 프록시) + ANTHROPIC_API_KEY로 모든 LLM을 라우팅한다.
// 모듈 이름과 무관하게 단일 provider/model로 16개 tickerlens 모듈 전부 처리 (per-persona 튜닝 YAGNI).
// provider는 반드시 "claude-cli" — gateway가 callMethod:"chat"으로 baseUrl에 /v1을 붙여
// :8317 프록시의 /v1/messages로 라우팅한다. "anthropic"이면 callMethod:"direct"라
// @ai-sdk/anthropic이 /messages(=/v1 누락)로 호출해 404가 난다. (shared/lib/llm/anthropic.ts gatewayDefaults와 동일)
// claude-cli는 supportsStructuredOutput:false → gateway가 text-fallback(analyzeStructuredViaText)으로
// 텍스트를 파싱해 structured 출력을 만든다. native structured output이 아니라는 점만 유의.
export function buildTickerlensModelConfig(): ModelConfigAdapter {
  return {
    // moduleName 무시 — 16개 모듈 전부 단일 provider/model로 처리 (위 주석 참조)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async resolve(_moduleName: string) {
      return {
        provider: "claude-cli" as const, // AIProvider 리터럴로 좁힘
        model: env.SAJU_LLM_MODEL_CLAUDE,
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: env.ANTHROPIC_BASE_URL,
      };
    },
  };
}
