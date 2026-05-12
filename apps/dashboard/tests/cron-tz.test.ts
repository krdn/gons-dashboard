// CRITICAL §3 #10 회귀 방지 — KST 8시 정확 트리거.
//
// 가장 흔한 cron 버그: timezone 옵션 누락 → UTC 기본값 → 17:00 KST 발송.
// node-cron 자체는 cron/ 컨테이너에만 설치되어 있고, 메인 앱에서는 Intl 변환만 검증.
// 진짜 발송 시간은 cron/scheduler.js의 timezone: 'Asia/Seoul' 명시로 보장.

import { describe, it, expect } from "vitest";

describe("cron 타임존 회귀", () => {
  it("환경변수 TZ가 Asia/Seoul로 강제되어 있다", () => {
    expect(process.env.TZ).toBe("Asia/Seoul");
  });

  it("Intl.DateTimeFormat KST 변환 — UTC 23:00 → 다음날 KST 08:00", () => {
    // 2026-01-14 23:00:00 UTC = 2026-01-15 08:00:00 KST.
    const utcDate = new Date(Date.UTC(2026, 0, 14, 23, 0, 0));
    const kstHour = parseInt(
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hour12: false,
      }).format(utcDate),
      10,
    );
    expect(kstHour).toBe(8);
  });

  it("KST 자정 경계 — 7월 31일 UTC 15:00 = 8월 1일 KST 00:00", () => {
    const utcDate = new Date(Date.UTC(2026, 6, 31, 15, 0, 0));
    const kstDay = parseInt(
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        day: "2-digit",
      }).format(utcDate),
      10,
    );
    expect(kstDay).toBe(1);
  });
});
