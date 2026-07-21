// 전역 쿨다운 판정 — 순수 함수. 시간 상태는 호출 측이 주입한다(테스트 가능).

export interface CooldownCheck {
  allowed: boolean;
  remainingSec: number;
}

/**
 * lastAt(마지막 허용 시각, ms) 로부터 windowMs 가 지났는지 판정한다.
 * lastAt 이 null 이면 최초 호출 — 항상 허용.
 */
export function checkCooldown(
  lastAt: number | null,
  now: number,
  windowMs: number,
): CooldownCheck {
  if (lastAt === null) return { allowed: true, remainingSec: 0 };
  const elapsed = now - lastAt;
  if (elapsed >= windowMs) return { allowed: true, remainingSec: 0 };
  return { allowed: false, remainingSec: Math.ceil((windowMs - elapsed) / 1000) };
}
