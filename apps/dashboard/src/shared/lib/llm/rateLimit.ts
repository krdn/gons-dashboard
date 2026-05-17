// LLM 호출 rate limit — Redis INCR/EXPIRE 기반.
//
// 정책:
//  - key 형식: saju:lifetime:narrative:${userId}
//  - INCR + EXPIRE NX → 첫 호출이든 INCR 직후 크래시 후 재시작이든 항상 TTL 보장
//    (NX: 이미 TTL 있으면 skip → 윈도우 무한 확장 방지)
//  - limit: 5 / 분
//  - 반환: { allowed: boolean; retryAfterMs?: number }
//    retryAfterMs 는 TTL key 로 남은 초 추정 → ms 환산
//  - Redis 다운 시 fail-open (allowed: true) — LLM 비용 허용으로 가용성 우선
//
// 결정성: 분당 5회 카운터 — 60s 가 지나면 EXPIRE 만료로 키가 사라져 다음 호출이 다시 1로 시작.
import "server-only";
import { getRedisClient } from "@/shared/lib/redis/client";

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 5;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export async function checkRateLimit(
  userId: string,
  limitPerMinute: number = DEFAULT_LIMIT,
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const key = `saju:lifetime:narrative:${userId}`;

  try {
    // INCR 는 key 가 없으면 0→1 로 만들면서 1 반환.
    const count = await redis.incr(key);

    // EXPIRE ... NX: TTL 미설정 상태에서만 TTL 부여.
    // INCR 직후 프로세스가 크래시해도 다음 호출이 NX 로 TTL 을 복구한다 (영구 차단 방지).
    await redis.expire(key, WINDOW_SECONDS, "NX");

    if (count > limitPerMinute) {
      // TTL 은 초 단위. -1 (만료 없음) 또는 -2 (key 없음) 가 나오는 경우 안전하게 0 처리.
      const ttlSec = await redis.ttl(key);
      const retryAfterMs = ttlSec > 0 ? ttlSec * 1000 : 0;
      return { allowed: false, retryAfterMs };
    }

    return { allowed: true };
  } catch (err) {
    // Redis 장애 시 fail-open — 가용성 우선. 모니터링 필요.
    console.error("[saju/rateLimit] Redis error, failing open:", err);
    return { allowed: true };
  }
}
