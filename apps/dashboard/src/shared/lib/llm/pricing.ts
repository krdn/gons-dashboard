// LLM 토큰 사용량 → KRW 환산 (순수 함수).
//
// saju 도메인의 여러 narrative 빌더가 analyzeStructured 의 usage(inputTokens/
// outputTokens)를 logSajuSpend 의 krw 로 환산할 때 공유한다. saju-reading 의
// llm-client.ts 에 동일 단가표가 private 으로 존재하지만(callSajuLlm 경로 전용),
// 그 모듈은 analyzeText 래퍼라 결합도가 다르다 — 여기서는 순수 환산만 노출.

// USD per 1M tokens. tri narrative 는 사용자가 Claude/Codex/Gemini 중 선택하므로
// 세 백엔드 단가를 모두 명시 (saju-model-registry: claude/codex/gemini).
const PRICING_USD_PER_M = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gpt-5.3-codex": { input: 1.25, output: 10 },
} as const;

// Opus 계열 단가 (모든 버전 동일)
const OPUS_PRICING = { input: 15, output: 75 } as const;

const USD_TO_KRW = 1380;

/**
 * 모델 ID 별 pricing 조회.
 * 동적 버전 모델(claude-opus-4-8, gemini-2.5-pro-latest 등)을 위해 prefix 폴백.
 * 알 수 없는 모델은 가장 비싼 opus 단가로 폴백 — 예산을 보수적으로 일찍 끊는 안전 방향.
 */
function pricingFor(model: string): { input: number; output: number } {
  if (PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M]) {
    return PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M];
  }
  if (model.startsWith("claude-opus-")) {
    return OPUS_PRICING;
  }
  if (model.startsWith("gemini-")) {
    return PRICING_USD_PER_M["gemini-2.5-pro"];
  }
  if (model.startsWith("gpt-") || model.includes("codex")) {
    return PRICING_USD_PER_M["gpt-5.3-codex"];
  }
  return OPUS_PRICING;
}

/** 토큰 사용량을 KRW 로 환산 (소수 둘째 자리 반올림). */
export function computeKrw(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = pricingFor(model);
  const usd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return Math.round(usd * USD_TO_KRW * 100) / 100;
}
