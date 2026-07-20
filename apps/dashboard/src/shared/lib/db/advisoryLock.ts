// PostgreSQL advisory lock — 여러 프로세스·요청에 걸친 상호배제 (이슈 #323).
//
// 왜 필요한가: cron 이 트리거하는 장기 작업은 HTTP 요청 timeout 이 끊어도
// 서버 측 실행이 계속된다. 다음 주기가 시작되면 두 실행이 같은 테이블에
// DELETE+INSERT 를 교차 수행해, 오래된 실행이 최신 스냅샷을 덮거나 지운다.
//
// 왜 세션 락인가: `pg_try_advisory_xact_lock` 은 트랜잭션 종료 시 자동
// 해제돼 풀링에 안전하지만, 여러 트랜잭션에 걸친 긴 작업을 감쌀 수 없다.
// 세션 락을 쓰되 `reserve()` 로 전용 연결을 확보해 잡은 연결에서 반드시
// 해제한다 — 풀에서 매번 다른 연결이 나오면 락이 영구히 남기 때문이다.
import "server-only";
import { sqlClient } from "./client";
import { logger } from "@/shared/lib/log";

/**
 * 락 키 — 32비트 정수 두 개. 도메인마다 고유해야 한다.
 * 첫 번째는 네임스페이스(관제=323, 이슈 번호), 두 번째가 작업 구분이다.
 */
export const LOCK_KEYS = {
  githubSync: [323, 1],
} as const;

/**
 * 락을 잡고 fn 을 실행한다. 이미 잡혀 있으면 **대기하지 않고** null 을 반환한다.
 *
 * @returns fn 의 반환값. 락 획득 실패 시 null.
 */
export async function withAdvisoryLock<T>(
  key: readonly [number, number],
  scope: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const conn = await sqlClient.reserve();
  try {
    const [row] = await conn<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${key[0]}, ${key[1]}) as locked
    `;
    if (row?.locked !== true) {
      logger.warn("advisory-lock", "already-held", { scope });
      return null;
    }
    try {
      return await fn();
    } finally {
      // 잡은 연결에서 해제해야 한다 — 다른 연결로는 풀리지 않는다.
      await conn`select pg_advisory_unlock(${key[0]}, ${key[1]})`;
    }
  } finally {
    // 연결을 풀로 반납. 이게 빠지면 풀이 고갈된다.
    conn.release();
  }
}
