// narrative + lifetime API 응답의 stable error code 를 한국어 친화 문구로 매핑.
//
// 매핑 정책:
// - prefix 매칭 ("INVALID_CALENDAR: ..." 처럼 콜론 뒤 값이 붙는 케이스) 은 prefix 만 변환
//   하고 디버그 컨텍스트(콜론 뒤 값) 는 괄호로 보존
// - 알 수 없는 코드는 generic 문구 + 원본 노출 (디버그 용)

const EXACT_MAP: Record<string, string> = {
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

export function toUserMessage(code: string | null | undefined): string {
  if (!code) return "알 수 없는 오류가 발생했습니다.";
  if (code in EXACT_MAP) return EXACT_MAP[code];
  for (const { prefix, label } of PREFIX_MAP) {
    if (code.startsWith(prefix)) {
      const detail = code.slice(prefix.length).trim();
      return detail ? `${label} (${detail})` : `${label}.`;
    }
  }
  // LifetimeBuildError 의 기타 message (만세력 합의 실패 등) — 원본 노출
  return `분석에 실패했습니다: ${code}`;
}
