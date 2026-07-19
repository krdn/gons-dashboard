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

  it("안전 상한 소진까지 계속 실패면 false (주입 시계로 시간 경과 결정적 재현)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    // 주입 시계: 매 호출마다 5초 전진. sleepFn 이 mock 이라 실시간은 안 흐르므로
    // nowFn 없이는 벽시계 기반 deadline 이 절대 소진되지 않는다(이 함수의 계약).
    let clock = 0;
    const nowFn = () => {
      clock += 5_000;
      return clock;
    };

    const ready = await waitForAppReady(HEALTH_URL, {
      fetchFn,
      sleepFn,
      nowFn,
      log: noop,
      intervalMs: 5_000,
      timeoutMs: 60_000, // 주입 시계로 60초 지나면 소진 → false
    });

    expect(ready).toBe(false);
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("옛 120초 예산을 훨씬 넘겨(≈200초) 실패하다 ready 되면 결국 true — 느린 부팅 창 차단", async () => {
    // #133 핵심 계약: app 부팅이 오래 걸려도(마이그레이션 지연 등) catchup 은
    // 결국 실행돼야 한다. 주입 시계로 매 폴링 5초 전진 → 40회 실패면 200초 경과.
    // 옛 120s 예산이면 24회째(≈120초)에 false 반환해 catchup 소실. 기본 30분
    // 상한이면 200초는 상한 안이라 40회째까지 폴링 후 ready → true.
    let calls = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls <= 40) return { ok: false, status: 503 }; // 40회 ≈ 200초 경과
      return { ok: true, status: 200 };
    });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    let clock = 0;
    const nowFn = () => {
      clock += 5_000;
      return clock;
    };

    // timeoutMs 미지정 → 기본 30분 상한. 주입 시계로 200초 경과 재현.
    const ready = await waitForAppReady(HEALTH_URL, {
      fetchFn,
      sleepFn,
      nowFn,
      log: noop,
      intervalMs: 5_000,
    });

    expect(ready).toBe(true);
    expect(calls).toBe(41);
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
