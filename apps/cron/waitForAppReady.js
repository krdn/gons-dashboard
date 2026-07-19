// startup catchup 용 app readiness 폴링.
//
// #133 MEDIUM #1 — cron 컨테이너의 startup catchup(T+30s/60s/120s)이 실행될 때
// app 컨테이너가 아직 ready 하지 않으면(Next.js 부팅 + 마이그레이션이 지연) catchup
// fetch 가 ECONNREFUSED/타임아웃으로 silent fail → 그날 일진 영구 소실. catchup 을
// 실제 호출하기 전에 /api/health 가 200 을 줄 때까지 폴링해 이 구멍을 막는다.
//
// /api/health 는 DB `SELECT 1` 까지 확인하는 진짜 readiness probe 라, 200 = 부팅 +
// 마이그레이션 완료를 의미한다.

/**
 * @typedef {object} WaitOptions
 * @property {number} [timeoutMs] 전체 폴링 예산. 소진되면 false 반환. 기본 120초.
 * @property {number} [intervalMs] 폴링 간격. 기본 5초.
 * @property {number} [probeTimeoutMs] 개별 health fetch 타임아웃. 기본 5초.
 * @property {typeof fetch} [fetchFn] 테스트 주입용 fetch. 기본 전역 fetch.
 * @property {(ms: number) => Promise<void>} [sleepFn] 테스트 주입용 sleep.
 * @property {(msg: string) => void} [log] 로거. 기본 console.log.
 */

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * app 의 /api/health 가 200 을 줄 때까지 폴링한다.
 *
 * @param {string} healthUrl 예: "http://app:3020/api/health"
 * @param {WaitOptions} [options]
 * @returns {Promise<boolean>} 예산 내 ready 면 true, 소진되면 false.
 */
export async function waitForAppReady(healthUrl, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    fetchFn = fetch,
    sleepFn = defaultSleep,
    log = console.log,
  } = options;

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      const response = await fetchFn(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
      if (response.ok) {
        log(`[cron] app ready — ${healthUrl} ${response.status} (attempt ${attempt})`);
        return true;
      }
    } catch {
      // ECONNREFUSED/타임아웃 = app 아직 부팅 중. 폴링 계속.
    }

    if (Date.now() + intervalMs >= deadline) {
      log(
        `[cron] app not ready after ${timeoutMs}ms (${attempt} attempts) — catchup 진행(best-effort)`,
      );
      return false;
    }
    await sleepFn(intervalMs);
  }
}
