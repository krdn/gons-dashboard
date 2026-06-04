import { describe, expect, it, vi, beforeEach } from "vitest";
import { createCronHandler } from "./createCronHandler";

// bearer 검사는 항상 통과시켜 per-target 경로를 노출.
vi.mock("@/shared/lib/auth/cron", () => ({
  verifyCronBearer: vi.fn().mockReturnValue(true),
}));

function fakeRequest(): Request {
  return new Request("http://localhost/api/cron/test", { method: "POST" });
}

const baseDef = {
  name: "test-cron",
  targetSelect: async () => [{ id: "t1" }],
  getId: (t: { id: string }) => t.id,
};

describe("createCronHandler retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retry off (기본) — perTarget throw 시 1회만 호출 + status error", async () => {
    const perTarget = vi.fn().mockRejectedValue(new Error("transient blip"));
    const handler = createCronHandler({ ...baseDef, perTarget });

    const res = await handler(fakeRequest());
    const body = await res.json();

    expect(perTarget).toHaveBeenCalledTimes(1);
    expect(body.results[0].status).toBe("error");
    expect(body.failed).toBe(1);
  });

  it("retry on — perTarget 1회 throw 후 성공 → 재시도해서 ok, 2회 호출", async () => {
    const perTarget = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient blip"))
      .mockResolvedValueOnce({ ok: true });
    const handler = createCronHandler({
      ...baseDef,
      perTarget,
      retry: { maxAttempts: 2, backoffMs: 0 },
    });

    const res = await handler(fakeRequest());
    const body = await res.json();

    expect(perTarget).toHaveBeenCalledTimes(2);
    expect(body.results[0].status).toBe("ok");
    expect(body.succeeded).toBe(1);
  });

  it("retry on — maxAttempts 소진까지 모두 throw → status error, maxAttempts 회 호출", async () => {
    const perTarget = vi.fn().mockRejectedValue(new Error("persistent fail"));
    const handler = createCronHandler({
      ...baseDef,
      perTarget,
      retry: { maxAttempts: 2, backoffMs: 0 },
    });

    const res = await handler(fakeRequest());
    const body = await res.json();

    expect(perTarget).toHaveBeenCalledTimes(2);
    expect(body.results[0].status).toBe("error");
  });

  it("retry on + shouldRetry=false 에러 → 재시도 안 함, 1회 호출", async () => {
    class NonRetryable extends Error {}
    const perTarget = vi.fn().mockRejectedValue(new NonRetryable("budget exceeded"));
    const handler = createCronHandler({
      ...baseDef,
      perTarget,
      retry: {
        maxAttempts: 3,
        backoffMs: 0,
        shouldRetry: (err: unknown) => !(err instanceof NonRetryable),
      },
    });

    const res = await handler(fakeRequest());
    const body = await res.json();

    expect(perTarget).toHaveBeenCalledTimes(1);
    expect(body.results[0].status).toBe("error");
  });

  it("backoff — 재시도 사이에만 대기 (sleep 횟수 = maxAttempts-1, 마지막 시도 후 대기 없음)", async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      // maxAttempts=3 전부 throw → sleep 은 시도 1·2 뒤 2회 (시도 3 뒤엔 없음).
      const perTarget = vi.fn().mockRejectedValue(new Error("persistent"));
      const handler = createCronHandler({
        ...baseDef,
        perTarget,
        retry: { maxAttempts: 3, backoffMs: 2000 },
      });

      const promise = handler(fakeRequest());
      await vi.runAllTimersAsync();
      const res = await promise;
      const body = await res.json();

      expect(perTarget).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
      expect(body.results[0].status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});
