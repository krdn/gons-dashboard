// LLM 토큰 사용량 → KRW 환산 (순수 함수).
//
// saju 도메인의 여러 narrative 빌더가 analyzeStructured 의 usage(inputTokens/
// outputTokens)를 logSajuSpend 의 krw 로 환산할 때 공유한다. saju-reading 의
// llm-client.ts 에 동일 단가표가 private 으로 존재하지만(callSajuLlm 경로 전용),
// 그 모듈은 analyzeText 래퍼라 결합도가 다르다 — 여기서는 순수 환산만 노출.

const PRICING_USD_PER_M = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
} as const;

// Opus 계열 단가 (모든 버전 동일)
const OPUS_PRICING = { input: 15, output: 75 } as const;

const USD_TO_KRW = 1380;

/**
 * 모델 ID 별 pricing 조회.
 * 동적 모델(claude-opus-4-8 등)을 지원하기 위해 prefix 기반 폴백 사용.
 * 기본 모델이 opus 이므로 최종 폴백도 opus 단가.
 */
function pricingFor(model: string): { input: number; output: number } {
  if (PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M]) {
    return PRICING_USD_PER_M[model as keyof typeof PRICING_USD_PER_M];
  }
  if (model.startsWith("claude-opus-")) {
    return OPUS_PRICING;
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
