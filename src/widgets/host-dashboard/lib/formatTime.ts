// 로케일에 의존하면 서버(Node ICU minimal)와 브라우저 간 표기가 달라져
// hydration mismatch 가 발생한다 ("오후 04:33:48" vs "PM 04:33:48").
// HH:MM:SS 24시간 포맷은 locale-free 라 SSR/CSR 양쪽에서 동일 문자열을 만든다.
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
