// Cron 컨테이너 → app 컨테이너 호출의 Bearer 검증.
//
// CRITICAL §3 #9: Bearer 누락/잘못 → 401.
// timing-safe 비교로 timing attack 회피.
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/shared/config/env";

/**
 * 두 문자열을 timing-safe 하게 비교. 길이가 다르면 즉시 false
 * (timingSafeEqual 은 길이 불일치 시 throw 하므로 사전 체크).
 * Bearer 토큰류 시크릿 비교에 재사용.
 */
function timingSafeCompare(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Request 의 Authorization: Bearer <token> 헤더에서 토큰을 뽑아
 * 기대값과 timing-safe 비교.
 * @returns true if 유효, false otherwise (호출자가 401 응답).
 */
export function verifyBearer(request: Request, expected: string): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return timingSafeCompare(match[1], expected);
}

/**
 * Cron 컨테이너 → app 호출의 Bearer 검증.
 * @returns true if 유효, false otherwise (호출자가 401 응답).
 */
export function verifyCronBearer(request: Request): boolean {
  return verifyBearer(request, env.CRON_BEARER_TOKEN);
}
