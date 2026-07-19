// apps/cron/waitForAppReady.test.js
import { describe, it, expect, vi } from "vitest";
import { waitForAppReady, retryUntilOk } from "./waitForAppReady.js";

const noop = () => {};
const HEALTH_URL = "http://app:3020/api/health";

describe("waitForAppReady", () => {
  it("첫 폴링에 200 이면 즉시 true — sleep 없음", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const ready = await waitForAppReady(HEALTH_URL, { fetchFn, sleepFn, log: noop });

    expect(ready).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("초기 실패 후 ready 되면 재폴링해 true", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED")) // 부팅 중
      .mockResolvedValueOnce({ ok: false, status: 503 }) // 마이그레이션 중
      .mockResolvedValueOnce({ ok: true, status: 200 }); // ready
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const ready = await waitForAppReady(HEALTH_URL, {
      fetchFn,
      sleepFn,
      log: noop,
      intervalMs: 10,
      timeoutMs: 10_000,
    });

    expect(ready).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it("예산 소진까지 계속 실패면 false (best-effort 진행)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const ready = await waitForAppReady(HEALTH_URL, {
      fetchFn,
      sleepFn,
      log: noop,
      intervalMs: 10,
      timeoutMs: 25, // 첫 시도 후 10+10 지나면 deadline 근접 → 종료
    });

    expect(ready).toBe(false);
    // 마지막 시도 후에는 sleep 하지 않고 즉시 false — 무한 대기 방지.
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("timeout 0 이면 1회만 시도하고 실패 시 false", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const ready = await waitForAppReady(HEALTH_URL, {
      fetchFn,
      sleepFn,
      log: noop,
      timeoutMs: 0,
    });

    expect(ready).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });
});

describe("retryUntilOk", () => {
  it("첫 시도 성공이면 재시도·sleep 없음", async () => {
    const callFn = vi.fn().mockResolvedValue(true);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const ok = await retryUntilOk(callFn, "job", { sleepFn, log: noop });

    expect(ok).toBe(true);
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("실패 후 성공하면 backoff 대기 뒤 true — ready-guard 예산 초과 회수 경로", async () => {
    const callFn = vi
      .fn()
      .mockResolvedValueOnce(false) // app 아직 미준비(예산 초과 후 첫 시도)
      .mockResolvedValueOnce(true); // backoff 뒤 ready
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const ok = await retryUntilOk(callFn, "daily-fortunes", {
      sleepFn,
      log: noop,
      backoffMs: 100,
    });

    expect(ok).toBe(true);
    expect(callFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(100);
  });

  it("maxAttempts 모두 실패면 false — 시도 사이에만 sleep(마지막 후 없음)", async () => {
    const callFn = vi.fn().mockResolvedValue(false);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const ok = await retryUntilOk(callFn, "job", {
      sleepFn,
      log: noop,
      maxAttempts: 3,
    });

    expect(ok).toBe(false);
    expect(callFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2); // 시도 사이 2번, 마지막 후 0번
  });
});
