// KST(UTC+9) 기준 일·월 경계 → UTC Date 범위.
//
// llm_spend_log.created_at 은 timezone 없는 timestamp 라 경계 계산이
// 애플리케이션 몫이다. Asia/Seoul 은 DST 가 없어 고정 +9h 산술로 충분하다.
//
// ⚠️ features/saju-reading/lib/budget.ts 의 todayKstRange 와 **같은 값**을 내야
// 한다 — 예산 가드와 비용 위젯이 다른 하루를 보면 "위젯엔 여유, 실제론 초과"
// 같은 모순이 생긴다. 동치성은 tests/unit/kst-range.test.ts 가 고정한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface DateRange {
  start: Date;
  end: Date;
}

/** KST 자정~자정 (now 가 속한 하루). */
export function kstDayRange(now: Date): DateRange {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const kstMidnight = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
  );
  const start = new Date(kstMidnight - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** KST 월초~다음 월초 (now 가 속한 달). */
export function kstMonthRange(now: Date): DateRange {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  // Date.UTC 는 월 오버플로(m+1===12)를 다음 해로 정규화한다.
  const start = new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m + 1, 1) - KST_OFFSET_MS);
  return { start, end };
}
