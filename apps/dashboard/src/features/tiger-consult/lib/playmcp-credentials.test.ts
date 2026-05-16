import { describe, expect, it, vi, beforeEach } from "vitest";
import { ensureAccessToken } from "./playmcp-credentials";
import { PlayMCPNotConfiguredError } from "./errors";

const mockSelectLimit = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ limit: mockSelectLimit }) }),
    insert: () => ({ values: () => ({ returning: mockInsert }) }),
    update: () => ({ set: () => ({ where: mockUpdate }) }),
  },
}));

vi.mock("@/shared/config/env", () => ({
  env: { PG_ENCRYPTION_KEY: "test-key-".repeat(4), PLAYMCP_CLIENT_ID: "test-client" },
}));

beforeEach(() => {
  mockSelectLimit.mockReset();
  mockUpdate.mockReset();
  mockInsert.mockReset();
});

describe("ensureAccessToken", () => {
  it("credentials 미존재 시 PlayMCPNotConfiguredError throw", async () => {
    mockSelectLimit.mockResolvedValue([]);
    await expect(ensureAccessToken()).rejects.toBeInstanceOf(PlayMCPNotConfiguredError);
  });

  it("access_expires_at 이 5분+ 남았으면 기존 token 반환 (refresh 호출 안 함)", async () => {
    const { encryptToken } = await import("@/shared/lib/db/pgcrypto");
    const encrypted = encryptToken("valid-access-token", "test-key-".repeat(4));
    mockSelectLimit.mockResolvedValue([{
      accessTokenEnc: encrypted,
      refreshTokenEnc: encrypted,
      accessExpiresAt: new Date(Date.now() + 10 * 60_000),
      refreshExpiresAt: new Date(Date.now() + 30 * 86400_000),
      clientId: "test-client",
    }]);
    const token = await ensureAccessToken();
    expect(token).toBe("valid-access-token");
  });
});
