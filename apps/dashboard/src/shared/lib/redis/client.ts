// Redis singleton — process-level lazy connect.
//
// 정책:
//  - 최초 호출 시 1회만 connect, 이후 같은 인스턴스 재사용
//  - Next.js HMR 환경에서 다중 연결 방지 (globalThis stash 패턴 — db/client.ts 와 동일)
//  - REDIS_URL 은 shared/config/env 에서 Zod 검증된 값만 사용
//  - ioredis 기본 재연결/retry 옵션 사용 (별도 설정 없음)
import "server-only";
import Redis from "ioredis";
import { env } from "@/shared/config/env";

const globalForRedis = globalThis as unknown as {
  redisClient?: Redis;
};

export function getRedisClient(): Redis {
  if (!globalForRedis.redisClient) {
    globalForRedis.redisClient = new Redis(env.REDIS_URL, {
      // lazy connect — 첫 명령 직전에 connect.
      // (rate limit 같이 hot path 가 아닌 곳에서도 모듈 로드 시 connect 폭주 방지)
      lazyConnect: true,
      // Redis 다운 시 hang 방지: offlineQueue 비활성 + 1회 retry 후 즉시 throw.
      // → 호출 측이 명시적으로 catch 해 fail-open/closed 정책을 결정한다.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }
  return globalForRedis.redisClient;
}
