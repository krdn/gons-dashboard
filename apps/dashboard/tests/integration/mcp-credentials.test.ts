// /api/mcp/credentials/google 라우트 통합 테스트.
//
// 검증:
//   - bearer 누락/오답 → 401
//   - 정상 bearer + DB stub user → 200, accessToken + expiresAt
//   - refresh 만료(InvalidGrantError) → 410
//   - 응답 헤더에 Cache-Control: no-store
//   - transient error → 503
//
// 외부 의존성 모두 stub:
//   - getValidAccessToken: vi.mock으로 Google 호출 차단
//   - db: vi.mock으로 DB 연결 없이 user 조회 stub
//
// env.MCP_DASHBOARD_TOKEN은 모듈 로드 시 Zod가 process.env를 파싱하므로,
// vi.hoisted()로 모든 imports 이전에 process.env를 설정한다.

// ─── 1. vi.hoisted: 모든 import 이전에 실행 ─────────────────────────────────
// env.ts는 모듈 로드 시 Zod로 process.env를 한 번에 파싱한다.
// beforeEach에서 process.env를 바꿔도 이미 frozen된 env 객체에는 영향 없음.
// → 필수 변수 전체를 hoisted로 미리 설정.
const TEST_BEARER = vi.hoisted(() => {
  const token = "test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // min 32자
  process.env.MCP_DASHBOARD_TOKEN = token;
  process.env.ADMIN_EMAILS ??= "krdn.net@gmail.com";
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5999/test_dummy";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.NEXTAUTH_SECRET ??= "test-secret-at-least-32-chars-padded!!";
  process.env.NEXTAUTH_URL ??= "http://localhost:3020";
  process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
  process.env.ANTHROPIC_BASE_URL ??= "http://localhost:8317";
  process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
  process.env.CRON_BEARER_TOKEN ??= "test-cron-bearer-token-padded-aaaaaaaaaa";
  process.env.ALLOWLIST_EMAILS ??= "krdn.net@gmail.com";
  return token;
});

// ─── 2. DB stub: 실제 PostgreSQL 연결 없이 user 조회를 제어 ──────────────────
// db.select().from().where().limit() 체인을 모킹.
// userRow를 테스트별로 바꿀 수 있도록 변수로 노출.
let userRow: { id: string }[] = [];
vi.mock("@/shared/lib/db/client", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(userRow),
  };
  return {
    db: {
      select: () => selectChain,
    },
  };
});

// ─── 3. getValidAccessToken stub ─────────────────────────────────────────────
vi.mock("@/shared/api/gmail/auth", () => ({
  getValidAccessToken: vi.fn(),
}));

import { describe, expect, it, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/mcp/credentials/google/route";
import { getValidAccessToken } from "@/shared/api/gmail/auth";
import { InvalidGrantError } from "@/shared/api/gmail/errors";

const mockedGet = vi.mocked(getValidAccessToken);

function makeReq(bearer: string | null): Request {
  const headers = new Headers();
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://gons.krdn.kr/api/mcp/credentials/google", {
    headers,
  });
}

describe("/api/mcp/credentials/google", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    // 기본값: user row 있음 (200/410/503 케이스용).
    userRow = [{ id: "test-user-id" }];
  });

  it("returns 401 when bearer missing", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer wrong", async () => {
    const res = await GET(makeReq("wrong-bearer"));
    expect(res.status).toBe(401);
  });

  it("returns 410 when refresh token expired", async () => {
    mockedGet.mockRejectedValue(new InvalidGrantError());
    const res = await GET(makeReq(TEST_BEARER));
    expect(res.status).toBe(410);
  });

  it("returns 200 + accessToken + Cache-Control: no-store", async () => {
    mockedGet.mockResolvedValue({
      accessToken: "ya29.test",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    const res = await GET(makeReq(TEST_BEARER));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.accessToken).toBe("ya29.test");
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns 503 on transient error from getValidAccessToken", async () => {
    mockedGet.mockRejectedValue(new Error("ECONNRESET"));
    const res = await GET(makeReq(TEST_BEARER));
    expect(res.status).toBe(503);
  });
});
