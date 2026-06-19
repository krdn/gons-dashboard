// LLM 토큰 사용량 → KRW 환산 (순수 함수).
//
// saju 도메인의 모든 LLM 비용 환산이 공유하는 단일 출처. tri narrative 빌더
// (analyzeStructured 경로) 와 saju-reading 의 callSajuLlm (analyzeText 경로) 이
// 모두 이 computeKrw 를 호출한다 — 단가표/환율을 한 곳에서만 관리.

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
