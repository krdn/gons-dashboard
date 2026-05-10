// Vitest setup — Next.js의 server-only 가드를 우회 + .env 로딩.
// 테스트 환경에서는 server-only를 빈 모듈로 대체하고,
// DB 등 실제 인프라를 사용하는 테스트를 위해 .env를 로드한다.
//
// CRITICAL — prod DB 가드:
// 통합 테스트는 INSERT/DELETE를 직접 수행한다. 사용자 .env의 DATABASE_URL이
// prod 호스트(192.168.0.5:5440 등)를 향하면 테스트 실행이 prod DB를
// 오염시킨다 (이미 발생한 사고: users 테이블에 200+개의 test-*/act-*/cycle-*
// 레코드 누적). 가드는 두 단계:
//   1. TEST_DATABASE_URL이 명시되면 DATABASE_URL을 그것으로 override.
//   2. 그래도 prod-like 호스트면 throw로 즉시 차단.
import "dotenv/config";
import { vi } from "vitest";

const PROD_HOST_PATTERNS = [
  /\b192\.168\.0\.5(?::|\/|$)/, // home-server
  /\bgons\.krdn\.kr\b/i,
];

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const dbUrl = process.env.DATABASE_URL ?? "";
for (const pattern of PROD_HOST_PATTERNS) {
  if (pattern.test(dbUrl)) {
    throw new Error(
      `[tests/setup.ts] DATABASE_URL이 prod-like 호스트를 가리킵니다 ` +
        `(matched ${pattern}). 통합 테스트는 prod DB를 오염시킵니다.\n` +
        `→ TEST_DATABASE_URL을 별도 DB(로컬 컨테이너 또는 ` +
        `staging)로 설정하거나, .env.test 등 분리된 환경에서 실행하세요.`,
    );
  }
}

vi.mock("server-only", () => ({}));
