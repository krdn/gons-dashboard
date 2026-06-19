// Saju tri narrative/frame API 의 stable error code → 한국어 친화 문구 매핑.
//
// 4개 timeframe slice(lifetime/yearly/monthly/daily)가 공유하는 매핑 정책 + 공통 코드.
// slice 고유 코드(INVALID_DATE/YEAR/MONTH 등)는 caller 가 sliceMap 으로 주입한다 —
// 정책·공통 코드는 여기 1곳, slice divergence 는 slice lib 에 로컬 유지.
//
// 배경: 옛 4개 slice 의 lib/errorMessage.ts 는 함수·PREFIX_MAP·공통 EXACT 5키를 byte-identical
// 복제했고, "shared/lib 추출 시 의존성 결합" 이유로 의도적 복제를 유지했었다(Phase 3 노트).
// 후보 1(#182)이 createNarrativeCache 로 4개 timeframe feature 가 shared/lib/saju 모듈에
// 의존하는 선례를 정착시켜, 그 location 정당성이 확립됨 → 이 추출이 Phase 3 노트를 supersede.
// 실제로 divergence 가 일어난 건 slice 고유 EXACT 키뿐 — 함수·PREFIX·공통키는 안정적이었다.
//
// 매핑 정책:
// - exact 매칭(slice 고유 키 우선 → 공통 5키) 우선
// - prefix 매칭("INVALID_CALENDAR: ..." 처럼 콜론 뒤 값) 은 prefix 만 변환, 디버그 컨텍스트는 괄호 보존
// - 알 수 없는 코드는 generic 문구 + 원본 노출(디버그용)

// 4개 slice 가 공유하는 공통 EXACT 코드.
const COMMON_EXACT_MAP: Record<string, string> = {
  Unauthorized: "로그인이 필요합니다.",
  PROFILE_NOT_FOUND: "프로필을 찾을 수 없습니다.",
  INVALID_SCHOOL: "잘못된 학파 요청입니다.",
  RATE_LIMIT: "잠시 후 다시 시도해주세요 (분당 요청 한도 초과).",
  INTERNAL_ERROR: "분석 중 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
};

const PREFIX_MAP: Array<{ prefix: string; label: string }> = [
  { prefix: "INVALID_CALENDAR:", label: "프로필 달력 형식이 올바르지 않습니다" },
  { prefix: "INVALID_GENDER:", label: "프로필 성별 정보가 올바르지 않습니다" },
];

/**
 * error code 를 한국어 문구로 변환.
 * @param code  API 가 반환한 stable error code (null/undefined/"" 는 generic 안내).
 * @param sliceMap  slice 고유 EXACT 코드(예: { INVALID_DATE: "..." }). 공통 키보다 우선.
 */
export function toUserMessage(
  code: string | null | undefined,
  sliceMap: Record<string, string> = {},
): string {
  if (!code) return "알 수 없는 오류가 발생했습니다.";
  if (code in sliceMap) return sliceMap[code];
  if (code in COMMON_EXACT_MAP) return COMMON_EXACT_MAP[code];
  for (const { prefix, label } of PREFIX_MAP) {
    if (code.startsWith(prefix)) {
      const detail = code.slice(prefix.length).trim();
      return detail ? `${label} (${detail})` : `${label}.`;
    }
  }
  return `분석에 실패했습니다: ${code}`;
}
