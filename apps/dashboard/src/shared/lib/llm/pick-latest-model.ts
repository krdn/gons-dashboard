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
  // 프록시가 관리하는 alias. 목록에 실존하면 버전 파싱보다 우선한다.
  // (gemini 처럼 안정 버전 형식이 사라지고 -preview/-low 로만 존재하는 provider 대응 —
  //  프록시가 "현재 최신"으로 관리하는 alias 를 신뢰하고, 미래 세대 교체도 자동 추종.)
  alias?: string;
}

// tier 별 매칭 규칙. $ 앵커가 부적합 변종(-mini, -preview, -flash, -codex, dated 3-segment)을 걸러낸다.
const TIER_RULES: Record<ModelTier, TierRule> = {
  // opus 도 프록시 alias 를 1순위로 쓴다 (2026-09-23). 프록시 promote_aliases(2026-08-07~)가
  // 새 세대를 실호출·응답 model 필드로 검증한 뒤에만 alias 를 옮기므로 더 이상 정적 핀이 아니다.
  // 버전 파싱은 "카탈로그 노출 = 호출 가능"을 가정해 400 인 claude-opus-5-5 를 골랐고,
  // 1-segment claude-opus-5 는 패턴에 맞지 않아 몇 달간 4-8 에 머물렀다.
  opus: { pattern: /^claude-opus-(\d+)-(\d+)$/, alias: "claude-opus-latest" },
  // gpt 도 프록시 alias 우선 (2026-09-23). 프록시가 수동 관리하는 "운영자가 검증한 기본 모델"이다 —
  // 접미사 붙은 새 세대(gpt-5.6-sol, gpt-6-*)는 패턴이 못 읽고, luna/sol/terra/astra 는 순서가
  // 없는 용도별 이름이라 패턴을 넓혀 최댓값을 고르면 안 된다.
  gpt: { pattern: /^gpt-(\d+)\.(\d+)$/, alias: "gpt-latest" },
  // gemini 는 인증 변경(2026-07-06)으로 안정 gemini-N.N-pro 가 사라지고 3.1 이 -preview/-low
  // 로만 존재 → 프록시 관리 alias gemini-pro-latest 를 1순위로 쓴다. spec 2026-07-05 §gemini.
  "gemini-pro": { pattern: /^gemini-(\d+)\.(\d+)-pro$/, alias: "gemini-pro-latest" },
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
  const { pattern, alias } = TIER_RULES[tier];
  // alias 우선 — 프록시가 목록에 노출하는 경우에만(없으면 버전 파싱 폴백).
  if (alias && ids.includes(alias)) return alias;
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
