// pickLatestModel — /v1/models id 목록에서 tier 별 최신 안정 모델을 고르는 순수 함수.
//
// 네트워크·캐시와 분리해 파싱 로직만 담는다 (resolve-latest-model.ts 가 fetch+cache 담당).
// 이번 사고(정규식이 2-segment dated `claude-opus-4-20250514` 의 날짜를 minor 로 오독)를
// 순수 함수로 격리해 회귀 테스트로 잠근다.
//
// spec: docs/superpowers/specs/2026-07-05-latest-model-auto-resolution-design.md

export type ModelTier = "opus" | "gpt" | "gemini-pro";

interface TierRule {
  // 캡처그룹 2개 (major, minor) 를 가진 정규식. 끝 앵커($)로 preview/mini/flash/codex 접미사 자동 배제.
  pattern: RegExp;
}

// tier 별 매칭 규칙. $ 앵커가 부적합 변종(-mini, -preview, -flash, -codex, dated 3-segment)을 걸러낸다.
const TIER_RULES: Record<ModelTier, TierRule> = {
  opus: { pattern: /^claude-opus-(\d+)-(\d+)$/ },
  gpt: { pattern: /^gpt-(\d+)\.(\d+)$/ },
  "gemini-pro": { pattern: /^gemini-(\d+)\.(\d+)-pro$/ },
};

// 끝 세그먼트가 정확히 8자리 숫자면 YYYYMMDD dated 변종으로 간주 (안정 버전 minor 는 이렇게 길지 않다).
// 단순 임계값(minor < N)보다 의미가 명확하고 미래 minor 증가에 안전.
function isDated(minor: string): boolean {
  return /^\d{8}$/.test(minor);
}

/**
 * 모델 id 목록에서 tier 의 최신 안정 모델을 선택한다.
 *
 * - tier 정규식으로 (major, minor) 파싱
 * - dated 변종(끝 8자리 날짜) 배제
 * - (major, minor) 숫자 비교로 최댓값 선택
 *
 * @returns 선택된 모델 id, 매칭 후보가 없으면 null
 */
export function pickLatestModel(ids: readonly string[], tier: ModelTier): string | null {
  const { pattern } = TIER_RULES[tier];
  const candidates: Array<{ id: string; major: number; minor: number }> = [];
  for (const id of ids) {
    const m = pattern.exec(id);
    if (!m) continue;
    if (isDated(m[2])) continue; // dated 변종 배제
    candidates.push({ id, major: Number(m[1]), minor: Number(m[2]) });
  }
  if (candidates.length === 0) return null;
  const best = candidates.reduce((prev, curr) => {
    if (curr.major !== prev.major) return curr.major > prev.major ? curr : prev;
    return curr.minor > prev.minor ? curr : prev;
  });
  return best.id;
}
