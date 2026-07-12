// 오래된 메모 재부상 선정 — 시간 가중 무작위 (오래될수록 뽑힐 확률 ↑).
// 유사도 기반은 임베딩 선결 과제가 있어 비범위 (스펙 §5).
const DAY_MS = 24 * 60 * 60 * 1000;

export const RESURFACE_MIN_AGE_DAYS = 30;
export const RESURFACE_COUNT = 2;

export interface ResurfaceCandidate {
  id: string;
  createdAt: Date;
}

/**
 * 30일 이상 된 후보에서 최대 2개를 나이 비례 가중치로 비복원 추출.
 * rng 주입(0 ≤ rng() < 1)으로 테스트 결정성 확보.
 */
export function pickResurfaced<T extends ResurfaceCandidate>(
  candidates: readonly T[],
  now: Date,
  rng: () => number = Math.random,
): T[] {
  const cutoff = now.getTime() - RESURFACE_MIN_AGE_DAYS * DAY_MS;
  const remaining = candidates.filter((c) => c.createdAt.getTime() <= cutoff);

  const picked: T[] = [];
  while (picked.length < RESURFACE_COUNT && remaining.length > 0) {
    const weights = remaining.map((c) =>
      Math.max(1, (now.getTime() - c.createdAt.getTime()) / DAY_MS),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let index = remaining.length - 1; // 부동소수 잔차 방어 — 기본 마지막 요소
    for (let i = 0; i < weights.length; i += 1) {
      r -= weights[i];
      if (r < 0) {
        index = i;
        break;
      }
    }
    picked.push(remaining.splice(index, 1)[0]);
  }
  return picked;
}
