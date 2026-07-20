// Drizzle 클라이언트 — 단일 인스턴스 (Next.js HMR 환경에서 다중 연결 방지).
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/shared/config/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const pgClient =
  globalForDb.pgClient ??
  postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // KST AT TIME ZONE 변환을 위해 서버 timezone 명시
    types: {},
  });

if (env.NODE_ENV !== "production") {
  globalForDb.pgClient = pgClient;
}

export const db = drizzle(pgClient, { schema });
export type DbClient = typeof db;

/**
 * raw postgres.js 클라이언트 — advisory lock 처럼 **전용 연결**이 필요한
 * 작업에만 쓴다(`sql.reserve()`). 일반 쿼리는 `db`(drizzle)를 쓸 것.
 *
 * 왜 필요한가: `pg_advisory_lock` 은 세션 단위라 락을 잡은 연결과 푸는 연결이
 * 같아야 한다. 풀에서 매번 다른 연결이 나오면 락이 영구히 남는다.
 */
export const sqlClient = pgClient;
