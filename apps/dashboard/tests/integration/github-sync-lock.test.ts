// advisory lock 계약 + syncGithub 의 락 사용 — 이슈 #323.
//
// ⚠️ 실제 두 syncGithub 을 동시에 띄워 경합시키는 테스트는 쓰지 않는다.
// 그러려면 첫 실행을 fetch 에서 붙잡아둔 채 두 번째를 호출해야 하는데,
// 그동안 커넥션 풀(max 10)의 reserve() 가 점유돼 CI 처럼 리소스가 빠듯한
// 환경에서 5초 timeout 이 난다(실제로 CI 에서만 실패했다).
//
// 대신 두 층으로 나눠 검증한다:
//   1. withAdvisoryLock 자체의 계약 — 상호배제·해제·예외 경로 (이 파일)
//   2. syncGithub 이 그 락을 쓰고 lockBusy 를 돌려준다 (이 파일 하단)
// allSettled 로 전부 기다리는지는 syncGithub 의 반환 형태로 확인한다.
import { describe, it, expect, afterEach, vi } from "vitest";
import { withAdvisoryLock, LOCK_KEYS } from "@/shared/lib/db/advisoryLock";

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/shared/config/env");
  vi.resetModules();
});

// 테스트 전용 키 — 실제 githubSync 키와 겹치면 다른 테스트를 막는다.
const TEST_KEY = [323, 9001] as const;

describe("withAdvisoryLock", () => {
  it("락을 잡고 fn 결과를 돌려준다", async () => {
    const r = await withAdvisoryLock(TEST_KEY, "test", async () => "done");
    expect(r).toBe("done");
  });

  // 상호배제 — 바깥 락이 유지되는 동안 같은 키의 획득은 실패해야 한다.
  it("이미 잡힌 키는 대기 없이 null 을 돌려준다", async () => {
    const inner = await withAdvisoryLock(TEST_KEY, "outer", async () =>
      withAdvisoryLock(TEST_KEY, "inner", async () => "should-not-run"),
    );
    expect(inner).toBeNull();
  });

  // finally 에서 반드시 해제해야 한다 — 안 그러면 다음 주기가 영구히 막힌다.
  it("fn 이 throw 해도 락을 해제한다", async () => {
    await expect(
      withAdvisoryLock(TEST_KEY, "throwing", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // 해제됐다면 다시 잡을 수 있다.
    const again = await withAdvisoryLock(TEST_KEY, "after-throw", async () => "ok");
    expect(again).toBe("ok");
  });

  it("연속 호출이 서로를 막지 않는다 (연결 반납 확인)", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await withAdvisoryLock(TEST_KEY, `seq-${i}`, async () => i);
      expect(r).toBe(i);
    }
  });

  it("다른 키는 서로를 막지 않는다", async () => {
    const inner = await withAdvisoryLock(TEST_KEY, "outer", async () =>
      withAdvisoryLock([323, 9002], "other-key", async () => "ok"),
    );
    expect(inner).toBe("ok");
  });
});

describe("syncGithub — 락 사용", () => {
  async function loadSync() {
    vi.resetModules();
    vi.doMock("@/shared/config/env", async () => {
      const actual = await vi.importActual<typeof import("@/shared/config/env")>(
        "@/shared/config/env",
      );
      return {
        ...actual,
        env: {
          ...actual.env,
          GITHUB_MONITOR_TOKEN: "tok",
          GITHUB_MONITOR_ORG: "krdn",
          GITHUB_MONITOR_PRUNE_RUNS: false,
        },
      };
    });
    return (await import("@/features/github-monitor")).syncGithub;
  }

  // syncGithub 이 githubSync 키를 쓰는지 — 바깥에서 그 키를 잡아두면
  // 실행이 즉시 lockBusy 로 반환돼야 한다. GitHub fetch 에는 닿지 않는다.
  it("githubSync 키가 잡혀 있으면 lockBusy 로 즉시 반환한다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const syncGithub = await loadSync();

    const summary = await withAdvisoryLock(LOCK_KEYS.githubSync, "test-holder", () =>
      syncGithub(),
    );

    expect(summary?.lockBusy).toBe(true);
    expect(summary?.skipped).toBe(true);
    // 락에서 막혔으므로 외부 호출이 없어야 한다.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // 락이 풀린 뒤에는 정상 실행되고, 네 소스 결과가 모두 채워진다
  // (allSettled 로 전부 기다린다는 증거 — 하나라도 빠지면 undefined 다).
  it("락이 비어 있으면 실행되고 네 소스 결과가 모두 온다", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (/api\.github\.com\/users\/krdn$/.test(url)) {
        return new Response(JSON.stringify({ type: "Organization" }), { status: 200 });
      }
      // 나머지는 전부 실패시켜도 된다 — 여기서 보는 건 "네 결과가 다 온다"이다.
      return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    });

    const syncGithub = await loadSync();
    const summary = await syncGithub();

    expect(summary.lockBusy).toBeUndefined();
    expect(summary.issues).toBeDefined();
    expect(summary.pulls).toBeDefined();
    expect(summary.runs).toBeDefined();
    expect(summary.build).toBeDefined();
  });
});
