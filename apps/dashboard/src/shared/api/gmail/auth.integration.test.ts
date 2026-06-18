import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { accounts, users } from "@/shared/lib/db/schema";
import { getValidAccessToken } from "./auth";
import { InvalidGrantError } from "./errors";

// Google token endpoint(fetch)만 mock — refresh 응답을 제어해 invalid_grant 분기 트리거.
// DB 쓰기(oauth_state='reauth_required', accounts 토큰 갱신)는 실 DB 로 검증.
// (보고서 지적: 기존엔 이 DB 경로가 테스트 안 됨 — mock 이 실제 쓰기를 안 탐.)
const skipIfNoDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const fetchMock = vi.fn();

skipIfNoDb("getValidAccessToken — invalid_grant DB 전이", () => {
  let userId: string;

  beforeEach(async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await db.delete(accounts);
    await db.delete(users);
    const [u] = await db
      .insert(users)
      .values({ email: "gmail-auth@test.com" })
      .returning();
    userId = u.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function addGoogleAccount(opts: {
    refresh: string | null;
    expiresAt: number;
  }) {
    await db.insert(accounts).values({
      userId,
      type: "oauth",
      provider: "google",
      providerAccountId: "google-acct-1",
      refresh_token: opts.refresh,
      access_token: "old-access",
      expires_at: opts.expiresAt,
    });
  }

  it("만료된 토큰 + invalid_grant 응답 → InvalidGrantError + oauth_state=reauth_required", async () => {
    await addGoogleAccount({ refresh: "stale-refresh", expiresAt: 0 }); // 만료 → 갱신 시도
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
        status: 400,
      }),
    );

    await expect(getValidAccessToken(userId)).rejects.toBeInstanceOf(InvalidGrantError);

    // DB 상태 전이 검증 (이게 보고서가 요구한 실 DB 경로)
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.oauthState).toBe("reauth_required");
    expect(u.tokenExpiredAt).not.toBeNull();
  });

  it("유효한 access token 이면 fetch 안 하고 그대로 반환 (oauth_state 불변)", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    await addGoogleAccount({ refresh: "ok-refresh", expiresAt: future });

    const result = await getValidAccessToken(userId);
    expect(result.accessToken).toBe("old-access");
    expect(fetchMock).not.toHaveBeenCalled();

    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.oauthState).toBe("active");
  });

  it("refresh_token 없으면 InvalidGrantError (fetch 시도 안 함)", async () => {
    await addGoogleAccount({ refresh: null, expiresAt: 0 });
    await expect(getValidAccessToken(userId)).rejects.toBeInstanceOf(InvalidGrantError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("갱신 성공 → 새 access_token DB 저장, oauth_state 불변", async () => {
    await addGoogleAccount({ refresh: "ok-refresh", expiresAt: 0 }); // 만료 → 갱신
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), {
        status: 200,
      }),
    );

    const result = await getValidAccessToken(userId);
    expect(result.accessToken).toBe("fresh-access");

    const [acct] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId));
    expect(acct.access_token).toBe("fresh-access");

    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.oauthState).toBe("active");
  });
});
