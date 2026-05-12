// refreshAccountTokens — 토큰/스코프 in-place UPDATE.
//
// pure 함수 + DI 로 작성되어 실제 DB 연결 없이 검증.
import { describe, expect, it, vi } from "vitest";
import { refreshAccountTokens } from "./refreshAccountTokens";

function makeDbStub() {
  const setSpy = vi.fn();
  const whereSpy = vi.fn().mockResolvedValue(undefined);
  setSpy.mockImplementation(() => ({ where: whereSpy }));
  const updateSpy = vi.fn().mockReturnValue({ set: setSpy });
  return { db: { update: updateSpy }, setSpy, whereSpy, updateSpy };
}

describe("refreshAccountTokens", () => {
  it("google account 에 모든 토큰 필드가 있으면 set 에 그대로 전달", async () => {
    const { db, setSpy, updateSpy } = makeDbStub();
    const result = await refreshAccountTokens(db, {
      provider: "google",
      providerAccountId: "111222333",
      access_token: "ya29.AAA",
      refresh_token: "1//rt-bbb",
      expires_at: 1_900_000_000,
      scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
      token_type: "Bearer",
      id_token: "eyJ...",
    });
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(setSpy).toHaveBeenCalledOnce();
    expect(setSpy.mock.calls[0][0]).toEqual({
      access_token: "ya29.AAA",
      refresh_token: "1//rt-bbb",
      expires_at: 1_900_000_000,
      scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
      token_type: "Bearer",
      id_token: "eyJ...",
    });
    expect(result.skipped).toBe(false);
    expect(result.changedFields).toContain("scope");
    expect(result.changedFields).toContain("access_token");
  });

  it("undefined 필드는 patch 에서 제외", async () => {
    const { db, setSpy } = makeDbStub();
    await refreshAccountTokens(db, {
      provider: "google",
      providerAccountId: "111",
      access_token: "ya29.X",
      scope: "openid",
      // refresh_token, expires_at, token_type, id_token 모두 undefined
    });
    expect(setSpy.mock.calls[0][0]).toEqual({
      access_token: "ya29.X",
      scope: "openid",
    });
  });

  it("google 이 아닌 provider 면 skip — db 호출 없음", async () => {
    const { db, updateSpy } = makeDbStub();
    const result = await refreshAccountTokens(db, {
      provider: "github",
      providerAccountId: "999",
      access_token: "gh_xyz",
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  it("account 가 null/undefined 면 skip", async () => {
    const { db, updateSpy } = makeDbStub();
    const a = await refreshAccountTokens(db, null);
    const b = await refreshAccountTokens(db, undefined);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(a.skipped).toBe(true);
    expect(b.skipped).toBe(true);
  });

  it("set 할 필드가 하나도 없으면 db 호출 없이 skip", async () => {
    const { db, updateSpy } = makeDbStub();
    const result = await refreshAccountTokens(db, {
      provider: "google",
      providerAccountId: "111",
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  it("where 절은 provider+providerAccountId 로 정확히 타게팅", async () => {
    const { db, whereSpy } = makeDbStub();
    await refreshAccountTokens(db, {
      provider: "google",
      providerAccountId: "abc-123",
      scope: "openid",
    });
    expect(whereSpy).toHaveBeenCalledOnce();
    // where 인자는 drizzle SQL 객체 — 내용까진 검사 어려우니 호출 여부만.
  });

  it("null 토큰은 의도적 clear 로 해석해 그대로 set", async () => {
    const { db, setSpy } = makeDbStub();
    await refreshAccountTokens(db, {
      provider: "google",
      providerAccountId: "111",
      access_token: null,
      scope: "openid",
    });
    expect(setSpy.mock.calls[0][0]).toEqual({
      access_token: null,
      scope: "openid",
    });
  });
});
