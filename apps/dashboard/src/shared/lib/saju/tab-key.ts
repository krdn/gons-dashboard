// 사주 프로필 페이지 outer 탭 키.
//
// URL search param ?tab=<key> 로 직렬화/역직렬화. 모델 토글의 ?model= 와 같은 패턴 (page-agnostic,
// pure function — vitest 호환).
//
// 잘못된 값은 throw 하지 않고 DEFAULT_FORTUNE_TAB 으로 fallback — parseSajuModelKey 와 동일 정책.

export const FORTUNE_TAB_KEYS = [
  "lifetime",
  "yearly",
  "monthly",
  "chart",
  "reading",
] as const;

export type FortuneTabKey = (typeof FORTUNE_TAB_KEYS)[number];

export const DEFAULT_FORTUNE_TAB: FortuneTabKey = "lifetime";

export const FORTUNE_TAB_META: Record<FortuneTabKey, { label: string }> = {
  lifetime: { label: "평생운세" },
  yearly: { label: "세운" },
  monthly: { label: "월운" },
  chart: { label: "사주원국" },
  reading: { label: "대운·해설" },
};

/**
 * URL search param 값을 안전하게 FortuneTabKey 로 narrow.
 * undefined / 배열 / 알 수 없는 값은 모두 DEFAULT_FORTUNE_TAB 으로 fallback.
 */
export function parseFortuneTabKey(
  raw: string | string[] | undefined,
): FortuneTabKey {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== "string") return DEFAULT_FORTUNE_TAB;
  return (FORTUNE_TAB_KEYS as readonly string[]).includes(candidate)
    ? (candidate as FortuneTabKey)
    : DEFAULT_FORTUNE_TAB;
}
