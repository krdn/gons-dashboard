// Redis singleton — process-level lazy connect.
//
// 정책:
//  - 최초 호출 시 1회만 connect, 이후 같은 인스턴스 재사용
//  - Next.js HMR 환경에서 다중 연결 방지 (globalThis stash 패턴 — db/client.ts 와 동일)
//  - REDIS_URL 은 shared/config/env 에서 Zod 검증된 값만 사용
//  - ioredis 기본 재연결/retry 옵션 사용 (별도 설정 없음)
//  - URL 문자열을 ioredis 에 직접 넘기지 않고 WHATWG new URL() 로 파싱해 옵션
//    객체로 전달한다. ioredis 의 내부 parseURL 은 legacy node:url url.parse() 를
//    호출해 DEP0169 deprecation 경고를 낸다 (Node 20+). 우리가 먼저 파싱하면
//    그 경로 자체를 타지 않아 경고가 사라진다.
import "server-only";
import Redis, { type RedisOptions } from "ioredis";
import { env } from "@/shared/config/env";

const globalForRedis = globalThis as unknown as {
  redisClient?: Redis;
};

// REDIS_URL(redis:// | rediss://) 을 ioredis 접속 옵션으로 변환.
// 이 프로젝트의 URL 은 host/port 만 있지만, 인증·db·TLS 가 붙은 URL 로 바뀌어도
// 안전하도록 실제 존재하는 필드만 조건부로 매핑한다.
function redisConnectionOptions(rawUrl: string): RedisOptions {
  const url = new URL(rawUrl);
  const db = url.pathname.replace(/^\//, "");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    // 빈 문자열은 undefined 로 — ioredis 가 빈 AUTH 를 보내지 않도록.
    username: url.username || undefined,
    password: url.password || undefined,
    // 빈 pathname 은 Number("")===0 이 되므로 명시적으로 undefined 처리.
    db: db ? Number(db) : undefined,
    // rediss:// 는 TLS.
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

export function getRedisClient(): Redis {
  if (!globalForRedis.redisClient) {
    globalForRedis.redisClient = new Redis({
      ...redisConnectionOptions(env.REDIS_URL),
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
