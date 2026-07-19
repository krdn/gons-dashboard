// apps/cron/waitForAppReady.test.js
import { describe, it, expect, vi } from "vitest";
import { waitForAppReady } from "./waitForAppReady.js";

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
