// Vitest setup — Next.js의 server-only 가드를 우회 + .env 로딩.
// 테스트 환경에서는 server-only를 빈 모듈로 대체하고,
// DB 등 실제 인프라를 사용하는 테스트를 위해 .env를 로드한다.
//
// CRITICAL — prod DB 가드 (allow-list 방식):
// 통합 테스트는 INSERT/DELETE를 직접 수행한다. 사용자 .env의 DATABASE_URL이
// prod/staging 호스트를 향하면 테스트 실행이 prod DB를 오염시킨다
// (이미 발생한 사고: users 테이블에 200+개의 test-*/act-*/cycle-* 레코드 누적).
//
// 이전(blocklist) 한계: 새 prod 호스트가 추가될 때마다 패턴을 갱신해야 함.
// 잊으면 사고 재발. allow-list로 뒤집어 안전한 호스트만 명시한다.
//
// 안전 호스트: localhost, 127.0.0.1, ::1 (로컬 docker 컨테이너 포함 — :5999 등 어느 포트든).
// TEST_DATABASE_URL이 명시되면 그 URL로 DATABASE_URL을 override한 뒤 동일 가드 적용.
import "dotenv/config";
import { vi } from "vitest";

const SAFE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function extractHostname(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    // URL.hostname은 IPv6를 대괄호 없이 반환한다 ([::1] → "::1").
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const dbUrl = process.env.DATABASE_URL ?? "";
const hostname = extractHostname(dbUrl);

if (!hostname || !SAFE_HOSTNAMES.has(hostname)) {
  throw new Error(
    `[tests/setup.ts] DATABASE_URL의 호스트가 안전 목록에 없습니다 ` +
      `(hostname=${hostname ?? "(파싱 실패)"}). 통합 테스트는 prod/staging DB를 오염시킬 수 있습니다.\n` +
      `→ 안전 호스트: ${[...SAFE_HOSTNAMES].join(", ")}\n` +
      `→ 로컬 컨테이너 사용 예: ` +
      `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`,
  );
}

vi.mock("server-only", () => ({}));
