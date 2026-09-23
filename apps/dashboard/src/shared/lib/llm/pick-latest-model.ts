// 프록시가 관리하는 별칭만 선택한다. 카탈로그의 숫자 크기는 호출 가능성의 증거가 아니다.
// 별칭이 없으면 null: resolveLatestModel이 환경설정의 고정 모델로 폴백한다.
// 기존 호출부 호환을 위해 함수 이름을 유지한다.
export type ModelTier = "opus" | "gpt" | "gemini-pro";

const TIER_ALIASES: Record<ModelTier, string> = {
  opus: "claude-opus-latest",
  gpt: "gpt-latest",
  "gemini-pro": "gemini-pro-latest",
};

export function pickLatestModel(
  ids: readonly string[],
  tier: ModelTier,
): string | null {
  const alias = TIER_ALIASES[tier];
  return ids.includes(alias) ? alias : null;
}
