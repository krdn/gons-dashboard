import { describe, expect, it, vi } from "vitest";
import { fetchAccessToken } from "./access-token";
import { OAuthExpiredError, TransientError, GoogleApiError } from "./errors";

const mediatorUrl = "https://gons.krdn.kr/api/mcp/credentials/google";
const bearer = "test-bearer-token-aaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("fetchAccessToken", () => {
  it("returns access token on 200", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "ya29.test",
          expiresAt: "2026-05-12T10:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await fetchAccessToken({
      mediatorUrl,
      bearer,
      fetcher,
    });
    expect(result.accessToken).toBe("ya29.test");
    expect(fetcher).toHaveBeenCalledWith(
      mediatorUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${bearer}`,
        }),
      }),
    );
  });

  it("throws OAuthExpiredError on 410", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("Gone", { status: 410 }),
    );
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      OAuthExpiredError,
    );
  });

  it("throws GoogleApiError on 401", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      GoogleApiError,
    );
  });

  it("throws TransientError on 503", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("Service unavailable", { status: 503 }),
    );
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      TransientError,
    );
  });

  it("throws TransientError on network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchAccessToken({ mediatorUrl, bearer, fetcher })).rejects.toBeInstanceOf(
      TransientError,
    );
  });
});
