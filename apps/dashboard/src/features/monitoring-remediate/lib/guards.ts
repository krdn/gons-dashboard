// 자동 복구 안전장치 — 순수 함수 (이슈 #352).
//
// DB·docker·현재시각을 참조하지 않는다. now 를 인자로 받아 테스트가 시간을
// 통제할 수 있게 한다 (judgeDatastoreStats 와 같은 방침).

/**
 * 조치 전 최소 open 지속 시간 (분).
 *
 * 실측 근거 (2026-07-28, monitoring_events 278건): 240건(86%)이 평균 0.1h
 * 에 자해소한다. 발생 즉시 조치하면 이미 끝난 상황에 손대 새 장애를 만든다.
 * 사람 손이 필요했던 것은 critical 평균 16.1h, security warning 119h 였다.
 */
export const MIN_OPEN_MINUTES: Record<string, number> = {
  critical: 30,
  warning: 360,
};

/** 알 수 없는 severity 는 가장 보수적인 값을 적용한다. */
const FALLBACK_MIN_OPEN_MINUTES = 360;

/** 시도 횟수에 산입하는 outcome — skipped 는 조치를 하지 않았으므로 제외. */
const COUNTED_OUTCOMES = new Set(["executed", "failed"]);

export type AttemptSummary = { outcome: string; attemptedAt: Date };

export type GuardInput = {
  severity: string;
  occurredAt: Date;
  maxAttempts: number;
  cooldownMinutes: number;
  history: AttemptSummary[];
  now: Date;
};

export type GuardVerdict = { allowed: true } | { allowed: false; reason: string };

function minutesBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 60_000;
}

export function evaluateGuards(input: GuardInput): GuardVerdict {
  // in-flight 가 있으면 다른 사이클이 실행 중 — DB claim 이 최종 방어선이지만
  // 여기서 먼저 걸러 불필요한 INSERT 시도를 줄인다.
  if (input.history.some((h) => h.outcome === "in_flight")) {
    return { allowed: false, reason: "이미 실행 중인 시도가 있음" };
  }

  const openMinutes = minutesBetween(input.now, input.occurredAt);
  const required = MIN_OPEN_MINUTES[input.severity] ?? FALLBACK_MIN_OPEN_MINUTES;
  if (openMinutes < required) {
    return {
      allowed: false,
      reason: `지속 시간 부족 (${Math.round(openMinutes)}분 < ${required}분)`,
    };
  }

  const counted = input.history.filter((h) => COUNTED_OUTCOMES.has(h.outcome));
  if (counted.length >= input.maxAttempts) {
    return {
      allowed: false,
      reason: `시도 횟수 상한 도달 (${counted.length}/${input.maxAttempts})`,
    };
  }

  const lastAttempt = counted.reduce<Date | null>(
    (max, h) => (max == null || h.attemptedAt > max ? h.attemptedAt : max),
    null,
  );
  if (lastAttempt != null) {
    const sinceLast = minutesBetween(input.now, lastAttempt);
    if (sinceLast < input.cooldownMinutes) {
      return {
        allowed: false,
        reason: `쿨다운 중 (${Math.round(sinceLast)}분 < ${input.cooldownMinutes}분)`,
      };
    }
  }

  return { allowed: true };
}
