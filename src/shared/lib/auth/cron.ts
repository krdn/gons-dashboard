// Cron 컨테이너 → app 컨테이너 호출의 Bearer 검증.
//
// CRITICAL §3 #9: Bearer 누락/잘못 → 401.
// timing-safe 비교로 timing attack 회피.
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/shared/config/env";

/**
 * Authorization: Bearer <token> 헤더 검증.
 * @returns true if 유효, false otherwise (호출자가 401 응답).
 */
export function verifyCronBearer(request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = match[1];

  const expected = env.CRON_BEARER_TOKEN;
  if (provided.length !== expected.length) return false;

  // timing-safe 비교.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b);
}
