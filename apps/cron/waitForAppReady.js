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
 * @property {number} [timeoutMs] 전체 폴링 예산(안전 상한). 소진되면 false 반환. 기본 30분.
 * @property {number} [intervalMs] 폴링 간격. 기본 5초.
 * @property {number} [probeTimeoutMs] 개별 health fetch 타임아웃. 기본 5초.
 * @property {typeof fetch} [fetchFn] 테스트 주입용 fetch. 기본 전역 fetch.
 * @property {(ms: number) => Promise<void>} [sleepFn] 테스트 주입용 sleep.
 * @property {() => number} [nowFn] 테스트 주입용 시계. 기본 Date.now.
 * @property {(msg: string) => void} [log] 로거. 기본 console.log.
 */

// 안전 상한 — 결함의 본질은 "기다림을 멈추는 것"이라, 이 값은 실제 부팅 시간
// (분 단위)이 아니라 "이 시간 안에 못 뜨면 catchup 소실이 아니라 인프라 장애"의
// 경계다. app boot(마이그레이션 포함)가 아무리 길어도 이 상한 아래면 catchup 이
// 결국 실행된다(#133). 폴링은 setTimeout 코루틴 안에서 await sleep 으로 양보하므로
// 이미 등록된 정규 스케줄 잡·이벤트 루프를 막지 않는다(스케줄 등록 후 fire).
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * app 의 /api/health 가 200 을 줄 때까지 폴링한다. 안전 상한(timeoutMs) 안이면
 * 부팅이 아무리 오래 걸려도 결국 true 를 반환한다 — 유한 재시도가 아니라 "ready
 * 될 때까지 대기". 상한 소진 시에만 false(인프라 장애로 간주).
 *
 * @param {string} healthUrl 예: "http://app:3020/api/health"
 * @param {WaitOptions} [options]
 * @returns {Promise<boolean>} 상한 내 ready 면 true, 상한 소진되면 false.
 */
export async function waitForAppReady(healthUrl, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    fetchFn = fetch,
    sleepFn = defaultSleep,
    nowFn = Date.now,
    log = console.log,
  } = options;

  const deadline = nowFn() + timeoutMs;
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

    if (nowFn() + intervalMs >= deadline) {
      log(
        `[cron] app not ready after ${timeoutMs}ms (${attempt} attempts) — 인프라 장애 의심, catchup 진행(best-effort)`,
      );
      return false;
    }
    await sleepFn(intervalMs);
  }
}

/**
 * @typedef {object} RetryOptions
 * @property {number} [maxAttempts] 총 시도 횟수. 기본 3.
 * @property {number} [backoffMs] 재시도 사이 대기. 기본 15초.
 * @property {(ms: number) => Promise<void>} [sleepFn] 테스트 주입용 sleep.
 * @property {(msg: string) => void} [log] 로거. 기본 console.error.
 */

/**
 * callFn 이 true 를 줄 때까지 backoff 재시도한다. catchup 전용 — 정규 스케줄 cron
 * 에는 쓰지 말 것(알림 cron 은 재시도 시 이중 발송).
 *
 * 느린 부팅(#133 MEDIUM #1)은 waitForAppReady 의 ready 대기가 이미 처리한다. 이
 * 재시도는 그 뒤 "ready 확인 직후 라우트가 순간 5xx" 같은 드문 transient 만 담당
 * (health 200 과 catchup POST 사이의 짧은 창). 그래서 유한 3회로 충분하다.
 *
 * @param {() => Promise<boolean>} callFn 1회 실행. 성공 시 true.
 * @param {string} label 로깅용.
 * @param {RetryOptions} [options]
 * @returns {Promise<boolean>} 한 번이라도 성공하면 true, 전부 실패하면 false.
 */
export async function retryUntilOk(callFn, label, options = {}) {
  const {
    maxAttempts = 3,
    backoffMs = 15_000,
    sleepFn = defaultSleep,
    log = console.error,
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ok = await callFn();
    if (ok) return true;
    if (attempt < maxAttempts) {
      log(`[cron] ${label} 재시도 ${attempt}/${maxAttempts - 1} — ${backoffMs}ms 후`);
      await sleepFn(backoffMs);
    }
  }
  log(`[cron] ${label} ${maxAttempts}회 모두 실패 — 그날 작업 소실 가능 (수동 확인 필요)`);
  return false;
}
