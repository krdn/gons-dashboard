/**
 * KST(Asia/Seoul) 기준 'YYYY-MM-DD' 반환.
 * 'en-CA' locale 은 ISO 8601 형식을 보장. timezone 옵션으로 KST 변환.
 *
 * 클라이언트·서버 일관성: 서버 Node 의 ICU 가 ko-KR 없는 환경이라도 en-CA 는
 * minimal ICU 에 포함됨. Gotcha #3 회피.
 */
export function computeKstDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function computeKstYear(now: Date = new Date()): number {
  const dateStr = computeKstDate(now);
  return Number.parseInt(dateStr.slice(0, 4), 10);
}
