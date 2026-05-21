// gons-dashboard scheduler — node-cron으로 두 작업 트리거.
//
// CRITICAL §3 #10 — KST 8시 정확:
//   timezone: 'Asia/Seoul' 명시 (process.env.TZ도 함께 강제).
//   기본값(UTC) 그대로 두면 알림이 17시에 발송됨.
//
// 작업 1: 매시간 0분 → /api/cron/poll-gmail
// 작업 2: 매일 08:00 KST → /api/cron/morning-digest

import cron from "node-cron";

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

async function callCron(path, label) {
  const startedAt = new Date();
  try {
    const response = await fetch(`${APP_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const text = await response.text();
    const elapsed = Date.now() - startedAt.getTime();
    if (response.ok) {
      console.log(`[cron] ${label} OK ${response.status} (${elapsed}ms)`);
      console.log(`[cron] ${label} body: ${text.slice(0, 2000)}`);
    } else {
      console.error(
        `[cron] ${label} FAIL ${response.status} (${elapsed}ms) ${text.slice(0, 2000)}`,
      );
    }
  } catch (error) {
    console.error(`[cron] ${label} ERROR`, error);
  }
}

// 매시간 정각 — Gmail polling.
cron.schedule(
  "0 * * * *",
  () => {
    void callCron("/api/cron/poll-gmail", "poll-gmail");
  },
  { timezone: TIMEZONE },
);

// 매일 08:00 KST — Morning digest 알림.
cron.schedule(
  "0 8 * * *",
  () => {
    void callCron("/api/cron/morning-digest", "morning-digest");
  },
  { timezone: TIMEZONE },
);

// 매일 00:01 KST — 일진 자동 생성 (자정 정각의 다른 작업과 분리).
cron.schedule(
  "1 0 * * *",
  () => {
    void callCron("/api/cron/generate-daily-fortunes", "generate-daily-fortunes");
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
    );
  },
  { timezone: TIMEZONE },
);

// 매일 16:30 KST — KR 종목 재분석 + flip 알림 (KRX 장 마감 후).
cron.schedule(
  "30 16 * * *",
  () => {
    void callCron("/api/cron/stock-analyze?market=KR", "stock-analyze-kr");
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
    );
  },
  { timezone: TIMEZONE },
);

// 매주 일요일 06:00 KST — KRX 종목 마스터 갱신 (공공데이터포털 API).
cron.schedule(
  "0 6 * * 0",
  () => {
    void callCron("/api/cron/krx-master-sync", "krx-master-sync");
  },
  { timezone: TIMEZONE },
);

console.log(
  "[cron] 스케줄 등록 완료. polling=0 * * * *, digest=0 8 * * * KST, daily-fortunes=1 0 * * * KST, daily-tri=5 0 * * * KST, stock-kr=30 16 * * * KST, stock-us=30 6 * * * KST, krx-master=0 6 * * 0 KST",
);

// 시작 직후 1회 polling — 컨테이너 재시작 시 catchup.
setTimeout(() => {
  void callCron("/api/cron/poll-gmail", "poll-gmail (startup)");
}, 30_000);
