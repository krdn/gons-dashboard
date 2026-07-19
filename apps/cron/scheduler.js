// gons-dashboard scheduler — node-cron으로 두 작업 트리거.
//
// CRITICAL §3 #10 — KST 8시 정확:
//   timezone: 'Asia/Seoul' 명시 (process.env.TZ도 함께 강제).
//   기본값(UTC) 그대로 두면 알림이 17시에 발송됨.
//
// 작업 1: 매시간 0분 → /api/cron/poll-gmail
// 작업 2: 매일 08:00 KST → /api/cron/morning-digest

import cron from "node-cron";
import { runDeployCycle } from "./autopilot/deploy-watcher.js";
import { waitForAppReady, retryUntilOk } from "./waitForAppReady.js";

const APP_URL = process.env.APP_URL ?? "http://app:3020";
const TOKEN = process.env.CRON_BEARER_TOKEN;
const TIMEZONE = "Asia/Seoul";

if (!TOKEN) {
  console.error("[cron] CRON_BEARER_TOKEN 미설정 — 종료");
  process.exit(1);
}

console.log(
  `[cron] 시작 — APP_URL=${APP_URL} TZ=${process.env.TZ} cron-tz=${TIMEZONE}`,
);

// 라우트별 타임아웃(ms). Node fetch 의 기본 타임아웃은 무제한이라, LLM 작업이
// hang 하면 promise 가 영구 pending → 메모리 누적·다음 주기 누락. AbortSignal 로 차단.
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @param {string} path
 * @param {string} label
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} HTTP 2xx 면 true, 그 외(non-2xx/네트워크/타임아웃) false.
 */
async function callCron(path, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = new Date();
  try {
    const response = await fetch(`${APP_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const elapsed = Date.now() - startedAt.getTime();
    if (response.ok) {
      console.log(`[cron] ${label} OK ${response.status} (${elapsed}ms)`);
      console.log(`[cron] ${label} body: ${text.slice(0, 2000)}`);
      return true;
    }
    console.error(
      `[cron] ${label} FAIL ${response.status} (${elapsed}ms) ${text.slice(0, 2000)}`,
    );
    return false;
  } catch (error) {
    const elapsed = Date.now() - startedAt.getTime();
    // AbortSignal.timeout() 발화 시 TimeoutError(name) — 일반 네트워크 에러와 구분.
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    console.error(
      `[cron] ${label} ${isTimeout ? `TIMEOUT (${timeoutMs}ms, elapsed ${elapsed}ms)` : "ERROR"}`,
      error,
    );
    return false;
  }
}

/**
 * catchup 전용 — callCron 을 retryUntilOk 로 감싼다. 정규 스케줄 cron 은 사용 금지
 * (알림 cron 은 재시도 시 이중 발송). catchup 대상(poll-gmail·daily-fortunes·
 * daily-tri)은 재실행 안전: 일진 두 엔드포인트는 for_date unique index 로 row
 * idempotent, poll-gmail 은 다음 정시 재실행이 있어 무해.
 *
 * @param {string} path
 * @param {string} label
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function callCronWithRetry(path, label, timeoutMs) {
  return retryUntilOk(() => callCron(path, label, timeoutMs), label);
}

// 15분마다 — Gmail polling. 사용자별 동기화 주기는 app 레이어가 isSyncDue로 판정.
cron.schedule(
  "*/15 * * * *",
  () => {
    void callCron("/api/cron/poll-gmail", "poll-gmail", 300_000);
  },
  { timezone: TIMEZONE },
);

// 15분마다 — Morning digest. 사용자별 발송 시각은 app 레이어가 isDigestDue로 판정.
cron.schedule(
  "*/15 * * * *",
  () => {
    void callCron("/api/cron/morning-digest", "morning-digest");
  },
  { timezone: TIMEZONE },
);

// 매일 00:01 KST — 일진 자동 생성 (자정 정각의 다른 작업과 분리).
cron.schedule(
  "1 0 * * *",
  () => {
    void callCron(
      "/api/cron/generate-daily-fortunes",
      "generate-daily-fortunes",
      180_000,
    );
  },
  { timezone: TIMEZONE },
);

// 매일 00:05 KST — v0.3 tri 일진 4학파 자동 생성 (generate-daily-fortunes 보다 4분 stagger).
cron.schedule(
  "5 0 * * *",
  () => {
    void callCron(
      "/api/cron/generate-daily-tri-fortunes",
      "generate-daily-tri-fortunes",
      120_000,
    );
  },
  { timezone: TIMEZONE },
);

// 매일 16:30 KST — KR 종목 재분석 + flip 알림 (KRX 장 마감 후).
cron.schedule(
  "30 16 * * *",
  () => {
    void callCron(
      "/api/cron/stock-analyze?market=KR",
      "stock-analyze-kr",
      300_000,
    );
  },
  { timezone: TIMEZONE },
);

// 매일 06:30 KST — US/Crypto/Commodity 재분석 + flip 알림 (US 장 마감 + crypto/commodity 일중).
cron.schedule(
  "30 6 * * *",
  () => {
    void callCron(
      "/api/cron/stock-analyze?market=US_GLOBAL",
      "stock-analyze-us-global",
      300_000,
    );
  },
  { timezone: TIMEZONE },
);

// 매주 일요일 06:00 KST — KRX 종목 마스터 갱신 (공공데이터포털 API).
cron.schedule(
  "0 6 * * 0",
  () => {
    void callCron("/api/cron/krx-master-sync", "krx-master-sync", 120_000);
  },
  { timezone: TIMEZONE },
);

// 매시간 23분 — 미분류 메모 LLM 분류 sweep (정각 poll-gmail과 stagger).
cron.schedule(
  "23 * * * *",
  () => {
    void callCron("/api/cron/memo-classify", "memo-classify", 180_000);
  },
  { timezone: TIMEZONE },
);

// 매일 19:05 KST — 주간 메모 다이제스트 (일요일 19:00 이후 due, 놓친 날은 다음 날 catchup).
cron.schedule(
  "5 19 * * *",
  () => {
    void callCron("/api/cron/memo-digest", "memo-digest", 180_000);
  },
  { timezone: TIMEZONE },
);

// 매시간 37분 — 수락된 할일·일정 기한 리마인더 (23분 memo-classify와 stagger).
cron.schedule(
  "37 * * * *",
  () => {
    void callCron("/api/cron/memo-action-reminders", "memo-action-reminders");
  },
  { timezone: TIMEZONE },
);

// 매시간 41분 — 48h 창 미추출 메모 액션 추출 sweep.
cron.schedule(
  "41 * * * *",
  () => {
    void callCron("/api/cron/memo-extract-actions", "memo-extract-actions", 180_000);
  },
  { timezone: TIMEZONE },
);

// 매분 — 활성 호스트 docker stats 1사이클 수집 (관제 #323 Phase 1).
// 수집 잡: 놓친 주기는 다음 분이 대체하므로 catchup·retry 대상 아님 (이슈 주의점 7).
cron.schedule(
  "* * * * *",
  () => {
    void callCron("/api/cron/collect-docker-stats", "collect-docker-stats", 50_000);
  },
  { timezone: TIMEZONE },
);

// autopilot — 5분 주기로 새 이미지 감지·배포·검증·롤백 (AUTOPILOT_DEPLOY=on 일 때만).
if (process.env.AUTOPILOT_DEPLOY === "on") {
  cron.schedule(
    "*/5 * * * *",
    () => {
      void runDeployCycle();
    },
    { timezone: TIMEZONE },
  );
  console.log("[cron] autopilot deploy-watcher 등록 (*/5 * * * *)");
}

console.log(
  "[cron] 스케줄 등록 완료. polling=*/15 * * * *, digest=*/15 * * * * KST(app-side due), daily-fortunes=1 0 * * * KST, daily-tri=5 0 * * * KST, stock-kr=30 16 * * * KST, stock-us=30 6 * * * KST, krx-master=0 6 * * 0 KST, memo-classify=23 * * * * KST, memo-digest=5 19 * * * KST, memo-action-reminders=37 * * * * KST, memo-extract-actions=41 * * * * KST, collect-docker-stats=* * * * * KST",
);

// 시작 직후 catchup — 컨테이너가 정규 스케줄 시각에 떠있지 않았던 날(배포·재시작)
// 의 작업이 node-cron 미재생으로 소실되는 것을 방지.
//
// #133 MEDIUM #1 — app 미준비 시 catchup 의 silent fail 을 막는다. 핵심 방어는
// waitForAppReady 가 /api/health(DB SELECT 1 포함 readiness probe) 200 을 확인할
// 때까지 "대기"하는 것 — 유한 재시도가 아니라, app 부팅이 아무리 오래 걸려도
// (마이그레이션 지연 등) 안전 상한(30분) 안이면 결국 catchup 이 실행된다. 상한을
// 넘기면(=인프라 장애 의심) false 지만, 이 setTimeout 코루틴만 폴링할 뿐 이미
// 등록된 정규 스케줄 잡·이벤트 루프는 막지 않는다(스케줄 등록 후 fire).
//
// callCronWithRetry(=retryUntilOk∘callCron)는 이제 "ready 이후의 드문 transient"
// (health 200 직후 라우트가 순간 5xx) 만 담당 — 느린 부팅은 위 대기가 처리.
//
// 일진 두 엔드포인트는 chart_id+for_date unique index 로 row 는 안전(UPSERT/
// onConflictDoNothing). tri 는 LLM 없는 순수 계산이라 완전 idempotent.
// daily-fortunes 는 row 만 idempotent — 자정±수십초 재시작으로 정규 cron(00:01)
// 과 이 catchup 이 cache-miss 창에서 겹치면 LLM spend 가 이중 기록될 수 있으나
// (좁은 창, 당일 예산 집계만 영향), ready 대기가 그 race 창도 자연 축소한다.
// stagger(0→30s→60s)로 정규 스케줄(00:01/00:05)의 LLM 부하 분산을 미러.
setTimeout(() => {
  void (async () => {
    await waitForAppReady(`${APP_URL}/api/health`);
    await callCronWithRetry("/api/cron/poll-gmail", "poll-gmail (startup)", 300_000);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await callCronWithRetry(
      "/api/cron/generate-daily-fortunes",
      "generate-daily-fortunes (startup)",
      180_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await callCronWithRetry(
      "/api/cron/generate-daily-tri-fortunes",
      "generate-daily-tri-fortunes (startup)",
      120_000,
    );
  })();
}, 30_000);
