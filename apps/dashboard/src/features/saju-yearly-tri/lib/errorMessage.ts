// yearly API 응답의 stable error code 를 한국어 친화 문구로 매핑.
//
// lifetime/lib/errorMessage.ts 와 동일한 정책 + yearly 전용 코드 INVALID_YEAR 추가.
// 의도적 코드 복제 (Phase 3 "의도적 복제" 원칙) — 두 슬라이스의 에러 코드 집합이
// 분기 가능성이 있고, shared/lib 로 추출 시 두 슬라이스의 의존성이 결합된다.

const EXACT_MAP: Record<string, string> = {
  Unauthorized: "로그인이 필요합니다.",
  PROFILE_NOT_FOUND: "프로필을 찾을 수 없습니다.",
  INVALID_SCHOOL: "잘못된 학파 요청입니다.",
  INVALID_YEAR: "잘못된 연도 요청입니다 (1900~2100 범위 외).",
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
  return `분석에 실패했습니다: ${code}`;
}
