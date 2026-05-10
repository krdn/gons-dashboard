// 컨테이너 액션 권한 체크 — pure function (의도적으로 DB·env 의존 없음).
// ADMIN_EMAILS는 CSV 형식 문자열로 호출자가 주입한다 (env 직접 참조 X → 테스트 용이).
//
// 매칭 규칙:
//  - 양쪽 trim
//  - 양쪽 toLowerCase (Gmail은 대소문자 구분 안 함)
//  - 빈 토큰은 무시
export function isAdmin(
  email: string | null | undefined,
  allowlistCsv: string,
): boolean {
  if (!email) return false;
  const target = email.trim().toLowerCase();
  if (!target) return false;
  for (const raw of allowlistCsv.split(",")) {
    const candidate = raw.trim().toLowerCase();
    if (candidate && candidate === target) return true;
  }
  return false;
}
