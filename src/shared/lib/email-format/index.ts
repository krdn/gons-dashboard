// "3시간 전" 같은 상대 시간 포맷 — 한국어, KST 기준.
//
// Intl.RelativeTimeFormat 사용. 24시간 미만은 시간/분, 그 이상은 "어제", "N일 전".

const fmt = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });

export function formatRelativeKst(date: Date | null | undefined): string {
  if (!date) return "";
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffMin = Math.round(diffMs / (60 * 1000));
  const diffHour = Math.round(diffMs / (60 * 60 * 1000));
  const diffDay = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (Math.abs(diffMin) < 60) return fmt.format(diffMin, "minute");
  if (Math.abs(diffHour) < 24) return fmt.format(diffHour, "hour");
  if (Math.abs(diffDay) < 7) return fmt.format(diffDay, "day");

  // 주 단위 이상은 명확히 날짜로.
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * "정수민" → "정수" 같은 이니셜 추출.
 * 한국어는 처음 2자, 영어는 첫 단어들의 첫글자.
 */
export function senderInitials(
  name: string | null,
  email: string | null,
): string {
  const source = (name ?? email ?? "?").trim();
  if (!source) return "?";
  // 한글 시작이면 첫 2자.
  if (/^[가-힯]/.test(source)) {
    return source.slice(0, 2);
  }
  // 영어/혼합 — 단어 첫글자 최대 2개.
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * 발신자 도메인만 추출 — "krdn 사내", "github.com" 등 표시용.
 */
export function senderDomain(email: string | null): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1);
}
