import "server-only";
import { analyzeText, normalizeUsage } from "@krdn/llm-gateway/gateway";
import { resolveClaudeModel } from "@/shared/lib/llm/resolve-claude-model";
import { gatewayDefaults } from "@/shared/lib/llm/anthropic";

const PRICING_USD_PER_M = {
  "claude-sonnet-4-6":         { input:  3,   output: 15 },
  "claude-haiku-4-5-20251001": { input:  0.8, output:  4 },
} as const;

// Opus 계열 단가 (모든 버전 동일)
const OPUS_PRICING = { input: 15, output: 75 } as const;

const USD_TO_KRW = 1380;

export interface LlmCallResult {
  body: string;
  inputTokens: number;
  outputTokens: number;
  krw: number;
  model: string;
}

export interface LlmCallInput {
  system: string;
  user: string;
  maxTokens: number;
}

/**
 * 모델 ID 별 pricing 조회.
 * 동적 모델(claude-opus-4-8 등)을 지원하기 위해 prefix 기반 폴백 사용.
 */
function pricingFor(model: string) {
  if (PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M]) {
    return PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M];
  }
  // 정확한 매칭 실패 시 prefix 기반 폴백
  if (model.startsWith("claude-opus-")) {
    return OPUS_PRICING;
  }
  // 최종 폴백 (기본 모델이 opus이므로)
  return OPUS_PRICING;
}

export async function callSajuLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const model = await resolveClaudeModel();
  const { text, usage } = await analyzeText(input.user, {
    ...gatewayDefaults,
    model,
    maxOutputTokens: input.maxTokens,
    systemPrompt: input.system,
  });

  if (!text) throw new Error("callSajuLlm: empty response body");

  const { inputTokens, outputTokens } = normalizeUsage(usage);
  const pricing = pricingFor(model);
  const usd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  const krw = Math.round(usd * USD_TO_KRW * 100) / 100;

  return { body: text, inputTokens, outputTokens, krw, model };
}
